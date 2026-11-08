import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import {
  storageKind, getSetting, setSetting, getReferrerByUsername, getReferrerById, getLeaderboard,
  getReferralsFor, getReferralById, setConfirmed, getReferralsByPlatform, setConfirmedMany,
} from './db.js';
import { normalizeUsername, phoneKey, extractPhoneKeys } from './validate.js';
import {
  adminPage, adminReferrerPage, bulkPage, bulkResultPage, loginPage, passwordPage, notFoundPage,
} from './views.js';
import { send, redirect, readForm, isSameSite, createHttpServer } from './http.js';
import {
  hashPassword, verifyPasswordHash, makeSessionToken, verifySessionToken, parseCookies, createLimiter,
} from './auth.js';

const COOKIE = 'admin_session';
const PASSWORD_KEY = 'admin_password';
const limiter = createLimiter();

/** Once the admin has set a password of his own it is stored (hashed). Until then ADMIN_PASSWORD is used. */
async function checkPassword(input) {
  const stored = await getSetting(PASSWORD_KEY);
  if (stored) return verifyPasswordHash(input, stored);
  const a = Buffer.from(String(input));
  const b = Buffer.from(config.adminPassword);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function sessionKey() {
  return (await getSetting(PASSWORD_KEY)) || `env:${config.adminPassword}`;
}

async function isLoggedIn(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  return Boolean(token) && verifySessionToken(token, await sessionKey());
}

function clientKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function cookieHeader(req, value, maxAgeSeconds) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function redirectWithCookie(res, location, cookie) {
  res.writeHead(303, { Location: location, 'Set-Cookie': cookie });
  res.end();
}

/**
 * The admin site. It is a separate website from the public one, with its own address and password.
 * It reads and writes the same database, so counts from the public site show up here.
 */
export async function handle(req, res) {
  const url = new URL(req.url, 'http://admin.local');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;

  // ---- login and logout (the only pages that don't need a session) ----
  if (path === '/login' && method === 'GET') {
    return (await isLoggedIn(req)) ? redirect(res, '/admin') : send(res, 200, loginPage());
  }

  if (path === '/login' && method === 'POST') {
    if (!isSameSite(req)) return send(res, 403, notFoundPage('Request blocked.'));
    const who = clientKey(req);
    if (limiter.blocked(who)) {
      return send(res, 429, loginPage({ error: 'Too many wrong attempts. Please wait 15 minutes and try again.' }));
    }
    const form = await readForm(req);
    if (!(await checkPassword(form.password || ''))) {
      limiter.fail(who);
      return send(res, 401, loginPage({ error: 'Wrong password.' }));
    }
    limiter.reset(who);
    return redirectWithCookie(res, '/admin', cookieHeader(req, makeSessionToken(await sessionKey()), 7 * 24 * 60 * 60));
  }

  if (path === '/logout' && method === 'POST') {
    return redirectWithCookie(res, '/login', cookieHeader(req, '', 0));
  }

  // ---- everything else needs a login ----
  if (!(await isLoggedIn(req))) return redirect(res, '/login');

  if (method === 'GET' && path === '/') return redirect(res, '/admin');

  if (path === '/admin/password' && method === 'GET') return send(res, 200, passwordPage());

  if (path === '/admin/password' && method === 'POST') {
    if (!isSameSite(req)) return send(res, 403, notFoundPage('Request blocked.'));
    const who = clientKey(req);
    if (limiter.blocked(who)) {
      return send(res, 429, passwordPage({ error: 'Too many wrong attempts. Please wait 15 minutes and try again.' }));
    }
    const form = await readForm(req);
    if (!(await checkPassword(form.current || ''))) {
      limiter.fail(who);
      return send(res, 400, passwordPage({ error: 'Your current password is not correct.' }));
    }
    const next = String(form.next || '');
    if (next.length < 10) return send(res, 400, passwordPage({ error: 'The new password must be at least 10 characters.' }));
    if (next !== form.confirm) return send(res, 400, passwordPage({ error: 'The two new passwords do not match.' }));
    if (next === form.current) return send(res, 400, passwordPage({ error: 'Choose a password different from the current one.' }));

    await setSetting(PASSWORD_KEY, await hashPassword(next));
    limiter.reset(who);
    // The old login cookie stops working with the old password, so hand out a fresh one.
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Set-Cookie': cookieHeader(req, makeSessionToken(await sessionKey()), 7 * 24 * 60 * 60),
    });
    return res.end(passwordPage({ message: 'Password changed. Use the new one next time you log in.' }));
  }

  if (method === 'POST' && path === '/admin/confirm') {
    if (!isSameSite(req)) return send(res, 403, notFoundPage('Request blocked.'));
    const form = await readForm(req);
    const referral = await getReferralById(form.id);
    if (!referral) return send(res, 404, notFoundPage('That person was not found.'));
    await setConfirmed(referral.id, form.value === '1');
    const referrer = await getReferrerById(referral.referrer_id);
    return redirect(res, `/admin/${encodeURIComponent(referrer.username)}`);
  }

  if (path === '/admin/bulk' && (method === 'GET' || method === 'POST')) {
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

  if (method === 'GET' && path === '/admin') {
    return send(res, 200, adminPage({ leaderboard: await getLeaderboard() }));
  }

  const match = path.match(/^\/admin\/([^/]+)$/);
  if (method === 'GET' && match) {
    const referrer = await getReferrerByUsername(normalizeUsername(decodeURIComponent(match[1])));
    if (!referrer) return send(res, 404, notFoundPage('Referrer not found.'));
    return send(res, 200, adminReferrerPage({ referrer, referrals: await getReferralsFor(referrer.id) }));
  }

  return send(res, 404, notFoundPage());
}

export function createAdminServer() {
  return createHttpServer(handle);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createAdminServer().listen(config.adminPort, () =>
    console.log(`Referral tracker ADMIN site running on port ${config.adminPort} (storage: ${storageKind})`),
  );
}