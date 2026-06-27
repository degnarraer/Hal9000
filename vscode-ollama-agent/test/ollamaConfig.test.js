const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cleanKeepAlive, createOllamaConfigStore, normalizeOllamaConfig, ollamaKeepAlivePayload } = require('../server/ollamaConfig');

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

test('ollamaKeepAlivePayload converts load controls to Ollama API values', () => {
  assert.equal(ollamaKeepAlivePayload('-1'), -1);
  assert.equal(ollamaKeepAlivePayload('0'), 0);
  assert.equal(ollamaKeepAlivePayload('30m'), '30m');
});

test('normalizeOllamaConfig supports keep_alive payloads', () => {
  assert.deepEqual(normalizeOllamaConfig({ keep_alive: '30m' }), {
    defaultModel: process.env.OLLAMA_MODEL || '',
    keepAlive: '30m',
    activeKeepAlive: '-1',
    idleUnloadDelayMs: 30000,
    presenceTtlMs: 45000
  });
});

test('normalizeOllamaConfig supports active-user model residency settings', () => {
  assert.deepEqual(normalizeOllamaConfig({
    keepAlive: '5m',
    activeKeepAlive: '-1',
    idleUnloadDelayMs: 60000,
    presenceTtlMs: 90000
  }), {
    defaultModel: process.env.OLLAMA_MODEL || '',
    keepAlive: '5m',
    activeKeepAlive: '-1',
    idleUnloadDelayMs: 60000,
    presenceTtlMs: 90000
  });
});

test('normalizeOllamaConfig persists the default model', () => {
  assert.equal(normalizeOllamaConfig({ defaultModel: 'qwen3.5:9b' }).defaultModel, 'qwen3.5:9b');
  assert.equal(normalizeOllamaConfig({ default_model: 'AUTO' }).defaultModel, process.env.OLLAMA_MODEL || '');
});

test('ollama config does not hardcode a model fallback', () => {
  const source = fs.readFileSync('server/ollamaConfig.js', 'utf8');
  assert.doesNotMatch(source, /llama2/);
  assert.match(source, /defaultModel: process\.env\.OLLAMA_MODEL \|\| ''/);
});

test('createOllamaConfigStore reloads the saved default model from disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-config-'));
  const configPath = path.join(dir, 'ollama.config.json');

  const first = createOllamaConfigStore(null, { configPath });
  first.save({ defaultModel: 'qwen3.5:9b' });

  const second = createOllamaConfigStore(null, { configPath });
  assert.equal(second.current().defaultModel, 'qwen3.5:9b');
});
