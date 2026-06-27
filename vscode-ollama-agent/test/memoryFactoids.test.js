const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFactoids, parseFactoidExtraction } = require('../server/memoryFactoids');

test('parseFactoidExtraction reads the JSON object from model output', () => {
  const parsed = parseFactoidExtraction('Sure:\n{"factoids":[{"factKey":"name","category":"identity","fact":"The user is named Rob.","confidence":0.7}]}');

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].factKey, 'name');
});

test('normalizeFactoids keeps normalized factoid objects without semantic token checks', () => {
  const messages = [{ role: 'user', content: 'Hi, my name is Rob' }];
  const filtered = normalizeFactoids([
    { factKey: 'user-name', category: 'identity', fact: 'The user is named Rob.', confidence: 0.7 }
  ], messages);

  assert.equal(filtered.length, 1);
});

test('normalizeFactoids keeps LLM-selected router facts as schema-cleaned data', () => {
  const messages = [{ role: 'user', content: 'I want to buy a used car' }];
  const filtered = normalizeFactoids([
    { factKey: 'used-car-intent', category: 'general', fact: 'The user wants to buy a used car.', confidence: 1 }
  ], messages);

  assert.deepEqual(filtered, [
    { factKey: 'used-car-intent', category: 'general', fact: 'The user wants to buy a used car.', confidence: 1 }
  ]);
});

test('normalizeFactoids does not perform fragile semantic filtering', () => {
  const messages = [{ role: 'user', content: 'I want to buy a used car' }];
  const filtered = normalizeFactoids([
    { factKey: 'used-car-specific-model', category: 'general', fact: 'The user wants to buy a used car, specifically a Ford Maverick Lobo.', confidence: 1 }
  ], messages);

  assert.deepEqual(filtered, [
    { factKey: 'used-car-specific-model', category: 'general', fact: 'The user wants to buy a used car, specifically a Ford Maverick Lobo.', confidence: 1 }
  ]);
});

test('normalizeFactoids normalizes unsupported categories instead of trying to judge meaning', () => {
  const messages = [{ role: 'user', content: 'Hi, my name is Rob' }];
  const filtered = normalizeFactoids([
    {
      factKey: 'profile',
      category: 'identity|environment|workflow|constraint|general',
      fact: 'The user is named Rob and works in a quiet office with a large monitor. He prefers deep focus and often faces deadline constraints.',
      confidence: 0.7
    }
  ], messages);

  assert.deepEqual(filtered, [
    {
      factKey: 'profile',
      category: 'general',
      fact: 'The user is named Rob and works in a quiet office with a large monitor. He prefers deep focus and often faces deadline constraints.',
      confidence: 0.7
    }
  ]);
});

test('normalizeFactoids drops only empty fact text', () => {
  const messages = [{ role: 'user', content: "what's my name?" }];
  const filtered = normalizeFactoids([
    { factKey: 'empty', category: 'identity', fact: '', confidence: 1 }
  ], messages);

  assert.deepEqual(filtered, []);
});
