import { config as appConfig, platformKeys } from '../config.js';

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const isObjectIdString = (value) => /^[0-9a-fA-F]{24}$/.test(String(value));
const isDuplicate = (err) => err && (err.code === 11000 || String(err.message).includes('E11000'));

/**
 * MongoDB Atlas storage. Ids are exposed as plain strings (the ObjectId hex) so the rest of the app
 * treats them the same way as the SQLite ids.
 * `driver` can be injected for tests; in production the real `mongodb` package is loaded.
 */
export async function createStore({ mongoUri, mongoDb }, driver) {
  const { MongoClient, ObjectId } = driver || (await import('mongodb'));

  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const database = client.db(mongoDb);
  const referrers = database.collection('referrers');
  const referrals = database.collection('referrals');
  const settings = database.collection('settings');

  await referrers.createIndex({ username: 1 }, { unique: true });
  await referrals.createIndex({ platform: 1, contact: 1 }, { unique: true });
  await referrals.createIndex({ referrer_id: 1 });

  const toRow = (doc) => {
    if (!doc) return undefined;
    const { _id, ...rest } = doc;
    return { id: String(_id), ...rest };
  };

  return {
    kind: 'MongoDB',

    async getSetting(key) {
      const doc = await settings.findOne({ _id: key });
      return doc ? doc.value : undefined;
    },

    async setSetting(key, value) {
      await settings.updateOne({ _id: key }, { $set: { value: String(value) } }, { upsert: true });
    },

    async createReferrer({ name, phone, username }) {
      try {
        const result = await referrers.insertOne({ name, phone, username, created_at: now() });
        return { ok: true, id: String(result.insertedId) };
      } catch (err) {
        if (isDuplicate(err)) return { ok: false, reason: 'username_taken' };
        throw err;
      }
    },

    async getReferrerByUsername(username) {
      return toRow(await referrers.findOne({ username }));
    },

    async getReferrerById(id) {
      if (!isObjectIdString(id)) return undefined;
      return toRow(await referrers.findOne({ _id: new ObjectId(String(id)) }));
    },

    async addReferral({ referrer, platform, name, contact }) {
      if (!platformKeys.includes(platform)) return { ok: false, reason: 'bad_platform' };
      if (appConfig.platforms[platform].contact === 'phone' && contact === referrer.phone) {
        return { ok: false, reason: 'self_referral' };
      }
      try {
        await referrals.insertOne({
          referrer_id: String(referrer.id),
          platform,
          name,
          contact,
          confirmed: false,
          confirmed_at: null,
          created_at: now(),
        });
        return { ok: true };
      } catch (err) {
        if (isDuplicate(err)) return { ok: false, reason: 'already_counted' };
        throw err;
      }
    },

    async getReferralById(id) {
      if (!isObjectIdString(id)) return undefined;
      return toRow(await referrals.findOne({ _id: new ObjectId(String(id)) }));
    },

    async setConfirmed(referralId, confirmed) {
      if (!isObjectIdString(referralId)) return false;
      const result = await referrals.updateOne(
        { _id: new ObjectId(String(referralId)) },
        { $set: { confirmed: Boolean(confirmed), confirmed_at: confirmed ? now() : null } },
      );
      return result.matchedCount > 0;
    },

    async getReferralsByPlatform(platform) {
      const docs = await referrals.find({ platform }).toArray();
      return docs.map((doc) => {
        const row = toRow(doc);
        return { id: row.id, name: row.name, contact: row.contact, confirmed: row.confirmed ? 1 : 0 };
      });
    },

    /** Confirm (or un-confirm) many people at once. Returns how many were matched. */
    async setConfirmedMany(ids, confirmed) {
      const objectIds = ids.filter(isObjectIdString).map((id) => new ObjectId(String(id)));
      if (!objectIds.length) return 0;
      const result = await referrals.updateMany(
        { _id: { $in: objectIds } },
        { $set: { confirmed: Boolean(confirmed), confirmed_at: confirmed ? now() : null } },
      );
      return result.matchedCount;
    },

    async getLeaderboard() {
      const [people, groups] = await Promise.all([
        referrers.find({}).toArray(),
        referrals
          .aggregate([
            {
              $group: {
                _id: { r: '$referrer_id', p: '$platform' },
                n: { $sum: 1 },
                c: { $sum: { $cond: ['$confirmed', 1, 0] } },
              },
            },
          ])
          .toArray(),
      ]);

      const stats = new Map();
      for (const g of groups) {
        const entry = stats.get(g._id.r) || { total: 0, confirmed: 0, perPlatform: {} };
        entry.total += g.n;
        entry.confirmed += g.c;
        entry.perPlatform[g._id.p] = (entry.perPlatform[g._id.p] || 0) + g.n;
        stats.set(g._id.r, entry);
      }

      return people
        .map((doc) => {
          const row = toRow(doc);
          const entry = stats.get(row.id) || { total: 0, confirmed: 0, perPlatform: {} };
          return {
            id: row.id,
            name: row.name,
            phone: row.phone,
            username: row.username,
            created_at: row.created_at,
            total: entry.total,
            confirmed: entry.confirmed,
            ...Object.fromEntries(platformKeys.map((p) => [p, entry.perPlatform[p] || 0])),
          };
        })
        .sort((a, b) => b.total - a.total || String(a.created_at).localeCompare(String(b.created_at)));
    },

    async getReferralsFor(referrerId) {
      const docs = await referrals
        .find({ referrer_id: String(referrerId) })
        .sort({ created_at: -1, _id: -1 })
        .toArray();
      return docs.map(toRow);
    },
  };
}