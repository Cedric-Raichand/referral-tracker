process.env.DB_PATH = ':memory:';

import test from 'node:test';
import assert from 'node:assert/strict';

// Imports are hoisted, so load the database module only after DB_PATH is set.
const {
  createReferrer, getReferrerByUsername, addReferral, getLeaderboard, getReferralsFor,
  setConfirmed, normalizePhone, normalizeContact, isValidContact,
} = await import('../src/db.js');

test('normalizePhone strips spaces and dashes', () => {
  assert.equal(normalizePhone('024 123-4567'), '0241234567');
  assert.equal(normalizePhone(' +233 24 123 4567 '), '+233241234567');
});

test('Snapchat and Instagram use usernames, WhatsApp uses phone numbers', () => {
  assert.equal(normalizeContact('snapchat', ' @Ama_K '), 'ama_k');
  assert.equal(normalizeContact('instagram', '@Kofi.M'), 'kofi.m');
  assert.equal(normalizeContact('whatsapp', '024 123 4567'), '0241234567');
  assert.equal(isValidContact('snapchat', 'ama_k'), true);
  assert.equal(isValidContact('snapchat', 'a'), false);
  assert.equal(isValidContact('instagram', 'bad name!'), false);
  assert.equal(isValidContact('whatsapp', '0241234567'), true);
  assert.equal(isValidContact('whatsapp', 'ama_k'), false);
});

test('usernames are unique', () => {
  assert.equal(createReferrer({ name: 'John', phone: '0241111111', username: 'john' }).ok, true);
  const dup = createReferrer({ name: 'Other', phone: '0242222222', username: 'john' });
  assert.deepEqual(dup, { ok: false, reason: 'username_taken' });
});

test('joins are credited per referrer and per platform', () => {
  createReferrer({ name: 'Mary', phone: '0243333333', username: 'mary' });
  const mary = getReferrerByUsername('mary');
  assert.equal(addReferral({ referrer: mary, platform: 'whatsapp', name: 'A', contact: '0250000001' }).ok, true);
  assert.equal(addReferral({ referrer: mary, platform: 'whatsapp', name: 'B', contact: '0250000002' }).ok, true);
  assert.equal(addReferral({ referrer: mary, platform: 'instagram', name: 'A', contact: 'ama_k' }).ok, true);

  const row = getLeaderboard().find((r) => r.username === 'mary');
  assert.equal(row.total, 3);
  assert.equal(row.whatsapp, 2);
  assert.equal(row.instagram, 1);
  assert.equal(row.snapchat, 0);
  assert.equal(row.confirmed, 0);
});

test('same person cannot be counted twice on one platform', () => {
  const mary = getReferrerByUsername('mary');
  const again = addReferral({ referrer: mary, platform: 'whatsapp', name: 'A', contact: '0250000001' });
  assert.deepEqual(again, { ok: false, reason: 'already_counted' });
});

test('self-referral is rejected on WhatsApp', () => {
  const mary = getReferrerByUsername('mary');
  const self = addReferral({ referrer: mary, platform: 'whatsapp', name: 'Mary', contact: '0243333333' });
  assert.deepEqual(self, { ok: false, reason: 'self_referral' });
});

test('admin can confirm and un-confirm a referral', () => {
  const mary = getReferrerByUsername('mary');
  const [first] = getReferralsFor(mary.id);

  assert.equal(setConfirmed(first.id, true), true);
  let row = getLeaderboard().find((r) => r.username === 'mary');
  assert.equal(row.total, 3);
  assert.equal(row.confirmed, 1);

  assert.equal(setConfirmed(first.id, false), true);
  row = getLeaderboard().find((r) => r.username === 'mary');
  assert.equal(row.confirmed, 0);

  assert.equal(setConfirmed(99999, true), false);
});