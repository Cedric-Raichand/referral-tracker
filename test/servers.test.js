// Both sites run in this one test process and share one in-memory database,
// which is the same idea as two hosted sites sharing one MongoDB.
process.env.DB_PATH = ':memory:';
process.env.ADMIN_PASSWORD = 'starting-password';
process.env.WHATSAPP_URL = 'https://chat.whatsapp.com/abc';
process.env.SNAPCHAT_URL = 'https://www.snapchat.com/add/x';
process.env.BASE_URL = 'http://localhost';
delete process.env.MONGODB_URI;

import test from 'node:test';
import assert from 'node:assert/strict';

const { createServer } = await import('../src/server.js');
const { createAdminServer } = await import('../src/admin-server.js');

const start = async (server) => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
};

const publicServer = createServer();
const adminServer = createAdminServer();
const pub = await start(publicServer);
const adm = await start(adminServer);

test.after(() => {
  for (const server of [publicServer, adminServer]) {
    server.closeAllConnections();
    server.close();
  }
});

const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };
const post = (data, headers = {}) => ({
  method: 'POST',
  headers: { ...FORM, ...headers },
  body: new URLSearchParams(data),
  redirect: 'manual',
});
const cookieFrom = (res) => (res.headers.get('set-cookie') || '').split(';')[0];

async function login(password) {
  const res = await fetch(adm + '/login', post({ password }));
  return { res, cookie: cookieFrom(res) };
}

let session = '';

test('the public site has no admin pages', async () => {
  for (const path of ['/admin', '/admin/bulk', '/admin/password', '/login', '/admin/jeanette']) {
    assert.equal((await fetch(pub + path, { redirect: 'manual' })).status, 404, path);
  }
  const home = await (await fetch(pub + '/')).text();
  assert.equal(home.includes('Admin login'), false);
});

test('the admin site sends visitors to the login page', async () => {
  for (const path of ['/admin', '/admin/bulk', '/nothing-here', '/']) {
    const res = await fetch(adm + path, { redirect: 'manual' });
    assert.equal(res.status, 303, path);
    assert.equal(res.headers.get('location'), '/login', path);
  }
  const page = await fetch(adm + '/login');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Admin login/);
});

test('wrong password is refused, right password logs in', async () => {
  const wrong = await login('nope');
  assert.equal(wrong.res.status, 401);
  assert.equal(wrong.cookie, '');

  const right = await login('starting-password');
  assert.equal(right.res.status, 303);
  assert.equal(right.res.headers.get('location'), '/admin');
  assert.match(right.cookie, /^admin_session=/);
  assert.match(right.res.headers.get('set-cookie'), /HttpOnly/);
  session = right.cookie;

  const dash = await fetch(adm + '/admin', { headers: { Cookie: session } });
  assert.equal(dash.status, 200);
  assert.match(await dash.text(), /Referral dashboard/);
});

test('the admin site has no registration or join pages', async () => {
  assert.equal((await fetch(adm + '/r/jeanette', { headers: { Cookie: session } })).status, 404);
  const reg = await fetch(adm + '/register', post({ name: 'X' }, { Cookie: session }));
  assert.equal(reg.status, 404);
});

test('what happens on the public site shows up on the admin site', async () => {
  assert.equal((await fetch(pub + '/register', post({ name: 'Jeanette', phone: '0241111111', username: 'jeanette' }))).status, 303);

  const chooser = await (await fetch(pub + '/r/jeanette')).text();
  assert.match(chooser, /Join WhatsApp group/);
  assert.match(chooser, /Join Snapchat/);

  await fetch(pub + '/r/jeanette/whatsapp', post({ name: 'Ama', contact: '025 000 0001' }));
  await fetch(pub + '/r/jeanette/whatsapp', post({ name: 'Kofi', contact: '0250000002' }));
  await fetch(pub + '/r/jeanette/snapchat', post({ name: 'Ama', contact: '@Ama_K' }));

  let dash = await (await fetch(adm + '/admin', { headers: { Cookie: session } })).text();
  assert.match(dash, /1 referrers &middot; 3 referred &middot; 0 confirmed/);

  const detail = await (await fetch(adm + '/admin/jeanette', { headers: { Cookie: session } })).text();
  const id = detail.match(/name="id" value="([^"]+)"/)[1];
  const confirm = await fetch(adm + '/admin/confirm', post({ id, value: '1' }, { Cookie: session }));
  assert.equal(confirm.status, 303);
  dash = await (await fetch(adm + '/admin', { headers: { Cookie: session } })).text();
  assert.match(dash, /3 referred &middot; 1 confirmed/);
});

test('bulk confirm works on the admin site', async () => {
  const res = await fetch(adm + '/admin/bulk', post({ members: 'Someone\n+233 25 000 0001\n+233 25 000 0002' }, { Cookie: session }));
  assert.equal(res.status, 200);
  const dash = await (await fetch(adm + '/admin', { headers: { Cookie: session } })).text();
  // one person was already confirmed by hand, the bulk list adds the two WhatsApp people
  assert.match(dash, /3 referred &middot; 3 confirmed/);
});

test('admin form posts from another website are blocked', async () => {
  const res = await fetch(adm + '/admin/bulk', post({ members: '+233 25 000 0001' }, { Cookie: session, Origin: 'https://evil.example' }));
  assert.equal(res.status, 403);
  const loginRes = await fetch(adm + '/login', post({ password: 'starting-password' }, { Origin: 'https://evil.example' }));
  assert.equal(loginRes.status, 403);
});

test('the admin can change his own password', async () => {
  const change = (data) => fetch(adm + '/admin/password', post(data, { Cookie: session }));

  assert.equal((await change({ current: 'wrong', next: 'a-brand-new-pass', confirm: 'a-brand-new-pass' })).status, 400);
  assert.equal((await change({ current: 'starting-password', next: 'short', confirm: 'short' })).status, 400);
  assert.equal((await change({ current: 'starting-password', next: 'a-brand-new-pass', confirm: 'different-pass-1' })).status, 400);
  assert.equal((await change({ current: 'starting-password', next: 'starting-password', confirm: 'starting-password' })).status, 400);

  const ok = await change({ current: 'starting-password', next: 'a-brand-new-pass', confirm: 'a-brand-new-pass' });
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Password changed/);
  const fresh = cookieFrom(ok);
  assert.match(fresh, /^admin_session=/);

  // the old cookie and the old password no longer work; the new cookie and password do
  assert.equal((await fetch(adm + '/admin', { headers: { Cookie: session }, redirect: 'manual' })).status, 303);
  assert.equal((await login('starting-password')).res.status, 401);
  assert.equal((await fetch(adm + '/admin', { headers: { Cookie: fresh } })).status, 200);
  const again = await login('a-brand-new-pass');
  assert.equal(again.res.status, 303);
  session = again.cookie;
});

test('logging out ends the session', async () => {
  const res = await fetch(adm + '/logout', post({}, { Cookie: session }));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/login');
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
});

test('repeated wrong passwords get blocked', async () => {
  let last;
  for (let i = 0; i < 7; i++) last = await login('guess-' + i);
  assert.equal(last.res.status, 429);
  // even the right password waits out the block
  assert.equal((await login('a-brand-new-pass')).res.status, 429);
});