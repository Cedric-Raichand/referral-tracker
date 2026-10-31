import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config, platformKeys } from './config.js';

if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS referrers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL,
    username   TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS referrals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id INTEGER NOT NULL REFERENCES referrers(id),
    platform    TEXT NOT NULL,
    name        TEXT NOT NULL,
    phone       TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (platform, phone)
  );
`);

/** Keep digits and a leading +, so "024 123 4567" and "0241234567" match. */
export function normalizePhone(input) {
  const raw = String(input || '').trim();
  const plus = raw.startsWith('+') ? '+' : '';
  return plus + raw.replace(/\D/g, '');
}

export function normalizeUsername(input) {
  return String(input || '').trim().toLowerCase();
}

export function isValidUsername(username) {
  return /^[a-z0-9_]{3,20}$/.test(username);
}

export function isValidPhone(phone) {
  return /^\+?\d{7,15}$/.test(phone);
}

export function createReferrer({ name, phone, username }) {
  try {
    const info = db
      .prepare('INSERT INTO referrers (name, phone, username) VALUES (?, ?, ?)')
      .run(name, phone, username);
    return { ok: true, id: Number(info.lastInsertRowid) };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return { ok: false, reason: 'username_taken' };
    throw err;
  }
}

export function getReferrerByUsername(username) {
  return db.prepare('SELECT * FROM referrers WHERE username = ?').get(username);
}

export function addReferral({ referrer, platform, name, phone }) {
  if (!platformKeys.includes(platform)) return { ok: false, reason: 'bad_platform' };
  if (phone === referrer.phone) return { ok: false, reason: 'self_referral' };
  try {
    db.prepare(
      'INSERT INTO referrals (referrer_id, platform, name, phone) VALUES (?, ?, ?, ?)',
    ).run(referrer.id, platform, name, phone);
    return { ok: true };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return { ok: false, reason: 'already_counted' };
    throw err;
  }
}

/** One row per referrer with a count per platform and a total, best first. */
export function getLeaderboard() {
  const rows = db
    .prepare(
      `SELECT r.id, r.name, r.phone, r.username,
              COUNT(f.id) AS total,
              ${platformKeys
                .map((p) => `SUM(CASE WHEN f.platform = '${p}' THEN 1 ELSE 0 END) AS ${p}`)
                .join(',\n              ')}
       FROM referrers r
       LEFT JOIN referrals f ON f.referrer_id = r.id
       GROUP BY r.id
       ORDER BY total DESC, r.created_at ASC`,
    )
    .all();
  return rows.map((row) => ({ ...row, ...Object.fromEntries(platformKeys.map((p) => [p, row[p] || 0])) }));
}

export function getReferralsFor(referrerId) {
  return db
    .prepare('SELECT * FROM referrals WHERE referrer_id = ? ORDER BY created_at DESC, id DESC')
    .all(referrerId);
}