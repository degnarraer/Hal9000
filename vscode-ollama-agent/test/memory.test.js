const test = require('node:test');
const assert = require('node:assert/strict');
const { SUMMARY_SCOPES, createMemoryStore, defaultSummaries } = require('../server/memory');

test('memory summary scopes define short, medium, and long horizons', () => {
  assert.deepEqual(Object.keys(SUMMARY_SCOPES), ['short', 'medium', 'long']);
  assert.equal(SUMMARY_SCOPES.short.limit < SUMMARY_SCOPES.medium.limit, true);
  assert.equal(SUMMARY_SCOPES.medium.limit < SUMMARY_SCOPES.long.limit, true);
});

test('defaultSummaries returns empty summaries for every scope', () => {
  const summaries = defaultSummaries();
  assert.equal(summaries.short.summary, '');
  assert.equal(summaries.medium.sourceMessageCount, 0);
  assert.equal(summaries.long.updatedAt, null);
});

test('buildPrompt includes saved memory summaries and recent transcript', () => {
  const memory = createMemoryStore({ warn() {}, error() {}, info() {} });
  const prompt = memory.buildPrompt(
    'What should we do next?',
    [{ role: 'user', content: 'I prefer concise implementation notes.' }],
    {
      short: { title: 'Short term memory', summary: 'The user is debugging chat memory.' },
      medium: { title: 'Medium term memory', summary: 'The user prefers backend behavior over frontend-only summaries.' },
      long: { title: 'Long term memory', summary: '' }
    }
  );

  assert.match(prompt, /<memory_summaries>/);
  assert.match(prompt, /Short term memory: The user is debugging chat memory\./);
  assert.match(prompt, /Medium term memory: The user prefers backend behavior/);
  assert.match(prompt, /<recent_transcript>/);
  assert.match(prompt, /Current user message:\nWhat should we do next\?/);
});

test('buildPrompt can use summaries without recent history', () => {
  const memory = createMemoryStore({ warn() {}, error() {}, info() {} });
  const prompt = memory.buildPrompt('Hello again', [], {
    long: { title: 'Long term memory', summary: 'The user likes HAL to remember durable preferences.' }
  });

  assert.match(prompt, /Long term memory: The user likes HAL/);
  assert.doesNotMatch(prompt, /<recent_transcript>/);
});

test('buildPrompt includes user factoids', () => {
  const memory = createMemoryStore({ warn() {}, error() {}, info() {} });
  const prompt = memory.buildPrompt('What do you remember?', [], {}, [
    { category: 'workflow', fact: 'The user prefers live backend memory over manual GUI regeneration.' }
  ]);

  assert.match(prompt, /<user_factoids>/);
  assert.match(prompt, /workflow: The user prefers live backend memory/);
});
