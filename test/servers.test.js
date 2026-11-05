// Both sites run in this one test process and share one in-memory database,
// which is the same idea as two hosted sites sharing one MongoDB.
process.env.DB_PATH = ':memory:';
process.env.ADMIN_PASSWORD = 'secret';
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

const login = { Authorization: `Basic ${Buffer.from('anyone:secret').toString('base64')}` };
const form = (data) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(data),
  redirect: 'manual',
});

test('the public site has no admin pages', async () => {
  for (const path of ['/admin', '/admin/bulk', '/admin/jeanette']) {
    assert.equal((await fetch(pub + path, { headers: login })).status, 404, path);
  }
  const home = await (await fetch(pub + '/')).text();
  assert.equal(home.includes('Admin login'), false);
});

test('the admin site asks for the password on every page', async () => {
  assert.equal((await fetch(adm + '/admin')).status, 401);
  assert.equal((await fetch(adm + '/nothing-here')).status, 401);
  const wrong = { Authorization: `Basic ${Buffer.from('a:wrong').toString('base64')}` };
  assert.equal((await fetch(adm + '/admin', { headers: wrong })).status, 401);
  assert.equal((await fetch(adm + '/admin', { headers: login })).status, 200);
  const root = await fetch(adm + '/', { headers: login, redirect: 'manual' });
  assert.equal(root.status, 303);
  assert.equal(root.headers.get('location'), '/admin');
});

test('the admin site has no registration or join pages', async () => {
  assert.equal((await fetch(adm + '/r/jeanette', { headers: login })).status, 404);
  const reg = await fetch(adm + '/register', { ...form({ name: 'X' }), headers: login });
  assert.equal(reg.status, 404);
});

test('what happens on the public site shows up on the admin site', async () => {
  const reg = await fetch(pub + '/register', form({ name: 'Jeanette', phone: '0241111111', username: 'jeanette' }));
  assert.equal(reg.status, 303);

  const chooser = await (await fetch(pub + '/r/jeanette')).text();
  assert.match(chooser, /Join WhatsApp group/);
  assert.match(chooser, /Join Snapchat/);

  await fetch(pub + '/r/jeanette/whatsapp', form({ name: 'Ama', contact: '025 000 0001' }));
  await fetch(pub + '/r/jeanette/whatsapp', form({ name: 'Kofi', contact: '0250000002' }));
  await fetch(pub + '/r/jeanette/snapchat', form({ name: 'Ama', contact: '@Ama_K' }));

  let dash = await (await fetch(adm + '/admin', { headers: login })).text();
  assert.match(dash, /1 referrers &middot; 3 referred &middot; 0 confirmed/);

  // confirm one person from the admin site
  const detail = await (await fetch(adm + '/admin/jeanette', { headers: login })).text();
  const id = detail.match(/name="id" value="([^"]+)"/)[1];
  const confirm = await fetch(adm + '/admin/confirm', { ...form({ id, value: '1' }), headers: { ...login, 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(confirm.status, 303);
  dash = await (await fetch(adm + '/admin', { headers: login })).text();
  assert.match(dash, /3 referred &middot; 1 confirmed/);
});

test('bulk confirm works on the admin site', async () => {
  const body = form({ members: 'Someone\n+233 25 000 0001\n+233 25 000 0002' });
  const res = await fetch(adm + '/admin/bulk', { ...body, headers: { ...login, 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(res.status, 200);
  const dash = await (await fetch(adm + '/admin', { headers: login })).text();
  // one person was already confirmed by hand, the bulk list adds the two WhatsApp people
  assert.match(dash, /3 referred &middot; 3 confirmed/);
});

test('admin form posts from another website are blocked', async () => {
  const res = await fetch(adm + '/admin/bulk', {
    method: 'POST',
    headers: { ...login, 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example' },
    body: new URLSearchParams({ members: '+233 25 000 0001' }),
  });
  assert.equal(res.status, 403);
});