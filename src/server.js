import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { storageKind, createReferrer, getReferrerByUsername, addReferral } from './db.js';
import {
  normalizePhone, normalizeUsername, normalizeContact, isValidPhone, isValidUsername, isValidContact,
} from './validate.js';
import { registerPage, linksPage, joinPage, joinedPage, choosePage, notFoundPage } from './views.js';
import { send, redirect, readForm, createHttpServer } from './http.js';

/** The public site: registration, referral links and the join pages. No admin pages live here. */
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

  return send(res, 404, notFoundPage());
}

export function createServer() {
  return createHttpServer(handle);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer().listen(config.port, () =>
    console.log(`Referral tracker (public site) running at ${config.baseUrl} (storage: ${storageKind})`),
  );
}