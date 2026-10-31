import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import {
  createReferrer, getReferrerByUsername, addReferral, getLeaderboard, getReferralsFor,
  normalizePhone, normalizeUsername, isValidPhone, isValidUsername,
} from './db.js';
import { registerPage, linksPage, joinPage, joinedPage, adminPage, adminReferrerPage, notFoundPage } from './views.js';

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

function askForLogin(res) {
  send(res, 401, notFoundPage('Admin login required.'), { 'WWW-Authenticate': 'Basic realm="Referral admin"' });
}

async function readForm(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20_000) throw new Error('Body too large');
    chunks.push(chunk);
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
}

export async function handle(req, res) {
  const url = new URL(req.url, config.baseUrl);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;

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
    const result = createReferrer({ name, phone, username });
    if (!result.ok) return send(res, 409, registerPage({ error: 'That username is taken. Try another.', values }));
    return redirect(res, `/links/${encodeURIComponent(username)}`);
  }

  let m = path.match(/^\/links\/([^/]+)$/);
  if (method === 'GET' && m) {
    const referrer = getReferrerByUsername(normalizeUsername(decodeURIComponent(m[1])));
    if (!referrer) return send(res, 404, notFoundPage('We could not find that username.'));
    return send(res, 200, linksPage(referrer));
  }

  m = path.match(/^\/r\/([^/]+)\/([^/]+)$/);
  if (m && (method === 'GET' || method === 'POST')) {
    const referrer = getReferrerByUsername(normalizeUsername(decodeURIComponent(m[1])));
    const platformKey = decodeURIComponent(m[2]);
    const platform = config.platforms[platformKey];
    if (!referrer || !platform) return send(res, 404, notFoundPage('This invite link is not valid.'));
    if (!platform.url) return send(res, 503, notFoundPage('This group is not open for joining yet.'));

    if (method === 'GET') return send(res, 200, joinPage({ referrer, platformKey }));

    const form = await readForm(req);
    const name = String(form.name || '').trim().slice(0, 60);
    const phone = normalizePhone(form.phone);
    const values = { name, phone: form.phone };
    if (!name) return send(res, 400, joinPage({ referrer, platformKey, error: 'Please enter your name.', values }));
    if (!isValidPhone(phone)) return send(res, 400, joinPage({ referrer, platformKey, error: 'Please enter a valid phone number.', values }));

    const result = addReferral({ referrer, platform: platformKey, name, phone });
    if (!result.ok && result.reason === 'self_referral') {
      return send(res, 400, joinPage({ referrer, platformKey, error: 'You cannot refer yourself.', values }));
    }
    return send(res, 200, joinedPage({ referrer, platformKey, counted: result.ok }));
  }

  if (method === 'GET' && (path === '/admin' || path.startsWith('/admin/'))) {
    if (!isAdmin(req)) return askForLogin(res);
    if (path === '/admin') return send(res, 200, adminPage({ leaderboard: getLeaderboard() }));
    const referrer = getReferrerByUsername(normalizeUsername(decodeURIComponent(path.slice(7))));
    if (!referrer) return send(res, 404, notFoundPage('Referrer not found.'));
    return send(res, 200, adminReferrerPage({ referrer, referrals: getReferralsFor(referrer.id) }));
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
  createServer().listen(config.port, () => console.log(`Referral tracker running at ${config.baseUrl}`));
}