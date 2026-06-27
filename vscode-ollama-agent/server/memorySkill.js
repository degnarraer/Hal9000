const { buildMemoryMergePrompt, buildMemorySummaryPrompt } = require('./memorySummary');
const { normalizeFactoids, parseFactoidExtraction } = require('./memoryFactoids');
const { requestDatabaseUserKey } = require('./userIdentity');

const DEFAULT_MEMORY_SUMMARY_INTERVALS = {
  short: 6,
  medium: 20,
  long: 60
};

const DEFAULT_MEMORY_BUDGET = {
  modelContextTokens: 4096,
  triggerRatio: 0.75,
  promptReserveTokens: 1200,
  maxWords: {
    short: 120,
    medium: 250,
    long: 400
  }
};

const EMPTY_MEMORY = '';
const BAD_MEMORY_PATTERNS = [
  /based on (the )?(given )?(prompt|transcript|requirements|instructions)/i,
  /prioritized markdown bullets/i,
  /bob should retain/i,
  /currently storing the following information/i,
  /incoming memory is less important/i,
  /stable user preferences:\s*the user's preference for/i,
  /enduring projects:\s*the user may have/i,
  /identity\/context facts the user intentionally revealed/i,
  /durable operating principles:\s*the user may have/i,
  /unlikely to change frequently/i,
  /can be used to identify them in future interactions/i,
  /guiding principles for how they approach/i,
  /^\s*\d+\.\s/m,
  /\bBob has a preference for coffee over tea\b/i,
  /\bcompany's production process\b/i,
  /\bchoosing to pursue a degree in engineering\b/i
];

function buildFactoidExtractionPrompt(transcript) {
  return [
    'You are Bob memory factoid extraction skill.',
    'Extract durable facts about the user that would help future conversations.',
    'Only include facts explicitly supported by the chat history. Do not infer sensitive attributes, secrets, medical facts, financial account data, or credentials.',
    'Prefer stable preferences, ongoing projects, names the user asked Bob to remember, working style, environment details, and durable constraints.',
    'Return only JSON with this shape: {"factoids":[{"factKey":"short-stable-key","category":"preference|project|identity|environment|workflow|constraint|general","fact":"The user ...","confidence":0.0}]}',
    'If there are no durable user facts, return {"factoids":[]}.',
    '',
    '<chat_memory>',
    transcript || '(No conversation messages yet.)',
    '</chat_memory>'
  ].join('\n');
}

function transcriptFromMessages(messages = []) {
  return JSON.stringify({
    chatHistory: (messages || []).map(row => {
      const role = row?.role === 'assistant' ? 'assistant' : row?.role === 'system' ? 'system' : 'user';
      const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      const skill = String(metadata.skill || row?.skill || '').trim();
      const base = {
        role,
        dateTime: normalizeMessageDateTime(row),
        content: role === 'assistant' && skill === 'web-search'
          ? '[web-search response omitted from memory evidence; use responseFactoids only]'
          : String(row?.content || '')
      };
      if (role === 'assistant') {
        const responseFactoids = Array.isArray(metadata.responseFactoids)
          ? metadata.responseFactoids
          : Array.isArray(row?.responseFactoids)
            ? row.responseFactoids
            : [];
        const output = {
          ...base,
          assistantEmotion: String(row?.assistantEmotion || row?.emotion || metadata.emotion || 'neutral'),
          assistantEmotionIntensity: normalizeEmotionIntensity(row?.assistantEmotionIntensity ?? metadata.assistantEmotionIntensity ?? metadata.emotionIntensity)
        };
        const normalizedFactoids = responseFactoids.map(item => ({
            factKey: String(item?.factKey || item?.key || '').trim(),
            category: String(item?.category || 'general').trim() || 'general',
            fact: String(item?.fact || item?.value || '').trim(),
            confidence: normalizeEmotionIntensity(item?.confidence)
          })).filter(item => item.fact);
        if (normalizedFactoids.length > 0) output.responseFactoids = normalizedFactoids;
        return output;
      }
      if (role === 'user') {
        return {
          ...base,
          detectedUserEmotion: String(row?.detectedUserEmotion || metadata.detectedUserEmotion || metadata.emotion || 'neutral'),
          detectedUserEmotionIntensity: normalizeEmotionIntensity(row?.detectedUserEmotionIntensity ?? metadata.detectedUserEmotionIntensity ?? metadata.emotionIntensity)
        };
      }
      return base;
    })
  }, null, 2);
}

function normalizeMessageDateTime(row = {}) {
  const value = row.dateTime || row.createdAt || row.created_at || row.timestamp || null;
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function normalizeEmotionIntensity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
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

function sanitizeMemorySummary(text, fallback = EMPTY_MEMORY) {
  const raw = String(text || '').trim();
  if (!raw) return fallback || EMPTY_MEMORY;
  if (/^EMPTY$/i.test(raw)) return EMPTY_MEMORY;
  if (BAD_MEMORY_PATTERNS.some(pattern => pattern.test(raw))) return fallback || EMPTY_MEMORY;

  const bullets = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^\*\s+/, '- '))
    .filter(line => line.startsWith('- '))
    .filter(line => !/^-\s*(User|Bob|Assistant)\s*:/i.test(line))
    .filter(line => !/^\-\s*(hi|hello|hey)[!.]?\s*$/i.test(line))
    .filter(line => !BAD_MEMORY_PATTERNS.some(pattern => pattern.test(line)));

  if (bullets.length === 0) return fallback || EMPTY_MEMORY;
  return bullets.join('\n');
}

function createMemorySkillService({
  memory,
  logger,
  generateText,
  intervals = DEFAULT_MEMORY_SUMMARY_INTERVALS,
  budget,
  getErrorText = defaultErrorText,
  userKeyForRequest = requestDatabaseUserKey,
  onMemoryChanged = null
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
    const input = buildMemorySummaryPrompt(scope, transcript);
    const summaryText = await generateText(model, input, { temperature: 0.2 }, { reason: `memory-${scope}-summary` });
    const summary = sanitizeMemorySummary(summaryText);
    return memory.saveSummary({
      req,
      scope,
      summary,
      sourceMessageCount: messages.length,
      model,
      debug: {
        skill: `memory-${scope}-summary`,
        input,
        output: summaryText || '',
        sanitizedOutput: summary
      }
    });
  }

  async function runCascadeUpdate({ req, model, conversationId = 'default', scopes = ['long', 'medium', 'short'] }) {
    const selectedScopes = new Set((Array.isArray(scopes) && scopes.length ? scopes : ['long', 'medium', 'short'])
      .filter(scope => ['long', 'medium', 'short'].includes(scope)));
    const [summaries, messageCount] = await Promise.all([
      memory.getSummaries({ req }),
      memory.getMessageCount({ req, conversationId })
    ]);

    const shortLimit = memory.summaryScopes.short?.limit || 24;
    const newMessages = typeof memory.getUnprocessedMessages === 'function'
      ? await memory.getUnprocessedMessages({ req, summaries, conversationId })
      : await legacyUnprocessedMessages({ req, summaries, messageCount, conversationId, limit: shortLimit });
    const deltaTranscript = transcriptFromMessages(newMessages);

    const result = {};
    const hasLongInput = Boolean(String(summaries.medium?.summary || '').trim());
    const hasMediumInput = Boolean(String(summaries.short?.summary || '').trim());
    const hasShortInput = newMessages.length > 0;

    if (selectedScopes.has('long') && hasLongInput) {
      result.long = await mergeSummary({
        req,
        model,
        scope: 'long',
        existingSummary: summaries.long?.summary || '',
        incomingMemory: summaries.medium?.summary || '',
        incomingLabel: 'existing medium-term memory',
        sourceMessageCount: messageCount
      });
    }

    if (selectedScopes.has('medium') && hasMediumInput) {
      result.medium = await mergeSummary({
        req,
        model,
        scope: 'medium',
        existingSummary: summaries.medium?.summary || '',
        incomingMemory: summaries.short?.summary || '',
        incomingLabel: 'existing short-term memory',
        sourceMessageCount: messageCount
      });
    }

    if (selectedScopes.has('short') && hasShortInput) {
      result.short = await mergeSummary({
        req,
        model,
        scope: 'short',
        existingSummary: summaries.short?.summary || '',
        incomingMemory: deltaTranscript,
        incomingLabel: 'chat messages since the last memory update',
        sourceMessageCount: messageCount
      });
      result.factoids = await refreshFactoidsFromMessages({
        req,
        model,
        conversationId,
        messages: newMessages,
        sourceMessageId: newMessages[newMessages.length - 1]?.id || null
      });
      if (typeof memory.markMessagesMerged === 'function') {
        result.short.mergedMessageCount = await memory.markMessagesMerged({
          req,
          messageIds: newMessages.map(message => message.id)
        });
      }
    }

    return result;
  }

  async function legacyUnprocessedMessages({ req, summaries, messageCount, conversationId, limit }) {
    const shortSourceCount = Number(summaries.short?.sourceMessageCount || 0);
    const newMessageCount = Math.max(0, messageCount - shortSourceCount);
    if (newMessageCount <= 0) return [];
    return memory.getMessages({
      req,
      limit: Math.min(newMessageCount, limit || newMessageCount),
      conversationId
    });
  }

  function cascadeJobKey({ req, conversationId = 'default' }) {
    return `${userKeyForRequest(req)}:${conversationId}:summary-cascade`;
  }

  function requestCascadeUpdate({ req, model, conversationId = 'default', scopes = ['long', 'medium', 'short'], reason = 'manual' }) {
    const jobKey = cascadeJobKey({ req, conversationId });
    if (summaryJobs.has(jobKey)) return Promise.resolve({ skipped: true, reason: 'already-running' });

    summaryJobs.add(jobKey);
    onMemoryChanged?.({ req, type: 'memory-merge-started', count: 1 });
    return runCascadeUpdate({ req, model, conversationId, scopes })
      .then(result => {
        logger?.info?.(`Memory cascade refreshed (${reason})`);
        onMemoryChanged?.({ req, type: 'memory-merge-complete', count: Object.keys(result || {}).length });
        return result;
      })
      .catch(err => {
        logger?.warn?.(`Memory cascade refresh failed (${reason})`, getErrorText(err));
        onMemoryChanged?.({ req, type: 'memory-merge-error', count: 1 });
        throw err;
      })
      .finally(() => summaryJobs.delete(jobKey));
  }

  async function mergeSummary({ req, model, scope, existingSummary, incomingMemory, incomingLabel, sourceMessageCount }) {
    const input = buildMemoryMergePrompt(scope, {
        existingSummary,
        incomingMemory,
        incomingLabel,
        maxWords: memoryBudget.maxWords[scope]
      });
    const summaryText = await generateText(
      model,
      input,
      { temperature: 0.15 },
      { reason: `memory-${scope}-merge` }
    );
    const fallback = sanitizeMemorySummary(existingSummary || EMPTY_MEMORY);
    const summary = sanitizeMemorySummary(summaryText, fallback);

    return memory.saveSummary({
      req,
      scope,
      summary,
      sourceMessageCount,
      model,
      debug: {
        skill: `memory-${scope}-merge`,
        input,
        output: summaryText || '',
        sanitizedOutput: summary
      }
    });
  }

  async function updateSummariesAfterTurn({ req, model, conversationId = 'default' }) {
    try {
      const summaries = await memory.getSummaries({ req });
      const unprocessedMessages = typeof memory.getUnprocessedMessages === 'function'
        ? await memory.getUnprocessedMessages({ req, summaries, conversationId })
        : await memory.getMessages({ req, limit: memory.summaryScopes.short?.limit || 24, conversationId });
      const isDueByContext = isContextPressureHigh(summaries, unprocessedMessages, memoryBudget);

      if (!isDueByContext) return;

      requestCascadeUpdate({
        req,
        model,
        conversationId,
        scopes: ['long', 'medium', 'short'],
        reason: 'context-pressure'
      }).catch(() => {});
    } catch (err) {
      logger?.warn?.('Memory summary scheduler failed', getErrorText(err));
    }
  }

  async function refreshFactoidsFromMessages({ req, model, conversationId = 'default', messages = [], sourceMessageId = null }) {
    if (!Array.isArray(messages) || messages.length === 0) return [];
    if (typeof memory.saveFactoids !== 'function') return [];
    const jobKey = `${userKeyForRequest(req)}:${conversationId}:factoids`;
    if (factoidJobs.has(jobKey)) return [];

    factoidJobs.add(jobKey);
    try {
      const transcript = transcriptFromMessages(messages);
      const text = await generateText(model, buildFactoidExtractionPrompt(transcript), { temperature: 0.1 }, { reason: 'memory-factoids' });
      const saved = await memory.saveFactoids({
        req,
        model,
        sourceMessageId,
        factoids: normalizeFactoids(parseFactoidExtraction(text))
      });
      if (saved.length > 0) {
        logger?.info?.(`Memory factoids refreshed during merge: ${saved.length} saved`);
        onMemoryChanged?.({ req, type: 'factoids', count: saved.length });
      }
      return saved;
    } catch (err) {
      logger?.warn?.('Memory factoid refresh failed', getErrorText(err));
      return [];
    } finally {
      factoidJobs.delete(jobKey);
    }
  }

  async function updateFactoidsAfterTurn({ req, model, conversationId = 'default', sourceMessageId = null }) {
    const messages = typeof memory.getUnprocessedMessages === 'function'
      ? await memory.getUnprocessedMessages({ req, conversationId })
      : await memory.getMessages({ req, limit: 16, conversationId });
    return refreshFactoidsFromMessages({ req, model, conversationId, messages, sourceMessageId });
  }

  function updateAfterTurn({ req, model, conversationId = 'default', sourceMessageId = null } = {}) {
    updateSummariesAfterTurn({ req, model, conversationId });
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
    requestCascadeUpdate,
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
  sanitizeMemorySummary,
  transcriptFromMessages
};
