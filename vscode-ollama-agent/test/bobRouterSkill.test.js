const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildBobRouterEnvelope,
  buildBobRouterPrompt,
  heuristicBobRoute,
  parseBobRouterContract,
  parseBobModelRouterContract,
  selectBobModel,
  selectRouterModel
} = require('../server/bobRouterSkill');

test('buildBobRouterEnvelope creates the initial router message shape', () => {
  const envelope = buildBobRouterEnvelope({ prompt: "What's the weather going to be tomorrow?" });

  assert.equal(envelope.version, '1.0');
  assert.equal(envelope.request.id, '550e8400-e29b-41d4-a716-446655440000');
  assert.equal(envelope.request.timestamp, '2026-06-25T18:30:00Z');
  assert.equal(envelope.request.sessionId, 'session-12345');
  assert.equal(envelope.request.userId, 'user-001');
  assert.deepEqual(envelope.input, {
    text: "What's the weather going to be tomorrow?",
    attachments: [],
    language: 'en',
    source: 'web'
  });
  assert.deepEqual(envelope.user, { name: null, factoids: [] });
  assert.deepEqual(envelope.memory.recentMessages, []);
  assert.deepEqual(envelope.skills.selected, { skill: null, reason: null, parameters: {} });
  assert.deepEqual(envelope.output, {
    text: null,
    confidence: null,
    actions: [],
    toolCalls: [],
    citations: []
  });
});

test('buildBobRouterPrompt is a direct routing contract', () => {
  const prompt = buildBobRouterPrompt({
    prompt: 'What is the latest Ollama release?',
    summaries: { short: { title: 'Short term memory', summary: 'The user likes concise answers.' } },
    factoids: [{ category: 'preference', fact: 'The user prefers source links.' }]
  });

  assert.match(prompt, /You are Bob Router/);
  assert.match(prompt, /"skill":"bob-chat","query":"","reason":"","parameters":\{\},"factoids":\[\]/);
  assert.doesNotMatch(prompt, /short reason/);
  assert.match(prompt, /<router_request>/);
  assert.match(prompt, /"skills": \{/);
  assert.match(prompt, /"id": "web-search"/);
  assert.match(prompt, /"description": "Factual summaries of real-world places/);
  assert.match(prompt, /tell me about" a real-world named place\/entity/);
  assert.match(prompt, /First character must be \{/);
  assert.doesNotMatch(prompt, /explicit search\/look up/);
  assert.doesNotMatch(prompt, /<memory_summaries>/);
  assert.doesNotMatch(prompt, /The user likes concise answers/);
  assert.doesNotMatch(prompt, /<user_factoids>/);
  assert.match(prompt, /"text": "What is the latest Ollama release\?"/);
});

test('parseBobRouterContract accepts web-search and bob-chat routes', () => {
  assert.deepEqual(
    parseBobRouterContract('{"skill":"web-search","query":"latest ollama release","reason":"current fact","parameters":{},"factoids":[{"factKey":"preference-wants-to-buy-a-truck","category":"preference","fact":"The user wants to buy a truck.","confidence":0.9}]}', 'ignored'),
    {
      skill: 'web-search',
      query: 'latest ollama release',
      reason: 'current fact',
      parameters: {},
      factoids: [{ factKey: 'preference-wants-to-buy-a-truck', category: 'preference', fact: 'The user wants to buy a truck.', confidence: 0.9 }],
      contractValid: true
    }
  );
  assert.deepEqual(
    parseBobRouterContract('{"skill":"bob-chat","query":"bad","reason":"stable","parameters":{},"factoids":[]}', 'Hello'),
    { skill: 'bob-chat', query: '', reason: 'stable', parameters: {}, factoids: [], contractValid: true }
  );
  assert.deepEqual(
    parseBobRouterContract('{"skill":"bob-chat","query":"","reason":"short reason","parameters":{},"factoids":[]}', 'Hello'),
    { skill: 'bob-chat', query: '', reason: 'The question can be answered without external research.', parameters: {}, factoids: [], contractValid: false }
  );
  assert.deepEqual(
    parseBobRouterContract('{"skill":"web-search","query":"Springfield Illinois","reason":"","parameters":{},"factoids":[]}', 'tell me about Springfield Illinois'),
    {
      skill: 'web-search',
      query: 'Springfield Illinois',
      reason: 'The question needs source-backed or current factual information.',
      parameters: {},
      factoids: [],
      contractValid: true
    }
  );
});

test('parseBobRouterContract falls back to heuristic route on invalid JSON', () => {
  assert.deepEqual(parseBobRouterContract('not-json', 'what is the latest keycloak release?'), {
    skill: 'web-search',
    query: 'what is the latest keycloak release?',
    reason: 'Keyword heuristic matched web search intent.',
    parameters: {},
    factoids: [],
    contractValid: false
  });
  assert.equal(heuristicBobRoute('write a haiku').skill, 'bob-chat');
});

test('parseBobRouterContract treats prose answers as invalid route output', () => {
  assert.deepEqual(
    parseBobRouterContract('Springfield is the capital of Illinois.', 'tell me about Springfield Illinois'),
    {
      skill: 'bob-chat',
      query: '',
      reason: 'No web search intent detected.',
      parameters: {},
      factoids: [],
      contractValid: false
    }
  );
});

test('selectBobModel keeps manual selections unchanged', () => {
  assert.deepEqual(
    selectBobModel({
      requestedModel: 'qwen3.5:4b',
      installedModels: ['qwen3.5:0.8b', 'qwen3.5:4b'],
      prompt: 'Hi',
      defaultModel: 'qwen3.5:9b'
    }),
    {
      requestedModel: 'qwen3.5:4b',
      model: 'qwen3.5:4b',
      auto: false,
      reason: 'Manual model selection.'
    }
  );
});

test('selectBobModel chooses the smallest adequate installed Qwen model for AUTO', () => {
  const installedModels = ['qwen3.5:0.8b', 'qwen3.5:2b', 'qwen3.5:9b', 'llama3.2:3b'];

  assert.equal(selectBobModel({
    requestedModel: 'AUTO',
    installedModels,
    prompt: 'Hi',
    route: { skill: 'bob-chat' },
    defaultModel: 'qwen3.5:9b',
    minAutoSizeB: 2
  }).model, 'qwen3.5:2b');

  assert.equal(selectBobModel({
    requestedModel: 'AUTO',
    installedModels,
    prompt: 'Hi',
    route: { skill: 'bob-chat' },
    defaultModel: 'qwen3.5:9b'
  }).model, 'qwen3.5:0.8b');

  assert.equal(selectBobModel({
    requestedModel: 'AUTO',
    installedModels,
    prompt: 'Debug this failing API call',
    route: { skill: 'bob-chat' },
    defaultModel: 'qwen3.5:9b'
  }).model, 'qwen3.5:9b');

  assert.equal(selectBobModel({
    requestedModel: 'AUTO',
    installedModels,
    prompt: 'Tell me about Springfield Illinois',
    route: { skill: 'web-search' },
    defaultModel: 'qwen3.5:9b'
  }).model, 'qwen3.5:9b');
});

test('selectRouterModel chooses a capable small router model above the configured floor', () => {
  assert.deepEqual(
    selectRouterModel({
      installedModels: ['qwen3.5:0.8b', 'qwen3.5:2b', 'qwen3.5:4b', 'qwen3.5:9b'],
      defaultModel: 'qwen3.5:9b',
      minSizeB: 3
    }),
    {
      model: 'qwen3.5:4b',
      minSizeB: 3,
      candidates: ['qwen3.5:0.8b', 'qwen3.5:2b', 'qwen3.5:4b', 'qwen3.5:9b'],
      reason: 'Selected the smallest installed Qwen-family router model at or above 3B.'
    }
  );
});

test('parseBobModelRouterContract accepts only installed model choices', () => {
  const fallback = selectBobModel({
    requestedModel: 'AUTO',
    installedModels: ['qwen3.5:0.8b', 'qwen3.5:4b'],
    prompt: 'Hi',
    route: { skill: 'bob-chat' },
    defaultModel: 'qwen3.5:9b'
  });

  assert.deepEqual(
    parseBobModelRouterContract('{"model":"qwen3.5:4b","reason":"more reliable JSON"}', fallback.candidates, fallback),
    {
      requestedModel: 'AUTO',
      model: 'qwen3.5:4b',
      auto: true,
      targetSizeB: 0.8,
      candidates: ['qwen3.5:0.8b', 'qwen3.5:4b'],
      reason: 'more reliable JSON',
      contractValid: true
    }
  );

  assert.equal(
    parseBobModelRouterContract('{"model":"missing:99b","reason":"nope"}', fallback.candidates, fallback).model,
    fallback.model
  );
  assert.match(
    parseBobModelRouterContract('', fallback.candidates, fallback).reason,
    /Model router returned an invalid choice/
  );
});

test('parseBobModelRouterContract rejects choices below fallback target size', () => {
  const fallback = selectBobModel({
    requestedModel: 'AUTO',
    installedModels: ['qwen3.5:0.8b', 'qwen3.5:2b', 'qwen3.5:4b'],
    prompt: 'Hi',
    route: { skill: 'bob-chat' },
    minAutoSizeB: 2,
    defaultModel: 'qwen3.5:9b'
  });

  const parsed = parseBobModelRouterContract('{"model":"qwen3.5:0.8b","reason":"simple greeting"}', fallback.candidates, fallback);
  assert.equal(parsed.model, 'qwen3.5:2b');
  assert.equal(parsed.targetSizeB, 2);
  assert.equal(parsed.contractValid, false);
});
