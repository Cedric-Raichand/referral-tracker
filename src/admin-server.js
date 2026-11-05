import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import {
  storageKind, getReferrerByUsername, getReferrerById, getLeaderboard, getReferralsFor,
  getReferralById, setConfirmed, getReferralsByPlatform, setConfirmedMany,
} from './db.js';
import { normalizeUsername, phoneKey, extractPhoneKeys } from './validate.js';
import { adminPage, adminReferrerPage, bulkPage, bulkResultPage, notFoundPage } from './views.js';
import { send, redirect, readForm, isSameSite, createHttpServer } from './http.js';

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

/**
 * The admin site. It is a separate website from the public one, with its own address and password.
 * It reads and writes the same database, so counts from the public site show up here.
 */
export async function handle(req, res) {
  // Everything here needs the admin password, including pages that don't exist.
  if (!isAdmin(req)) return askForLogin(res);

  const url = new URL(req.url, 'http://admin.local');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;

  if (method === 'GET' && path === '/') return redirect(res, '/admin');

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