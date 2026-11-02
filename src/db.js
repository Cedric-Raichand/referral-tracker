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

/** Clean what a newcomer typed: a phone number for WhatsApp, a handle (no @) for Snapchat/Instagram. */
export function normalizeContact(platformKey, input) {
  if (config.platforms[platformKey]?.contact === 'username') {
    return String(input || '').trim().replace(/^@/, '').toLowerCase();
  }
  return normalizePhone(input);
}

export function isValidContact(platformKey, value) {
  if (config.platforms[platformKey]?.contact === 'username') {
    return /^[a-z0-9._-]{2,30}$/.test(value);
  }
  return isValidPhone(value);
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

export function getReferrerById(id) {
  return db.prepare('SELECT * FROM referrers WHERE id = ?').get(id);
}

export function addReferral({ referrer, platform, name, contact }) {
  if (!platformKeys.includes(platform)) return { ok: false, reason: 'bad_platform' };
  if (config.platforms[platform].contact === 'phone' && contact === referrer.phone) {
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
}

export function getReferralById(id) {
  return db.prepare('SELECT * FROM referrals WHERE id = ?').get(id);
}

/** The admin ticks (or un-ticks) a person after checking they really joined. */
export function setConfirmed(referralId, confirmed) {
  const when = confirmed ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;
  const info = db
    .prepare('UPDATE referrals SET confirmed = ?, confirmed_at = ? WHERE id = ?')
    .run(confirmed ? 1 : 0, when, referralId);
  return info.changes > 0;
}

/** One row per referrer: referred per platform, total referred, and confirmed. Best first. */
export function getLeaderboard() {
  const rows = db
    .prepare(
      `SELECT r.id, r.name, r.phone, r.username,
              COUNT(f.id) AS total,
              SUM(CASE WHEN f.confirmed = 1 THEN 1 ELSE 0 END) AS confirmed,
              ${platformKeys
                .map((p) => `SUM(CASE WHEN f.platform = '${p}' THEN 1 ELSE 0 END) AS ${p}`)
                .join(',\n              ')}
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
}

export function getReferralsFor(referrerId) {
  return db
    .prepare('SELECT * FROM referrals WHERE referrer_id = ? ORDER BY created_at DESC, id DESC')
    .all(referrerId);
}