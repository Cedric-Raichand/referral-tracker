import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import {
  storageKind, createReferrer, getReferrerByUsername, getReferrerById, addReferral, getLeaderboard,
  getReferralsFor, getReferralById, setConfirmed, getReferralsByPlatform, setConfirmedMany,
} from './db.js';
import {
  normalizePhone, normalizeUsername, normalizeContact, isValidPhone, isValidUsername, isValidContact,
  phoneKey, extractPhoneKeys,
} from './validate.js';
import { registerPage, linksPage, joinPage, joinedPage, adminPage, adminReferrerPage, choosePage, bulkPage, bulkResultPage, notFoundPage } from './views.js';

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(303, { Location: location });
  res.end();
}

function isAdmin(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const given = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const password = given.slice(given.indexOf(':') + 1);
  const a = Buffer.from(password);
  const b = Buffer.from(config.adminPassword);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Block form posts that come from another website (the browser sends an Origin header). */
function isSameSite(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function askForLogin(res) {
  send(res, 401, notFoundPage('Admin login required.'), { 'WWW-Authenticate': 'Basic realm="Referral admin"' });
}

async function readForm(req, limit = 20_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Body too large');
    chunks.push(chunk);
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
}

export async function handle(req, res) {
  const url = new URL(req.url, config.baseUrl);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;

  if (method === 'GET' && path === '/cover.png') {
    try {
      const image = await readFile(new URL('../public/cover.png', import.meta.url));
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      return res.end(image);
    } catch {
      return send(res, 404, notFoundPage());
    }
  }

  if (method === 'GET' && path === '/') return send(res, 200, registerPage());

  if (method === 'POST' && path === '/register') {
    const form = await readForm(req);
    const name = String(form.name || '').trim().slice(0, 60);
    const phone = normalizePhone(form.phone);
    const username = normalizeUsername(form.username);
    const values = { name, phone: form.phone, username: form.username };

    if (!name) return send(res, 400, registerPage({ error: 'Please enter your name.', values }));
    if (!isValidPhone(phone)) return send(res, 400, registerPage({ error: 'Please enter a valid phone number.', values }));
    if (!isValidUsername(username)) {
      return send(res, 400, registerPage({ error: 'Username must be 3-20 characters: letters, numbers or underscore.', values }));
    }
    if (['admin', 'bulk', 'confirm'].includes(username)) {
      return send(res, 409, registerPage({ error: 'That username is taken. Try another.', values }));
    }
    const result = await createReferrer({ name, phone, username });
    if (!result.ok) return send(res, 409, registerPage({ error: 'That username is taken. Try another.', values }));
    return redirect(res, `/links/${encodeURIComponent(username)}`);
  }

  let m = path.match(/^\/links\/([^/]+)$/);
  if (method === 'GET' && m) {
    const referrer = await getReferrerByUsername(normalizeUsername(decodeURIComponent(m[1])));
    if (!referrer) return send(res, 404, notFoundPage('We could not find that username.'));
    return send(res, 200, linksPage(referrer));
  }

  m = path.match(/^\/r\/([^/]+)$/);
  if (method === 'GET' && m) {
    const referrer = await getReferrerByUsername(normalizeUsername(decodeURIComponent(m[1])));
    if (!referrer) return send(res, 404, notFoundPage('This invite link is not valid.'));
    return send(res, 200, choosePage(referrer));
  }

  m = path.match(/^\/r\/([^/]+)\/([^/]+)$/);
  if (m && (method === 'GET' || method === 'POST')) {
    const referrer = await getReferrerByUsername(normalizeUsername(decodeURIComponent(m[1])));
    const platformKey = decodeURIComponent(m[2]);
    const platform = config.platforms[platformKey];
    if (!referrer || !platform) return send(res, 404, notFoundPage('This invite link is not valid.'));
    if (!platform.url) return send(res, 503, notFoundPage('This group is not open for joining yet.'));

    if (method === 'GET') return send(res, 200, joinPage({ referrer, platformKey }));

    const form = await readForm(req);
    const name = String(form.name || '').trim().slice(0, 60);
    const contact = normalizeContact(platformKey, form.contact);
    const values = { name, contact: form.contact };
    if (!name) return send(res, 400, joinPage({ referrer, platformKey, error: 'Please enter your name.', values }));
    if (!isValidContact(platformKey, contact)) {
      const error =
        platform.contact === 'username'
          ? 'Please enter a valid username (letters, numbers, dots, dashes or underscores).'
          : 'Please enter a valid phone number.';
      return send(res, 400, joinPage({ referrer, platformKey, error, values }));
    }

    const result = await addReferral({ referrer, platform: platformKey, name, contact });
    if (!result.ok && result.reason === 'self_referral') {
      return send(res, 400, joinPage({ referrer, platformKey, error: 'You cannot refer yourself.', values }));
    }
    return send(res, 200, joinedPage({ referrer, platformKey, counted: result.ok }));
  }

  if (method === 'POST' && path === '/admin/confirm') {
    if (!isAdmin(req)) return askForLogin(res);
    if (!isSameSite(req)) return send(res, 403, notFoundPage('Request blocked.'));
    const form = await readForm(req);
    const referral = await getReferralById(form.id);
    if (!referral) return send(res, 404, notFoundPage('That person was not found.'));
    await setConfirmed(referral.id, form.value === '1');
    const referrer = await getReferrerById(referral.referrer_id);
    return redirect(res, `/admin/${encodeURIComponent(referrer.username)}`);
  }

  if (path === '/admin/bulk' && (method === 'GET' || method === 'POST')) {
    if (!isAdmin(req)) return askForLogin(res);
    if (method === 'GET') return send(res, 200, bulkPage());
    if (!isSameSite(req)) return send(res, 403, notFoundPage('Request blocked.'));

    const form = await readForm(req, 300_000);
    const keys = extractPhoneKeys(form.members);
    if (!keys.size) {
      return send(res, 400, bulkPage({ error: 'No phone numbers found. Paste the member list with numbers, one per line.' }));
    }
    const referred = await getReferralsByPlatform('whatsapp');
    const matched = referred.filter((r) => keys.has(phoneKey(r.contact)));
    const confirmedNow = matched.filter((r) => !r.confirmed);
    await setConfirmedMany(confirmedNow.map((r) => r.id), true);
    return send(
      res,
      200,
      bulkResultPage({
        found: keys.size,
        confirmedNow,
        alreadyConfirmed: matched.length - confirmedNow.length,
        notFound: referred.length - matched.length,
      }),
    );
  }

  if (method === 'GET' && (path === '/admin' || path.startsWith('/admin/'))) {
    if (!isAdmin(req)) return askForLogin(res);
    if (path === '/admin') return send(res, 200, adminPage({ leaderboard: await getLeaderboard() }));
    const referrer = await getReferrerByUsername(normalizeUsername(decodeURIComponent(path.slice(7))));
    if (!referrer) return send(res, 404, notFoundPage('Referrer not found.'));
    return send(res, 200, adminReferrerPage({ referrer, referrals: await getReferralsFor(referrer.id) }));
  }

  return send(res, 404, notFoundPage());
}

export function createServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, 500, notFoundPage('Something went wrong. Please try again.'));
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer().listen(config.port, () => console.log(`Referral tracker running at ${config.baseUrl} (storage: ${storageKind})`));
}