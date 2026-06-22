const { buildMemoryMergePrompt, buildMemorySummaryPrompt } = require('./memorySummary');
const { filterSupportedFactoids, parseFactoidExtraction } = require('./memoryFactoids');
const { requestDatabaseUserKey } = require('./userIdentity');

const DEFAULT_MEMORY_SUMMARY_INTERVALS = {
  short: 6,
  medium: 20,
  long: 60
};

const DEFAULT_MEMORY_BUDGET = {
  modelContextTokens: 4096,
  triggerRatio: 0.72,
  promptReserveTokens: 1200,
  maxWords: {
    short: 120,
    medium: 250,
    long: 400
  }
};

function buildFactoidExtractionPrompt(transcript) {
  return [
    'You are Bob memory factoid extraction skill.',
    'Extract durable facts about the user that would help future conversations.',
    'Only include facts explicitly supported by the transcript. Do not infer sensitive attributes, secrets, medical facts, financial account data, or credentials.',
    'Prefer stable preferences, ongoing projects, names the user asked Bob to remember, working style, environment details, and durable constraints.',
    'Return only JSON with this shape: {"factoids":[{"factKey":"short-stable-key","category":"preference|project|identity|environment|workflow|constraint|general","fact":"The user ...","confidence":0.0}]}',
    'If there are no durable user facts, return {"factoids":[]}.',
    '',
    '<conversation_transcript>',
    transcript || '(No conversation messages yet.)',
    '</conversation_transcript>'
  ].join('\n');
}

function transcriptFromMessages(messages = []) {
  return messages
    .map(row => `${row.role === 'assistant' ? 'Bob' : row.role === 'system' ? 'System' : 'User'}: ${row.content}`)
    .join('\n\n');
}

function estimateTokens(value) {
  const text = String(value || '');
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function normalizeMemoryBudget(input = {}) {
  const modelContextTokens = Math.max(1024, Number(input.modelContextTokens) || DEFAULT_MEMORY_BUDGET.modelContextTokens);
  const triggerRatio = clamp(Number(input.triggerRatio) || DEFAULT_MEMORY_BUDGET.triggerRatio, 0.1, 0.95);
  const promptReserveTokens = Math.max(256, Number(input.promptReserveTokens) || DEFAULT_MEMORY_BUDGET.promptReserveTokens);
  const availableMemoryTokens = Math.max(256, modelContextTokens - promptReserveTokens);
  const maxWords = {
    ...DEFAULT_MEMORY_BUDGET.maxWords,
    ...(input.maxWords || {})
  };

  return {
    modelContextTokens,
    triggerRatio,
    promptReserveTokens,
    availableMemoryTokens,
    maxWords: {
      short: Math.max(40, Number(maxWords.short) || DEFAULT_MEMORY_BUDGET.maxWords.short),
      medium: Math.max(80, Number(maxWords.medium) || DEFAULT_MEMORY_BUDGET.maxWords.medium),
      long: Math.max(120, Number(maxWords.long) || DEFAULT_MEMORY_BUDGET.maxWords.long)
    }
  };
}

function createMemorySkillService({
  memory,
  logger,
  generateText,
  intervals = DEFAULT_MEMORY_SUMMARY_INTERVALS,
  budget,
  getErrorText = defaultErrorText,
  userKeyForRequest = requestDatabaseUserKey
}) {
  if (!memory) throw new Error('memory store is required');
  if (typeof generateText !== 'function') throw new Error('generateText function is required');

  const summaryJobs = new Set();
  const factoidJobs = new Set();
  const memoryBudget = normalizeMemoryBudget(budget);

  async function refreshSummary({ req, model, scope, conversationId = 'default' }) {
    const scopeConfig = memory.summaryScopes[scope];
    if (!scopeConfig) throw new Error('Invalid memory scope');

    const messages = await memory.getMessages({ req, limit: scopeConfig.limit, conversationId });
    const transcript = transcriptFromMessages(messages);
    const summaryText = await generateText(model, buildMemorySummaryPrompt(scope, transcript), { temperature: 0.2 });
    return memory.saveSummary({
      req,
      scope,
      summary: summaryText || 'No durable memory has been formed yet.',
      sourceMessageCount: messages.length,
      model
    });
  }

  async function runCascadeUpdate({ req, model, conversationId = 'default' }) {
    const [summaries, messageCount] = await Promise.all([
      memory.getSummaries({ req }),
      memory.getMessageCount({ req, conversationId })
    ]);

    const shortSourceCount = Number(summaries.short?.sourceMessageCount || 0);
    const newMessageCount = Math.max(0, messageCount - shortSourceCount);
    const newMessages = newMessageCount > 0
      ? await memory.getMessages({ req, limit: Math.min(newMessageCount, memory.summaryScopes.short?.limit || newMessageCount), conversationId })
      : [];
    const deltaTranscript = transcriptFromMessages(newMessages);

    const longSummary = await mergeSummary({
      req,
      model,
      scope: 'long',
      existingSummary: summaries.long?.summary || '',
      incomingMemory: summaries.medium?.summary || '',
      incomingLabel: 'existing medium-term memory',
      sourceMessageCount: messageCount
    });

    const mediumSummary = await mergeSummary({
      req,
      model,
      scope: 'medium',
      existingSummary: summaries.medium?.summary || '',
      incomingMemory: summaries.short?.summary || '',
      incomingLabel: 'existing short-term memory',
      sourceMessageCount: messageCount
    });

    const shortSummary = await mergeSummary({
      req,
      model,
      scope: 'short',
      existingSummary: summaries.short?.summary || '',
      incomingMemory: deltaTranscript,
      incomingLabel: 'chat messages since the last memory update',
      sourceMessageCount: messageCount
    });

    return {
      long: longSummary,
      medium: mediumSummary,
      short: shortSummary
    };
  }

  async function mergeSummary({ req, model, scope, existingSummary, incomingMemory, incomingLabel, sourceMessageCount }) {
    const summaryText = await generateText(
      model,
      buildMemoryMergePrompt(scope, {
        existingSummary,
        incomingMemory,
        incomingLabel,
        maxWords: memoryBudget.maxWords[scope]
      }),
      { temperature: 0.15 }
    );

    return memory.saveSummary({
      req,
      scope,
      summary: summaryText || existingSummary || 'No durable memory has been formed yet.',
      sourceMessageCount,
      model
    });
  }

  async function updateSummariesAfterTurn({ req, model, conversationId = 'default' }) {
    try {
      const [summaries, messageCount] = await Promise.all([
        memory.getSummaries({ req }),
        memory.getMessageCount({ req, conversationId })
      ]);
      const unprocessedMessages = typeof memory.getUnprocessedMessages === 'function'
        ? await memory.getUnprocessedMessages({ req, summaries, limit: memory.summaryScopes.short?.limit || 24, conversationId })
        : await memory.getMessages({ req, limit: memory.summaryScopes.short?.limit || 24, conversationId });

      const isDueByMessages = Object.keys(memory.summaryScopes).some(scope => {
        const interval = Math.max(1, Number(intervals[scope]) || 1);
        const sourceCount = Number(summaries[scope]?.sourceMessageCount || 0);
        return messageCount > 0 && messageCount - sourceCount >= interval;
      });
      const isDueByContext = isContextPressureHigh(summaries, unprocessedMessages, memoryBudget);

      if (!isDueByMessages && !isDueByContext) return;

      const jobKey = `${userKeyForRequest(req)}:${conversationId}:summary-cascade`;
      if (summaryJobs.has(jobKey)) return;

      summaryJobs.add(jobKey);
      runCascadeUpdate({ req, model, conversationId })
        .then(() => logger?.info?.(`Memory cascade refreshed from ${messageCount} messages`))
        .catch(err => logger?.warn?.('Memory cascade refresh failed', getErrorText(err)))
        .finally(() => summaryJobs.delete(jobKey));
    } catch (err) {
      logger?.warn?.('Memory summary scheduler failed', getErrorText(err));
    }
  }

  async function updateFactoidsAfterTurn({ req, model, conversationId = 'default', sourceMessageId = null }) {
    const jobKey = `${userKeyForRequest(req)}:${conversationId}:factoids`;
    if (factoidJobs.has(jobKey)) return;

    factoidJobs.add(jobKey);
    try {
      const messages = await memory.getMessages({ req, limit: 16, conversationId });
      const transcript = transcriptFromMessages(messages);
      const text = await generateText(model, buildFactoidExtractionPrompt(transcript), { temperature: 0.1 });
      const saved = await memory.saveFactoids({
        req,
        model,
        sourceMessageId,
        factoids: filterSupportedFactoids(parseFactoidExtraction(text), messages)
      });
      if (saved.length > 0) logger?.info?.(`Memory factoids refreshed: ${saved.length} saved`);
    } catch (err) {
      logger?.warn?.('Memory factoid refresh failed', getErrorText(err));
    } finally {
      factoidJobs.delete(jobKey);
    }
  }

  function updateAfterTurn({ req, model, conversationId = 'default', sourceMessageId = null }) {
    updateSummariesAfterTurn({ req, model, conversationId });
    updateFactoidsAfterTurn({ req, model, conversationId, sourceMessageId });
  }

  function isUpdating({ req, conversationId = 'default' } = {}) {
    if (!req) return summaryJobs.size > 0 || factoidJobs.size > 0;
    const userKey = userKeyForRequest(req);
    return [...summaryJobs, ...factoidJobs].some(jobKey => jobKey.startsWith(`${userKey}:${conversationId}:`));
  }

  return {
    budget: memoryBudget,
    isUpdating,
    refreshSummary,
    runCascadeUpdate,
    updateAfterTurn,
    updateFactoidsAfterTurn,
    updateSummariesAfterTurn
  };
}

function isContextPressureHigh(summaries, messages, budget = DEFAULT_MEMORY_BUDGET) {
  const summaryTokens = Object.values(summaries || {}).reduce((total, summary) => total + estimateTokens(summary?.summary), 0);
  const messageTokens = (messages || []).reduce((total, message) => total + estimateTokens(message?.content), 0);
  const normalized = normalizeMemoryBudget(budget);
  return summaryTokens + messageTokens >= normalized.availableMemoryTokens * normalized.triggerRatio;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function defaultErrorText(err) {
  return err?.message || String(err);
}

module.exports = {
  DEFAULT_MEMORY_SUMMARY_INTERVALS,
  estimateTokens,
  buildFactoidExtractionPrompt,
  createMemorySkillService,
  isContextPressureHigh,
  normalizeMemoryBudget,
  transcriptFromMessages
};
