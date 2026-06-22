const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanKeepAlive, normalizeOllamaConfig } = require('../server/ollamaConfig');

test('cleanKeepAlive accepts Ollama duration values and load controls', () => {
  assert.equal(cleanKeepAlive('30m'), '30m');
  assert.equal(cleanKeepAlive('1H'), '1h');
  assert.equal(cleanKeepAlive('-1'), '-1');
  assert.equal(cleanKeepAlive('0'), '0');
});

test('cleanKeepAlive falls back for unsafe values', () => {
  assert.equal(cleanKeepAlive('forever'), '5m');
  assert.equal(cleanKeepAlive(''), '5m');
});

test('normalizeOllamaConfig supports keep_alive payloads', () => {
  assert.deepEqual(normalizeOllamaConfig({ keep_alive: '30m' }), { keepAlive: '30m' });
});
