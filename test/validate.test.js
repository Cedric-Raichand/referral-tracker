import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhone, normalizeContact, isValidContact, phoneKey, extractPhoneKeys,
} from '../src/validate.js';

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

test('local and international versions of a number match', () => {
  assert.equal(phoneKey('0241234567'), phoneKey('+233 24 123 4567'));
  assert.equal(phoneKey('12345'), '');
});

test('numbers are pulled out of pasted text', () => {
  const text = `Ama Mensah
+233 24 123 4567
Kofi
055-123-4568, +1 (415) 555-0172
joined 2026
0200000000 0210000000`;
  const keys = extractPhoneKeys(text);
  assert.equal(keys.has(phoneKey('0241234567')), true);
  assert.equal(keys.has(phoneKey('0551234568')), true);
  assert.equal(keys.has(phoneKey('+14155550172')), true);
  assert.equal(keys.has('000002026'), false); // a year is not a phone number
  assert.equal(keys.size, 3);
});