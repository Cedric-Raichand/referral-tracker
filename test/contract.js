import test from 'node:test';
import assert from 'node:assert/strict';

export function storeContract(label, makeStore) {
  let store;
  test(`${label}: set up`, async () => {
    store = await makeStore();
  });

  test(`${label}: usernames are unique`, async () => {
    assert.equal((await store.createReferrer({ name: 'John', phone: '0241111111', username: 'john' })).ok, true);
    const dup = await store.createReferrer({ name: 'Other', phone: '0242222222', username: 'john' });
    assert.deepEqual(dup, { ok: false, reason: 'username_taken' });
  });

  test(`${label}: joins are credited per referrer and per platform`, async () => {
    await store.createReferrer({ name: 'Mary', phone: '0243333333', username: 'mary' });
    const mary = await store.getReferrerByUsername('mary');
    assert.equal(mary.name, 'Mary');
    assert.equal((await store.addReferral({ referrer: mary, platform: 'whatsapp', name: 'A', contact: '0250000001' })).ok, true);
    assert.equal((await store.addReferral({ referrer: mary, platform: 'whatsapp', name: 'B', contact: '0250000002' })).ok, true);
    assert.equal((await store.addReferral({ referrer: mary, platform: 'instagram', name: 'A', contact: 'ama_k' })).ok, true);

    const board = await store.getLeaderboard();
    const row = board.find((r) => r.username === 'mary');
    assert.equal(row.total, 3);
    assert.equal(row.whatsapp, 2);
    assert.equal(row.instagram, 1);
    assert.equal(row.snapchat, 0);
    assert.equal(row.confirmed, 0);
    const john = board.find((r) => r.username === 'john');
    assert.equal(john.total, 0);
    assert.equal(board[0].username, 'mary'); // best first
  });

  test(`${label}: same person cannot be counted twice on one platform`, async () => {
    const mary = await store.getReferrerByUsername('mary');
    const again = await store.addReferral({ referrer: mary, platform: 'whatsapp', name: 'A', contact: '0250000001' });
    assert.deepEqual(again, { ok: false, reason: 'already_counted' });
    // ...even through a different referrer
    const john = await store.getReferrerByUsername('john');
    const other = await store.addReferral({ referrer: john, platform: 'whatsapp', name: 'A', contact: '0250000001' });
    assert.deepEqual(other, { ok: false, reason: 'already_counted' });
  });

  test(`${label}: self-referral is rejected on WhatsApp`, async () => {
    const mary = await store.getReferrerByUsername('mary');
    const self = await store.addReferral({ referrer: mary, platform: 'whatsapp', name: 'Mary', contact: '0243333333' });
    assert.deepEqual(self, { ok: false, reason: 'self_referral' });
  });

  test(`${label}: admin can confirm and un-confirm a referral`, async () => {
    const mary = await store.getReferrerByUsername('mary');
    const list = await store.getReferralsFor(mary.id);
    assert.equal(list.length, 3);
    const first = list[0];

    assert.equal((await store.getReferralById(first.id)).name, first.name);
    assert.equal(await store.setConfirmed(first.id, true), true);
    let row = (await store.getLeaderboard()).find((r) => r.username === 'mary');
    assert.equal(row.total, 3);
    assert.equal(row.confirmed, 1);

    assert.equal(await store.setConfirmed(first.id, false), true);
    row = (await store.getLeaderboard()).find((r) => r.username === 'mary');
    assert.equal(row.confirmed, 0);
  });

  test(`${label}: unknown or garbage ids are handled safely`, async () => {
    assert.equal(await store.setConfirmed('not-an-id', true), false);
    assert.equal(await store.setConfirmed('999999', true), false);
    assert.equal(await store.setConfirmed('ffffffffffffffffffffffff', true), false);
    assert.equal(await store.getReferralById('abc'), undefined);
    assert.equal(await store.getReferrerById('abc'), undefined);
  });

  test(`${label}: referrers can be found by id`, async () => {
    const mary = await store.getReferrerByUsername('mary');
    const again = await store.getReferrerById(mary.id);
    assert.equal(again.username, 'mary');
  });
}