import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config as appConfig, platformKeys } from '../config.js';

/** Local file storage. Great for development and small setups with a persistent disk. */
export function createStore({ dbPath }) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);

  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS referrers (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      phone      TEXT NOT NULL,
      username   TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- contact is a phone number (WhatsApp) or a handle (Snapchat, Instagram)
    CREATE TABLE IF NOT EXISTS referrals (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id  INTEGER NOT NULL REFERENCES referrers(id),
      platform     TEXT NOT NULL,
      name         TEXT NOT NULL,
      contact      TEXT NOT NULL,
      confirmed    INTEGER NOT NULL DEFAULT 0,
      confirmed_at TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (platform, contact)
    );
  `);

  const toId = (value) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  return {
    kind: 'SQLite file',

    async createReferrer({ name, phone, username }) {
      try {
        const info = db
          .prepare('INSERT INTO referrers (name, phone, username) VALUES (?, ?, ?)')
          .run(name, phone, username);
        return { ok: true, id: Number(info.lastInsertRowid) };
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) return { ok: false, reason: 'username_taken' };
        throw err;
      }
    },

    async getReferrerByUsername(username) {
      return db.prepare('SELECT * FROM referrers WHERE username = ?').get(username);
    },

    async getReferrerById(id) {
      const n = toId(id);
      return n ? db.prepare('SELECT * FROM referrers WHERE id = ?').get(n) : undefined;
    },

    async addReferral({ referrer, platform, name, contact }) {
      if (!platformKeys.includes(platform)) return { ok: false, reason: 'bad_platform' };
      if (appConfig.platforms[platform].contact === 'phone' && contact === referrer.phone) {
        return { ok: false, reason: 'self_referral' };
      }
      try {
        db.prepare(
          'INSERT INTO referrals (referrer_id, platform, name, contact) VALUES (?, ?, ?, ?)',
        ).run(referrer.id, platform, name, contact);
        return { ok: true };
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) return { ok: false, reason: 'already_counted' };
        throw err;
      }
    },

    async getReferralById(id) {
      const n = toId(id);
      return n ? db.prepare('SELECT * FROM referrals WHERE id = ?').get(n) : undefined;
    },

    /** The admin ticks (or un-ticks) a person after checking they really joined. */
    async setConfirmed(referralId, confirmed) {
      const n = toId(referralId);
      if (!n) return false;
      const when = confirmed ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;
      const info = db
        .prepare('UPDATE referrals SET confirmed = ?, confirmed_at = ? WHERE id = ?')
        .run(confirmed ? 1 : 0, when, n);
      return info.changes > 0;
    },

    /** One row per referrer: referred per platform, total referred, and confirmed. Best first. */
    async getLeaderboard() {
      const rows = db
        .prepare(
          `SELECT r.id, r.name, r.phone, r.username,
                  COUNT(f.id) AS total,
                  SUM(CASE WHEN f.confirmed = 1 THEN 1 ELSE 0 END) AS confirmed,
                  ${platformKeys
                    .map((p) => `SUM(CASE WHEN f.platform = '${p}' THEN 1 ELSE 0 END) AS ${p}`)
                    .join(',\n                  ')}
           FROM referrers r
           LEFT JOIN referrals f ON f.referrer_id = r.id
           GROUP BY r.id
           ORDER BY total DESC, r.created_at ASC`,
        )
        .all();
      return rows.map((row) => ({
        ...row,
        confirmed: row.confirmed || 0,
        ...Object.fromEntries(platformKeys.map((p) => [p, row[p] || 0])),
      }));
    },

    async getReferralsFor(referrerId) {
      return db
        .prepare('SELECT * FROM referrals WHERE referrer_id = ? ORDER BY created_at DESC, id DESC')
        .all(referrerId);
    },
  };
}