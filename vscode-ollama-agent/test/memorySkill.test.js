const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildFactoidExtractionPrompt,
  createMemorySkillService,
  isContextPressureHigh,
  normalizeMemoryBudget,
  sanitizeMemorySummary,
  transcriptFromMessages
} = require('../server/memorySkill');

test('transcriptFromMessages creates chatHistory memory JSON', () => {
  assert.equal(
    transcriptFromMessages([
      { role: 'user', content: 'I prefer concise notes.', created_at: '2026-06-25T18:30:00.000Z', metadata: { detectedUserEmotion: 'curious', detectedUserEmotionIntensity: 0.64 } },
      { role: 'assistant', content: 'Understood.', createdAt: new Date('2026-06-25T18:31:00.000Z'), emotion: 'friendly', metadata: { emotionIntensity: 1.4 } },
      { role: 'system', content: 'System event.' }
    ]),
    JSON.stringify({
      chatHistory: [
        { role: 'user', dateTime: '2026-06-25T18:30:00.000Z', content: 'I prefer concise notes.', detectedUserEmotion: 'curious', detectedUserEmotionIntensity: 0.64 },
        { role: 'assistant', dateTime: '2026-06-25T18:31:00.000Z', content: 'Understood.', assistantEmotion: 'friendly', assistantEmotionIntensity: 1 },
        { role: 'system', dateTime: null, content: 'System event.' }
      ]
    }, null, 2)
  );
});

test('transcriptFromMessages includes response factoids captured on chat rows', () => {
  const transcript = transcriptFromMessages([
    {
      role: 'assistant',
      content: 'Nice to meet you.',
      metadata: {
        emotion: 'happy',
        responseFactoids: [
          { factKey: 'name', category: 'identity', fact: 'The user is named Rob.', confidence: 0.87 }
        ]
      }
    }
  ]);

  assert.match(transcript, /"responseFactoids"/);
  assert.match(transcript, /"fact": "The user is named Rob\."/);
});

test('buildFactoidExtractionPrompt forbids unsupported sensitive inference', () => {
  const prompt = buildFactoidExtractionPrompt('User: My name is Rob.');

  assert.match(prompt, /Only include facts explicitly supported by the chat history/);
  assert.match(prompt, /Do not infer sensitive attributes, secrets, medical facts, financial account data, or credentials/);
  assert.match(prompt, /"factoids"/);
  assert.match(prompt, /<chat_memory>\nUser: My name is Rob\./);
});

test('sanitizeMemorySummary rejects preambles recaps and hallucinated canned facts', () => {
  assert.equal(
    sanitizeMemorySummary('Based on the given prompt and instructions, here are the prioritized markdown bullets:\n1. Recurring preferences - Bob has a preference for coffee over tea.'),
    ''
  );
  assert.equal(
    sanitizeMemorySummary('- Stable user preferences: The user\'s preference for a particular type of music or food is unlikely to change frequently.\n- Enduring projects: The user may have ongoing projects.'),
    ''
  );
  assert.equal(
    sanitizeMemorySummary('- User: Hello\n- Bob: Hi there'),
    ''
  );
  assert.equal(sanitizeMemorySummary('EMPTY'), '');
  assert.equal(
    sanitizeMemorySummary('- The user prefers backend memory behavior.\n- Bob should mention requirements.'),
    '- The user prefers backend memory behavior.\n- Bob should mention requirements.'
  );
});

test('memory skill refreshSummary uses scope limits and saves generated summaries', async () => {
  const calls = [];
  const memory = {
    summaryScopes: { short: { limit: 24 } },
    getMessages: async opts => {
      calls.push(['getMessages', opts]);
      return [{ role: 'user', content: 'I prefer backend behavior over frontend-only summaries.' }];
    },
    saveSummary: async payload => {
      calls.push(['saveSummary', payload]);
      return payload;
    }
  };
  const service = createMemorySkillService({
    memory,
    logger: {},
    userKeyForRequest: () => 'user-1',
    generateText: async (model, prompt, options) => {
      calls.push(['generateText', { model, prompt, options }]);
      return 'Based on your requirements, here are bullets:\n1. User: I prefer backend behavior.';
    }
  });

  const summary = await service.refreshSummary({ req: {}, model: 'llama3', scope: 'short', conversationId: 'main' });

  assert.equal(calls[0][1].limit, 24);
  assert.equal(calls[0][1].conversationId, 'main');
  assert.equal(calls[1][1].model, 'llama3');
  assert.match(calls[1][1].prompt, /Task: write short memory only/);
  assert.equal(calls[2][1].debug.skill, 'memory-short-summary');
  assert.match(calls[2][1].debug.input, /Task: write short memory only/);
  assert.match(calls[2][1].debug.output, /Based on your requirements/);
  assert.equal(calls[2][1].debug.sanitizedOutput, '');
  assert.equal(summary.summary, '');
  assert.equal(summary.sourceMessageCount, 1);
});

test('memory skill cascade merges long, medium, then short memory', async () => {
  const generatedPrompts = [];
  const savedScopes = [];
  const memory = {
    summaryScopes: {
      short: { limit: 24 },
      medium: { limit: 100 },
      long: { limit: 500 }
    },
    getSummaries: async () => ({
      short: { summary: '- Short: user is debugging memory.', sourceMessageCount: 2 },
      medium: { summary: '- Medium: user prefers backend memory behavior.', sourceMessageCount: 2 },
      long: { summary: '- Long: user builds Bob as a local assistant.', sourceMessageCount: 2 }
    }),
    getMessageCount: async () => 4,
    getMessages: async opts => {
      assert.equal(opts.limit, 2);
      return [
        { role: 'user', content: 'Short memory should only use new chat.' },
        { role: 'assistant', content: 'I will update the cascade.' }
      ];
    },
    saveSummary: async payload => {
      savedScopes.push(payload.scope);
      assert.equal(Boolean(payload.debug?.input), true);
      assert.equal(Boolean(payload.debug?.output), true);
      assert.equal(Boolean(payload.debug?.skill), true);
      return payload;
    }
  };
  const service = createMemorySkillService({
    memory,
    logger: {},
    budget: { maxWords: { short: 80, medium: 120, long: 160 } },
    userKeyForRequest: () => 'user-1',
    generateText: async (model, prompt) => {
      generatedPrompts.push(prompt);
      return `- Merged ${generatedPrompts.length}`;
    }
  });

  await service.runCascadeUpdate({ req: {}, model: 'llama3', conversationId: 'main' });

  assert.deepEqual(savedScopes, ['long', 'medium', 'short']);
  assert.match(generatedPrompts[0], /Task: merge existing medium-term memory into long memory/);
  assert.match(generatedPrompts[1], /Task: merge existing short-term memory into medium memory/);
  assert.match(generatedPrompts[2], /Task: merge chat messages since the last memory update into short memory/);
  assert.match(generatedPrompts[2], /Short memory should only use new chat/);
  assert.match(generatedPrompts[2], /"chatHistory": \[/);
});

test('memory skill factoid refresh persists only transcript-supported facts', async () => {
  let savedPayload;
  const memory = {
    summaryScopes: {},
    getMessages: async () => [
      { role: 'user', content: 'Hi, my name is Rob.' },
      { role: 'assistant', content: 'Nice to meet you.' }
    ],
    saveFactoids: async payload => {
      savedPayload = payload;
      return payload.factoids;
    }
  };
  const service = createMemorySkillService({
    memory,
    logger: {},
    userKeyForRequest: () => 'user-1',
    generateText: async () => JSON.stringify({
      factoids: [
        { factKey: 'name', category: 'identity', fact: 'The user is named Rob.', confidence: 0.8 },
        { factKey: 'office', category: 'environment', fact: 'The user works in a quiet office.', confidence: 0.8 }
      ]
    })
  });

  await service.updateFactoidsAfterTurn({ req: {}, model: 'llama3', sourceMessageId: 42 });

  assert.equal(savedPayload.model, 'llama3');
  assert.equal(savedPayload.sourceMessageId, 42);
  assert.deepEqual(savedPayload.factoids, [
    { factKey: 'name', category: 'identity', fact: 'The user is named Rob.', confidence: 0.8 }
  ]);
});

test('memory skill extracts factoids during memory merge', async () => {
  let savedPayload;
  const mergedIds = [];
  const messages = [
    { id: 10, role: 'user', content: 'My name is Rob.' },
    { id: 11, role: 'assistant', content: 'Nice to meet you.' }
  ];
  const memory = {
    summaryScopes: { short: { limit: 24 }, medium: { limit: 100 }, long: { limit: 500 } },
    getSummaries: async () => ({
      short: { summary: '', sourceMessageCount: 0 },
      medium: { summary: '', sourceMessageCount: 0 },
      long: { summary: '', sourceMessageCount: 0 }
    }),
    getMessageCount: async () => messages.length,
    getUnprocessedMessages: async () => messages,
    saveSummary: async payload => payload,
    markMessagesMerged: async payload => {
      mergedIds.push(...payload.messageIds);
      return payload.messageIds.length;
    },
    saveFactoids: async payload => {
      savedPayload = payload;
      return payload.factoids;
    }
  };
  const service = createMemorySkillService({
    memory,
    logger: {},
    userKeyForRequest: () => 'user-1',
    generateText: async (model, prompt) => prompt.includes('factoid extraction')
      ? JSON.stringify({
        factoids: [
          { factKey: 'name', category: 'identity', fact: 'The user is named Rob.', confidence: 0.9 },
          { factKey: 'office', category: 'environment', fact: 'The user works in a quiet office.', confidence: 0.8 }
        ]
      })
      : '- The user introduced themself as Rob.'
  });

  await service.runCascadeUpdate({ req: {}, model: 'llama3', conversationId: 'main' });

  assert.deepEqual(mergedIds, [10, 11]);
  assert.equal(savedPayload.model, 'llama3');
  assert.equal(savedPayload.sourceMessageId, 11);
  assert.deepEqual(savedPayload.factoids, [
    { factKey: 'name', category: 'identity', fact: 'The user is named Rob.', confidence: 0.9 }
  ]);
});

test('memory skill suppresses duplicate summary jobs per user conversation and scope', async () => {
  let generateCalls = 0;
  const releaseGenerate = [];
  const memory = {
    summaryScopes: {
      short: { limit: 24 },
      medium: { limit: 100 },
      long: { limit: 500 }
    },
    getSummaries: async () => ({
      short: { summary: '- Existing short', sourceMessageCount: 0 },
      medium: { summary: '- Existing medium', sourceMessageCount: 0 },
      long: { summary: '- Existing long', sourceMessageCount: 0 }
    }),
    getMessageCount: async () => 10,
    getMessages: async () => [{ role: 'user', content: 'Remember that I like tests.' }],
    saveSummary: async payload => payload
  };
  const service = createMemorySkillService({
    memory,
    logger: {},
    intervals: { short: 1 },
    userKeyForRequest: () => 'user-1',
    generateText: async () => {
      generateCalls += 1;
      return new Promise(resolve => {
        releaseGenerate.push(() => resolve('- The user likes tests.'));
      });
    }
  });

  await service.updateSummariesAfterTurn({ req: {}, model: 'llama3', conversationId: 'main' });
  await service.updateSummariesAfterTurn({ req: {}, model: 'llama3', conversationId: 'main' });

  assert.equal(generateCalls, 1);
  releaseGenerate.forEach(release => release());
  await new Promise(resolve => setImmediate(resolve));
});

test('memory skill interval update only runs due summary scopes', async () => {
  const savedScopes = [];
  const memory = {
    summaryScopes: {
      short: { limit: 24 },
      medium: { limit: 100 },
      long: { limit: 500 }
    },
    getSummaries: async () => ({
      short: { summary: '- Existing short', sourceMessageCount: 0 },
      medium: { summary: '- Existing medium', sourceMessageCount: 9 },
      long: { summary: '- Existing long', sourceMessageCount: 9 }
    }),
    getMessageCount: async () => 10,
    getUnprocessedMessages: async () => [{ role: 'user', content: 'New short-memory-only message.' }],
    getMessages: async () => [{ role: 'user', content: 'New short-memory-only message.' }],
    saveSummary: async payload => {
      savedScopes.push(payload.scope);
      return payload;
    }
  };
  const service = createMemorySkillService({
    memory,
    logger: {},
    intervals: { short: 1, medium: 99, long: 99 },
    budget: { modelContextTokens: 8192, promptReserveTokens: 1200, triggerRatio: 0.9 },
    userKeyForRequest: () => 'user-1',
    generateText: async () => '- Updated short memory.'
  });

  await service.updateSummariesAfterTurn({ req: {}, model: 'llama3', conversationId: 'main' });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(savedScopes, ['short']);
});

test('memory skill does not run long merge from interval alone', async () => {
  let saveCalls = 0;
  const memory = {
    summaryScopes: {
      short: { limit: 24 },
      medium: { limit: 100 },
      long: { limit: 500 }
    },
    getSummaries: async () => ({
      short: { summary: '- Existing short', sourceMessageCount: 10 },
      medium: { summary: '- Existing medium', sourceMessageCount: 10 },
      long: { summary: '- Existing long', sourceMessageCount: 0 }
    }),
    getMessageCount: async () => 10,
    getUnprocessedMessages: async () => [{ role: 'user', content: 'Small update.' }],
    getMessages: async () => [{ role: 'user', content: 'Small update.' }],
    saveSummary: async payload => {
      saveCalls += 1;
      return payload;
    }
  };
  const service = createMemorySkillService({
    memory,
    logger: {},
    intervals: { short: 99, medium: 99, long: 1 },
    budget: { modelContextTokens: 8192, promptReserveTokens: 1200, triggerRatio: 0.9 },
    userKeyForRequest: () => 'user-1',
    generateText: async () => '- Should not run.'
  });

  await service.updateSummariesAfterTurn({ req: {}, model: 'llama3', conversationId: 'main' });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(saveCalls, 0);
});

test('memory skill context pressure can trigger a cascade before intervals are due', async () => {
  let cascadeCalls = 0;
  const memory = {
    summaryScopes: {
      short: { limit: 24 },
      medium: { limit: 100 },
      long: { limit: 500 }
    },
    getSummaries: async () => ({
      short: { summary: '- Existing short', sourceMessageCount: 9 },
      medium: { summary: '- Existing medium', sourceMessageCount: 9 },
      long: { summary: '- Existing long', sourceMessageCount: 9 }
    }),
    getMessageCount: async () => 10,
    getUnprocessedMessages: async () => [{ role: 'user', content: 'x'.repeat(3600) }],
    getMessages: async opts => opts.limit > 100
      ? [{ role: 'user', content: 'x'.repeat(3600) }]
      : [{ role: 'user', content: 'new context pressure message' }],
    saveSummary: async payload => {
      cascadeCalls += 1;
      return payload;
    }
  };
  const service = createMemorySkillService({
    memory,
    logger: {},
    intervals: { short: 99, medium: 99, long: 99 },
    budget: { modelContextTokens: 2048, promptReserveTokens: 512, triggerRatio: 0.5 },
    userKeyForRequest: () => 'user-1',
    generateText: async () => '- Preserved memory.'
  });

  await service.updateSummariesAfterTurn({ req: {}, model: 'llama3', conversationId: 'main' });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(cascadeCalls, 3);
});

test('memory skill context pressure uses unprocessed chat instead of full saved history', async () => {
  let unprocessedReads = 0;
  let fullHistoryReads = 0;
  const memory = {
    summaryScopes: {
      short: { limit: 24 },
      medium: { limit: 100 },
      long: { limit: 500 }
    },
    getSummaries: async () => ({
      short: { summary: '- Existing short', sourceMessageCount: 10 },
      medium: { summary: '- Existing medium', sourceMessageCount: 10 },
      long: { summary: '- Existing long', sourceMessageCount: 10 }
    }),
    getMessageCount: async () => 10,
    getUnprocessedMessages: async () => {
      unprocessedReads += 1;
      return [];
    },
    getMessages: async () => {
      fullHistoryReads += 1;
      return [{ role: 'user', content: 'old processed chat' }];
    },
    saveSummary: async payload => payload
  };
  const service = createMemorySkillService({
    memory,
    logger: {},
    intervals: { short: 99, medium: 99, long: 99 },
    userKeyForRequest: () => 'user-1',
    generateText: async () => '- Preserved memory.'
  });

  await service.updateSummariesAfterTurn({ req: {}, model: 'llama3', conversationId: 'main' });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(unprocessedReads, 1);
  assert.equal(fullHistoryReads, 0);
});

test('memory skill reports active update jobs for the current user conversation', async () => {
  let releaseGenerate;
  const memory = {
    summaryScopes: {},
    getMessages: async () => [{ role: 'user', content: 'My name is Rob.' }],
    saveFactoids: async payload => payload.factoids
  };
  const service = createMemorySkillService({
    memory,
    logger: {},
    userKeyForRequest: () => 'user-1',
    generateText: async () => new Promise(resolve => {
      releaseGenerate = () => resolve('{"factoids":[]}');
    })
  });
  const req = {};
  const job = service.updateFactoidsAfterTurn({ req, model: 'llama3', conversationId: 'main' });
  while (!releaseGenerate) {
    await new Promise(resolve => setImmediate(resolve));
  }

  assert.equal(service.isUpdating({ req, conversationId: 'main' }), true);
  releaseGenerate();
  await job;
  assert.equal(service.isUpdating({ req, conversationId: 'main' }), false);
});

test('memory skill does not run factoid sweep after every turn', async () => {
  let factoidReads = 0;
  const memory = {
    summaryScopes: {},
    getSummaries: async () => ({}),
    getMessageCount: async () => 0,
    getUnprocessedMessages: async () => [],
    getMessages: async () => {
      factoidReads += 1;
      return [{ role: 'user', content: 'My name is Rob.' }];
    },
    saveFactoids: async payload => payload.factoids
  };

  const quietService = createMemorySkillService({
    memory,
    logger: {},
    userKeyForRequest: () => 'user-1',
    generateText: async () => '{"factoids":[]}'
  });

  quietService.updateAfterTurn({ req: {}, model: 'llama3', conversationId: 'main' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(factoidReads, 0);

  const enabledService = createMemorySkillService({
    memory,
    logger: {},
    userKeyForRequest: () => 'user-1',
    generateText: async () => '{"factoids":[]}'
  });

  enabledService.updateAfterTurn({ req: {}, model: 'llama3', conversationId: 'main' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(factoidReads, 0);
});

test('memory budget normalizes model context and horizon word caps', () => {
  assert.deepEqual(
    normalizeMemoryBudget({
      modelContextTokens: 8192,
      triggerRatio: 0.8,
      promptReserveTokens: 1600,
      maxWords: { short: 90, medium: 180, long: 320 }
    }),
    {
      modelContextTokens: 8192,
      triggerRatio: 0.8,
      promptReserveTokens: 1600,
      availableMemoryTokens: 6592,
      maxWords: { short: 90, medium: 180, long: 320 }
    }
  );
});

test('context pressure estimates memory plus transcript against budget', () => {
  assert.equal(
    isContextPressureHigh(
      { short: { summary: 'x'.repeat(900) } },
      [{ content: 'y'.repeat(900) }],
      { modelContextTokens: 1200, promptReserveTokens: 400, triggerRatio: 0.5 }
    ),
    true
  );
});
