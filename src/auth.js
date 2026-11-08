import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

/** Store passwords as a salted scrypt hash, never as plain text. */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPasswordHash(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const sign = (key, data) => createHmac('sha256', key).update(data).digest('hex');

/**
 * A login cookie value: "expiry.signature". The signing key comes from the current password,
 * so changing the password logs out every old session.
 */
export function makeSessionToken(key, now = Date.now(), ttlMs = 7 * 24 * 60 * 60 * 1000) {
  const expires = String(now + ttlMs);
  return `${expires}.${sign(key, expires)}`;
}

export function verifySessionToken(token, key, now = Date.now()) {
  const [expires, signature] = String(token || '').split('.');
  if (!expires || !signature || !/^\d+$/.test(expires) || Number(expires) < now) return false;
  const expected = Buffer.from(sign(key, expires));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** Basic protection against guessing: too many failures from one address blocks it for a while. */
export function createLimiter({ max = 5, windowMs = 15 * 60 * 1000 } = {}) {
  const failures = new Map();
  const recent = (key, now) => (failures.get(key) || []).filter((t) => now - t < windowMs);
  return {
    blocked(key, now = Date.now()) {
      return recent(key, now).length >= max;
    },
    fail(key, now = Date.now()) {
      failures.set(key, [...recent(key, now), now]);
    },
    reset(key) {
      failures.delete(key);
    },
  };
}