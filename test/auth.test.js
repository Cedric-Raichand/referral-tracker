import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword, verifyPasswordHash, makeSessionToken, verifySessionToken, parseCookies, createLimiter,
} from '../src/auth.js';

test('passwords are stored as salted hashes and checked correctly', async () => {
  const a = await hashPassword('correct horse battery');
  const b = await hashPassword('correct horse battery');
  assert.notEqual(a, b); // different salt each time
  assert.equal(a.includes('correct horse'), false);
  assert.equal(await verifyPasswordHash('correct horse battery', a), true);
  assert.equal(await verifyPasswordHash('wrong', a), false);
  assert.equal(await verifyPasswordHash('anything', 'not-a-hash'), false);
});

test('login cookies expire and break when the key changes', () => {
  const now = 1_000_000;
  const token = makeSessionToken('key-one', now, 1000);
  assert.equal(verifySessionToken(token, 'key-one', now + 500), true);
  assert.equal(verifySessionToken(token, 'key-one', now + 2000), false); // expired
  assert.equal(verifySessionToken(token, 'key-two', now + 500), false); // password changed
  assert.equal(verifySessionToken('garbage', 'key-one', now), false);
  assert.equal(verifySessionToken('', 'key-one', now), false);
  assert.equal(verifySessionToken(`${now + 5000}.deadbeef`, 'key-one', now), false);
});

test('cookies are parsed', () => {
  assert.deepEqual(parseCookies('a=1; admin_session=abc.def; b=2'), { a: '1', admin_session: 'abc.def', b: '2' });
  assert.deepEqual(parseCookies(undefined), {});
});

test('too many failures block, and the block ends after the window', () => {
  const limiter = createLimiter({ max: 3, windowMs: 1000 });
  for (let i = 0; i < 3; i++) limiter.fail('ip', 0);
  assert.equal(limiter.blocked('ip', 500), true);
  assert.equal(limiter.blocked('other', 500), false);
  assert.equal(limiter.blocked('ip', 1500), false);
  limiter.fail('ip', 2000);
  limiter.reset('ip');
  assert.equal(limiter.blocked('ip', 2001), false);
});