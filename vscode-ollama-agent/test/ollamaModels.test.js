const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FALLBACK_MODELS,
  normalizeModels,
  parseLibraryModels,
  parseModelRef,
  formatModelRef
} = require('../server/ollamaModels');

test('fallback model catalog includes current Llama families', () => {
  const names = new Set(FALLBACK_MODELS.map(model => model.name));

  assert.equal(names.has('llama3'), true);
  assert.equal(names.has('llama3.1'), true);
  assert.equal(names.has('llama3.2'), true);
  assert.equal(names.has('llama3.3'), true);
  assert.equal(names.has('qwen3.5'), true);
});

test('normalizeModels returns UI-ready model entries with unique tags', () => {
  const models = normalizeModels([
    { name: 'llama3', description: 'Meta Llama 3', tags: ['8B', '8b'] },
    { name: 'llama3', tags: ['70B'] }
  ]);

  assert.deepEqual(models, [
    {
      name: 'llama3',
      description: 'Meta Llama 3',
      tags: ['8b', '70b'],
      url: 'https://ollama.com/library/llama3'
    }
  ]);
});

test('parseLibraryModels extracts model names and tags from Ollama library markup', () => {
  const html = `
    <a href="/library/llama3.2">
      <span>llama3.2</span>
      <p>Meta's Llama 3.2 goes small with 1B and 3B models.</p>
      <span>tools</span><span>1b</span><span>3b</span>
    </a>
    <a href="/library/qwen3">
      <span>qwen3</span>
      <p>Qwen3 is the latest generation of large language models.</p>
      <span>0.6b</span><span>8b</span><span>235b</span>
    </a>
  `;

  const names = parseLibraryModels(html).map(model => model.name);
  const llama = parseLibraryModels(html).find(model => model.name === 'llama3.2');

  assert.deepEqual(names, ['llama3.2', 'qwen3']);
  assert.deepEqual(llama.tags, ['1b', '3b']);
  assert.equal(llama.url, 'https://ollama.com/library/llama3.2');
});

test('model reference helpers round-trip name and tag', () => {
  assert.deepEqual(parseModelRef('llama3.2:3b'), { name: 'llama3.2', tag: '3b' });
  assert.equal(formatModelRef('llama3.2', '3b'), 'llama3.2:3b');
  assert.equal(formatModelRef('llama3.2', 'latest'), 'llama3.2');
});
