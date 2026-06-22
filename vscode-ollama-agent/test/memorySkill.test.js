const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildFactoidExtractionPrompt,
  createMemorySkillService,
  isContextPressureHigh,
  normalizeMemoryBudget,
  transcriptFromMessages
} = require('../server/memorySkill');

test('transcriptFromMessages creates role-labeled memory transcripts', () => {
  assert.equal(
    transcriptFromMessages([
      { role: 'user', content: 'I prefer concise notes.' },
      { role: 'assistant', content: 'Understood.' },
      { role: 'system', content: 'System event.' }
    ]),
    'User: I prefer concise notes.\n\nBob: Understood.\n\nSystem: System event.'
  );
});

test('buildFactoidExtractionPrompt forbids unsupported sensitive inference', () => {
  const prompt = buildFactoidExtractionPrompt('User: My name is Rob.');

  assert.match(prompt, /Only include facts explicitly supported by the transcript/);
  assert.match(prompt, /Do not infer sensitive attributes, secrets, medical facts, financial account data, or credentials/);
  assert.match(prompt, /"factoids"/);
  assert.match(prompt, /User: My name is Rob\./);
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
      return '- The user prefers backend behavior.';
    }
  });

  const summary = await service.refreshSummary({ req: {}, model: 'llama3', scope: 'short', conversationId: 'main' });

  assert.equal(calls[0][1].limit, 24);
  assert.equal(calls[0][1].conversationId, 'main');
  assert.equal(calls[1][1].model, 'llama3');
  assert.match(calls[1][1].prompt, /Create a short-term memory list/);
  assert.equal(summary.summary, '- The user prefers backend behavior.');
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
  assert.match(generatedPrompts[0], /Merge existing medium-term memory into Bob's long-term memory/);
  assert.match(generatedPrompts[1], /Merge existing short-term memory into Bob's medium-term memory/);
  assert.match(generatedPrompts[2], /Merge chat messages since the last memory update into Bob's short-term memory/);
  assert.match(generatedPrompts[2], /Short memory should only use new chat/);
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
