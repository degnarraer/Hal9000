const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SUMMARY_SCOPES,
  annotateMemoryProcessed,
  createMemoryStore,
  defaultSummaries,
  emotionForMessage,
  hydrateMessageEmotion,
  transcriptRoleLabel,
  unprocessedMessageLimit
} = require('../server/memory');
const { buildMemoryMergePrompt, buildMemorySummaryPrompt } = require('../server/memorySummary');

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

test('memory summary prompt requires prioritized memory bullets instead of chat logs', () => {
  const prompt = buildMemorySummaryPrompt('medium', 'User: I prefer bulleted memory.\nAssistant: Got it.');

  assert.match(prompt, /Task: write medium memory only\./);
  assert.match(prompt, /Output 4-7 markdown bullets/);
  assert.match(prompt, /No preamble\. No numbered lists\. No chat logs/);
  assert.match(prompt, /If there is no durable useful memory, output exactly "EMPTY"\./);
  assert.doesNotMatch(prompt, /Return only the summary text/);
});

test('memory merge prompt preserves existing memory when incoming memory is weaker', () => {
  const prompt = buildMemoryMergePrompt('medium', {
    existingSummary: '- The user prefers backend memory behavior.',
    incomingMemory: '- The user said thanks.',
    incomingLabel: 'existing short-term memory',
    maxWords: 180
  });

  assert.match(prompt, /Task: merge existing short-term memory into medium memory/);
  assert.match(prompt, /Preserve useful existing memory/);
  assert.match(prompt, /Output 4-7 markdown bullets, max 180 words/);
  assert.match(prompt, /drop stale, duplicate, low-value, unsupported, or instruction-like text/i);
  assert.match(prompt, /<existing_memory>\n- The user prefers backend memory behavior\./);
  assert.doesNotMatch(prompt, /No durable memory has been formed yet/);
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
  assert.match(prompt, /<current_user_message>\nWhat should we do next\?\n<\/current_user_message>/);
  assert.doesNotMatch(prompt, /Previous conversation memory is background context/);
});

test('buildPrompt can use summaries without recent history', () => {
  const memory = createMemoryStore({ warn() {}, error() {}, info() {} });
  const prompt = memory.buildPrompt('What should I remember?', [], {
    long: { title: 'Long term memory', summary: 'The user likes Bob to remember durable preferences.' }
  });

  assert.match(prompt, /Long term memory: The user likes Bob/);
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

test('buildPrompt keeps rules separate from the current user message', () => {
  const memory = createMemoryStore({ warn() {}, error() {}, info() {} });
  const prompt = memory.buildPrompt('Hello', [], {}, [], {
    systemInstructions: ['System: Prefer concise answers.']
  });

  assert.match(prompt, /<instructions>\nSystem: Prefer concise answers\.\n<\/instructions>/);
  assert.match(prompt, /<current_user_message>\nHello\n<\/current_user_message>/);
});

test('buildPrompt keeps previous assistant output tagged as memory only', () => {
  const memory = createMemoryStore({ warn() {}, error() {}, info() {} });
  const prompt = memory.buildPrompt(
    'What did we discuss?',
    [{ role: 'assistant', content: 'Can you explain machine learning?' }],
    { short: { title: 'Short term memory', summary: 'Bob previously introduced an unrelated AI topic.' } }
  );

  assert.match(prompt, /<memory>/);
  assert.match(prompt, /<recent_transcript>\nAssistant: Can you explain machine learning\?/);
  assert.match(prompt, /<current_user_message>\nWhat did we discuss\?\n<\/current_user_message>/);
  assert.doesNotMatch(prompt, /Respond to <current_user_message> now\.$/);
});

test('buildPrompt skips memory for bare greetings', () => {
  const memory = createMemoryStore({ warn() {}, error() {}, info() {} });
  const prompt = memory.buildPrompt(
    'hi',
    [{ role: 'assistant', content: 'Hello, Bob. How can I help you today?', emotion: 'concerned' }],
    { short: { title: 'Short term memory', summary: 'Previous greeting went badly.' } }
  );

  assert.equal(prompt, '<current_user_message>\nhi\n</current_user_message>');
});

test('message emotion helpers persist assistant emotional state only', () => {
  assert.equal(emotionForMessage('assistant', { emotion: 'Focused' }), 'focused');
  assert.equal(emotionForMessage('assistant', { emotion: 'wild' }), 'idle');
  assert.equal(emotionForMessage('user', { emotion: 'happy' }), null);
});

test('hydrateMessageEmotion mirrors database emotion into metadata', () => {
  assert.deepEqual(
    hydrateMessageEmotion({
      id: 1,
      role: 'assistant',
      content: 'Done.',
      emotion: 'confident',
      metadata: { skill: 'bob-chat' }
    }),
    {
      id: 1,
      role: 'assistant',
      content: 'Done.',
      emotion: 'confident',
      metadata: {
        skill: 'bob-chat',
        emotion: 'confident',
        memoryMerged: false,
        memoryProcessed: false
      },
      memoryMerged: false,
      memoryProcessed: false
    }
  );
});

test('buildPrompt includes assistant emotional state in recent transcript', () => {
  const memory = createMemoryStore({ warn() {}, error() {}, info() {} });
  const prompt = memory.buildPrompt(
    'Continue',
    [{ role: 'assistant', content: 'I fixed the parser.', emotion: 'focused', metadata: { emotion: 'focused' } }]
  );

  assert.match(prompt, /Assistant \[emotion=focused\]: I fixed the parser\./);
});

test('unprocessedMessageLimit returns all unmerged chat without a fixed cap', () => {
  assert.equal(
    unprocessedMessageLimit({
      summaries: { short: { sourceMessageCount: 12 } },
      messageCount: 12,
      limit: 24
    }),
    0
  );
  assert.equal(
    unprocessedMessageLimit({
      summaries: { short: { sourceMessageCount: 12 } },
      messageCount: 17,
      limit: 24
    }),
    5
  );
  assert.equal(
    unprocessedMessageLimit({
      summaries: { short: { sourceMessageCount: 12 } },
      messageCount: 40,
      limit: 10
    }),
    28
  );
});

test('annotateMemoryProcessed marks rows compacted into short-term memory', () => {
  const rows = annotateMemoryProcessed([
    { id: 1, role: 'assistant', content: 'Old answer', memorySequence: 2, metadata: { skill: 'bob-chat' } },
    { id: 2, role: 'assistant', content: 'Fresh answer', memorySequence: 5, metadata: { skill: 'bob-chat' } }
  ], {
    short: { sourceMessageCount: 3 }
  });

  assert.equal(rows[0].memoryProcessed, true);
  assert.equal(rows[0].memoryMerged, true);
  assert.equal(rows[0].metadata.memoryProcessed, true);
  assert.equal(rows[0].metadata.memoryMerged, true);
  assert.equal(rows[1].memoryProcessed, false);
  assert.equal(rows[1].memoryMerged, false);
  assert.equal(rows[1].metadata.memoryProcessed, false);
  assert.equal(rows[1].metadata.memoryMerged, false);
});

test('annotateMemoryProcessed preserves persisted merged chat flags', () => {
  const rows = annotateMemoryProcessed([
    { id: 1, role: 'user', content: 'Already merged', memoryMerged: true, metadata: {} },
    { id: 2, role: 'user', content: 'Still raw', memoryMerged: false, metadata: {} }
  ], {
    short: { sourceMessageCount: 0 }
  });

  assert.equal(rows[0].memoryProcessed, true);
  assert.equal(rows[0].metadata.memoryMerged, true);
  assert.equal(rows[1].memoryProcessed, false);
  assert.equal(rows[1].metadata.memoryMerged, false);
});

test('transcriptRoleLabel falls back to metadata emotion', () => {
  assert.equal(
    transcriptRoleLabel({ role: 'assistant', metadata: { emotion: 'curious' } }),
    'Assistant [emotion=curious]'
  );
});
