import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, normalizeContact, isValidContact } from '../src/validate.js';

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