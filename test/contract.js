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

  test(`${label}: list a platform's referrals and confirm many at once`, async () => {
    const wa = await store.getReferralsByPlatform('whatsapp');
    assert.equal(wa.length, 2);
    assert.deepEqual(wa.map((r) => r.contact).sort(), ['0250000001', '0250000002']);
    assert.equal((await store.getReferralsByPlatform('snapchat')).length, 0);

    const changed = await store.setConfirmedMany(wa.map((r) => r.id), true);
    assert.equal(changed, 2);
    const after = await store.getReferralsByPlatform('whatsapp');
    assert.equal(after.every((r) => r.confirmed), true);
    const row = (await store.getLeaderboard()).find((r) => r.username === 'mary');
    assert.equal(row.confirmed, 2);

    assert.equal(await store.setConfirmedMany(['nope', '999999'], true), 0);
    await store.setConfirmedMany(wa.map((r) => r.id), false);
    const reset = await store.getReferralsByPlatform('whatsapp');
    assert.equal(reset.every((r) => !r.confirmed), true);
  });

  test(`${label}: settings can be saved and changed`, async () => {
    assert.equal(await store.getSetting('admin_password'), undefined);
    await store.setSetting('admin_password', 'first');
    assert.equal(await store.getSetting('admin_password'), 'first');
    await store.setSetting('admin_password', 'second');
    assert.equal(await store.getSetting('admin_password'), 'second');
    assert.equal(await store.getSetting('something_else'), undefined);
  });

  test(`${label}: deleting a referrer removes them and the people they referred`, async () => {
    await store.createReferrer({ name: 'Temp', phone: '0246666666', username: 'temp' });
    await store.createReferrer({ name: 'Other', phone: '0247777777', username: 'other' });
    const temp = await store.getReferrerByUsername('temp');
    const other = await store.getReferrerByUsername('other');
    await store.addReferral({ referrer: temp, platform: 'whatsapp', name: 'T1', contact: '0261000001' });
    await store.addReferral({ referrer: temp, platform: 'instagram', name: 'T2', contact: 'temp_fan' });
    await store.addReferral({ referrer: other, platform: 'whatsapp', name: 'O1', contact: '0261000002' });

    const result = await store.deleteReferrer(temp.id);
    assert.deepEqual(result, { ok: true, removedReferrals: 2 });

    assert.equal(await store.getReferrerByUsername('temp'), undefined);
    assert.equal(await store.getReferrerById(temp.id), undefined);
    assert.equal((await store.getLeaderboard()).some((r) => r.username === 'temp'), false);
    assert.equal((await store.getReferralsFor(other.id)).length, 1); // the other referrer is untouched

    // their username and the people they referred can be used again
    assert.equal((await store.createReferrer({ name: 'Temp again', phone: '0246666666', username: 'temp' })).ok, true);
    const added = await store.addReferral({ referrer: other, platform: 'whatsapp', name: 'T1', contact: '0261000001' });
    assert.equal(added.ok, true);

    assert.deepEqual(await store.deleteReferrer(temp.id), { ok: false }); // already gone
    assert.deepEqual(await store.deleteReferrer('not-an-id'), { ok: false });
  });
}