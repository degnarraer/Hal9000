const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSkillInputContract,
  buildSkillOutputContract,
  bobEmotionApiDescription,
  normalizeBobEmotion,
  parseBobChatContract,
  parseSkillOutputContract
} = require('../server/bobSkillContracts');

test('buildSkillInputContract creates a stable skill input envelope', () => {
  assert.deepEqual(
    buildSkillInputContract({
      skill: 'web-search',
      prompt: 'search for Piper',
      context: { query: 'Piper' },
      upstream: [{ skill: 'bob-chat' }]
    }),
    {
      contractVersion: 1,
      skill: 'web-search',
      input: {
        prompt: 'search for Piper',
        context: { query: 'Piper' },
        upstream: [{ skill: 'bob-chat' }]
      }
    }
  );
});

test('buildSkillOutputContract normalizes response metadata and sources', () => {
  assert.deepEqual(
    buildSkillOutputContract({
      skill: 'bob-chat',
      response: 'Hello.',
      metadata: { emotion: 'HAPPY', contractValid: true },
      data: { tokens: 3 },
      sources: [{ title: 'Source', url: 'https://example.com' }]
    }),
    {
      contractVersion: 1,
      skill: 'bob-chat',
      output: {
        response: 'Hello.',
        metadata: { emotion: 'happy', contractValid: true },
        data: { tokens: 3 },
        sources: [{ title: 'Source', url: 'https://example.com' }]
      }
    }
  );
});

test('parseBobChatContract extracts response and emotion from valid Bob JSON', () => {
  assert.deepEqual(
    parseBobChatContract('{"response":"I can help with that.","metadata":{"emotion":"focused","topic":"work"}}'),
    {
      response: 'I can help with that.',
      metadata: { emotion: 'focused', topic: 'work', contractValid: true }
    }
  );
});

test('parseBobChatContract tolerates fenced JSON and invalid emotions', () => {
  assert.deepEqual(
    parseBobChatContract('```json\n{"response":"Whoa.","metadata":{"emotion":"loud"}}\n```'),
    {
      response: 'Whoa.',
      metadata: { emotion: 'idle', contractValid: true }
    }
  );
});

test('parseBobChatContract marks non-JSON output as an invalid contract', () => {
  assert.deepEqual(
    parseBobChatContract('plain text answer'),
    {
      response: 'plain text answer',
      metadata: { emotion: 'concerned', contractValid: false }
    }
  );
});

test('parseSkillOutputContract accepts canonical output envelope', () => {
  const raw = JSON.stringify({
    contractVersion: 1,
    skill: 'web-search',
    output: {
      response: 'Piper is an offline TTS engine.',
      metadata: { emotion: 'confident' },
      data: { query: 'Piper TTS' },
      sources: [{ title: 'Piper', url: 'https://example.com', snippet: 'TTS' }]
    }
  });

  assert.deepEqual(parseSkillOutputContract(raw), {
    contractVersion: 1,
    skill: 'web-search',
    output: {
      response: 'Piper is an offline TTS engine.',
      metadata: { emotion: 'confident', contractValid: true },
      data: { query: 'Piper TTS' },
      sources: [{ title: 'Piper', url: 'https://example.com', snippet: 'TTS' }]
    }
  });
});

test('parseSkillOutputContract falls back when model output is not JSON', () => {
  assert.deepEqual(
    parseSkillOutputContract('summary text', {
      skill: 'web-search',
      response: 'fallback summary',
      emotion: 'focused',
      data: { query: 'fallback' },
      sources: []
    }),
    {
      contractVersion: 1,
      skill: 'web-search',
      output: {
        response: 'fallback summary',
        metadata: { emotion: 'focused', contractValid: false },
        data: { query: 'fallback' },
        sources: []
      }
    }
  );
});

test('normalizeBobEmotion constrains unknown states to idle', () => {
  assert.equal(normalizeBobEmotion('curious'), 'curious');
  assert.equal(normalizeBobEmotion('not-a-state'), 'idle');
});

test('bobEmotionApiDescription gives LLM-readable emotion guidance', () => {
  const description = bobEmotionApiDescription();

  assert.match(description, /happy: Warm, pleased, or encouraging/);
  assert.match(description, /focused: Task-oriented concentration/);
  assert.match(description, /error: Failure state/);
});
