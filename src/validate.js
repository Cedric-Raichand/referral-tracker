import { config } from './config.js';

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