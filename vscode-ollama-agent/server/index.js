require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const Logger = require('./logger');
const { getAvailableModels, formatModelRef } = require('./ollamaModels');
const { createSecurityMiddleware } = require('./security');
const { createMemoryStore } = require('./memory');
const { createMemorySkillService, estimateTokens, isContextPressureHigh } = require('./memorySkill');
const { createAdminStore } = require('./admin');
const { createActivityMonitor } = require('./activity');
const { createSecurityEventStore } = require('./securityEvents');
const { createYahooStore } = require('./yahoo');
const { createUserChatStore } = require('./userChat');
const { createOllamaConfigStore } = require('./ollamaConfig');
const { buildBobChatSkillInstructions } = require('./bobChatSkill');
const { shouldSearchWeb, extractSearchQuery, searchWeb, buildWebSummaryPrompt } = require('./webSearch');
const { buildSkillInputContract, parseBobChatContract, parseSkillOutputContract } = require('./bobSkillContracts');
const { getTtsProvider, getSupportedTtsProviders, getPiperConfigDetails, getPiperRuntimeStatus, resolveTtsProvider, buildPiperEnv, splitTextForTts, synthesizePiperSpeech } = require('./tts');
const { createTtsSettingsStore } = require('./ttsSettings');
const { requestDatabaseUserKey } = require('./userIdentity');

const app = express();

const PORT = process.env.PORT || 3000;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama2';
const MEMORY_SUMMARY_INTERVALS = {
  short: Number(process.env.MEMORY_SHORT_SUMMARY_INTERVAL || 6),
  medium: Number(process.env.MEMORY_MEDIUM_SUMMARY_INTERVAL || 20),
  long: Number(process.env.MEMORY_LONG_SUMMARY_INTERVAL || 60)
};
const MEMORY_BUDGET = {
  modelContextTokens: Number(process.env.MEMORY_MODEL_CONTEXT_TOKENS || process.env.OLLAMA_MODEL_CONTEXT_TOKENS || 4096),
  triggerRatio: Number(process.env.MEMORY_CONTEXT_TRIGGER_RATIO || 0.72),
  promptReserveTokens: Number(process.env.MEMORY_PROMPT_RESERVE_TOKENS || 1200),
  maxWords: {
    short: Number(process.env.MEMORY_SHORT_MAX_WORDS || 120),
    medium: Number(process.env.MEMORY_MEDIUM_MAX_WORDS || 250),
    long: Number(process.env.MEMORY_LONG_MAX_WORDS || 400)
  }
};
// Support custom OLLAMA_BIN path (useful on Windows where ollama may not be on PATH)
const OLLAMA_BIN = process.env.OLLAMA_BIN || 'ollama';
const DEPLOYMENT_ENV = process.env.DEPLOYMENT_ENV || process.env.NODE_ENV || 'development';

// instantiate logger early so top-level functions (loadRules, routes) can use it without causing a TDZ
const logger = new Logger({ bufferSize: 2000 });
const ttsSettings = createTtsSettingsStore(logger);
const securityEvents = createSecurityEventStore(logger);
const security = createSecurityMiddleware(logger, securityEvents);
const memory = createMemoryStore(logger);
const admin = createAdminStore(logger, securityEvents);
const activity = createActivityMonitor(logger);
const yahoo = createYahooStore(logger);
const userChat = createUserChatStore(logger);
const ollamaConfig = createOllamaConfigStore(logger);
const bobContextUsage = new Map();

function validateProductionConfig() {
  if (DEPLOYMENT_ENV !== 'production') return;

  const unsafeSecretValues = new Set(['change-me-before-production', 'replace-with-generated-secret']);
  const unsafeValues = [
    ['OIDC_CLIENT_SECRET', process.env.OIDC_CLIENT_SECRET],
    ['KEYCLOAK_ADMIN_PASSWORD', process.env.KEYCLOAK_ADMIN_PASSWORD],
    ['KEYCLOAK_DB_PASSWORD', process.env.KEYCLOAK_DB_PASSWORD],
    ['MEMORY_DB_PASSWORD', process.env.MEMORY_DB_PASSWORD]
  ].filter(([, value]) => !value || unsafeSecretValues.has(value));

  if (unsafeValues.length > 0) {
    throw new Error(`Production deployment has unsafe secret values: ${unsafeValues.map(([name]) => name).join(', ')}`);
  }

  if (String(process.env.SECURITY_SECURE_COOKIES || '').toLowerCase() !== 'true') {
    throw new Error('Production deployment requires SECURITY_SECURE_COOKIES=true');
  }

  if (String(process.env.SECURITY_ENABLED || '').toLowerCase() !== 'true') {
    throw new Error('Production deployment requires SECURITY_ENABLED=true');
  }

  if (!String(process.env.OIDC_ISSUER || '').startsWith('https://')) {
    throw new Error('Production deployment requires an HTTPS OIDC_ISSUER');
  }

  if (!String(process.env.OIDC_REDIRECT_URI || '').startsWith('https://')) {
    throw new Error('Production deployment requires an HTTPS OIDC_REDIRECT_URI');
  }

  if (String(process.env.OIDC_ISSUER || '').includes('example.com') || String(process.env.OIDC_REDIRECT_URI || '').includes('example.com')) {
    throw new Error('Production deployment requires real OIDC hostnames, not example.com placeholders');
  }
}

validateProductionConfig();

app.use(security.requestLogger);
app.use(security.securityHeaders);
app.use(cors({
  origin: security.config.corsOrigin || false,
  credentials: true
}));
app.use(express.json());

app.get('/auth/login', security.login);
app.get('/auth/start', security.startLogin);
app.get('/auth/register', security.register);
app.get('/auth/callback', security.callback);
app.get('/health', (req, res) => {
  req.security = { passed: true, policy: 'public-health' };
  res.json({ ok: true, service: 'app' });
});
app.use(security.authenticate);
app.use(admin.attachRoles);
app.use(activity.record);
app.post('/auth/logout', security.logout);
app.get('/api/auth/me', (req, res) => {
  const user = req.user || {};
  res.json({
    ok: true,
    data: {
      name: user.name || user.preferred_username || user.email || 'Signed in user',
      email: user.email || user.preferred_username || user.upn || '',
      subject: user.sub || '',
      roles: req.roles || ['user'],
      isAdmin: Boolean(req.roles?.includes('admin'))
    }
  });
});

// Asset version for cache-busting (set once when server starts)
const ASSET_VERSION = Date.now();

// Serve index.html dynamically and inject a cache-busting query param for included assets.
// This must be registered before express.static, which would otherwise serve index.html directly.
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, '..', 'public', 'index.html');
  fs.readFile(indexPath, 'utf8', (err, data) => {
    if (err) {
      logger.error('Failed to read index.html', err);
      return res.status(500).send('Internal Server Error');
    }
    const v = ASSET_VERSION;
    const replaced = data
      .replace(/(\/app\.js)(["'])/g, `$1?v=${v}$2`)
      .replace(/(\/style\.css)(["'])/g, `$1?v=${v}$2`)
      .replace(/(\/bob-expression-engine\.js)(["'])/g, `$1?v=${v}$2`)
      .replace(/(\/voice-preferences\.js)(["'])/g, `$1?v=${v}$2`)
      .replace(/(\/mic\.js)(["'])/g, `$1?v=${v}$2`)
      .replace(/(\/menu\/[^"']+\.js)(["'])/g, `$1?v=${v}$2`)
      .replace(/(\/menu\.js)(["'])/g, `$1?v=${v}$2`);

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(replaced);
  });
});

// Serve static assets with no-cache headers to ensure clients always check for updates
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));
app.use('/vendor/lucide', express.static(path.join(__dirname, '..', 'node_modules', 'lucide', 'dist', 'umd')));
app.use('/vendor/chart.js', express.static(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist')));

async function synthesizeConfiguredSpeech(text, lang, provider = ttsSettings.current().provider, options = {}) {
  return synthesizePiperSpeech(text, buildPiperEnv(options.piper));
}

function ttsReadinessError(provider) {
  if (provider !== 'piper') return '';
  const piper = getPiperRuntimeStatus();
  if (!piper.hasModel) return 'Piper is not configured. Set TTS_PIPER_MODEL to a Piper .onnx voice model path.';
  return '';
}

// TTS endpoint: returns same-origin audio chunks generated through the configured provider.
app.get('/api/tts', async (req, res) => {
  const text = req.query.text || '';
  const defaults = ttsSettings.current();
  const lang = req.query.lang || defaults.lang || 'en';
  const provider = resolveTtsProvider(req.query.provider, defaults.provider);
  const speaker = req.query.speaker || '';
  const lengthScale = req.query.lengthScale || '';
  const noiseScale = req.query.noiseScale || '';
  const noiseW = req.query.noiseW || '';
  if (!text) return res.status(400).json({ ok: false, error: 'text required' });
  const readinessError = ttsReadinessError(provider);
  if (readinessError) return res.status(503).json({ ok: false, error: readinessError });
  try {
    const chunks = splitTextForTts(text, provider === 'piper' ? 350 : 200);
    const optionParams = new URLSearchParams({
      lang,
      provider,
      speaker,
      lengthScale,
      noiseScale,
      noiseW
    });
    optionParams.set('_', `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const urls = chunks.map(chunk => `/api/tts/audio?${optionParams.toString()}&text=${encodeURIComponent(chunk)}`);

    res.json({ ok: true, provider, lang, urls, url: urls[0] });
  } catch (err) {
    logger.error('tts error', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get('/api/tts/status', async (req, res) => {
  const defaults = ttsSettings.current();
  const piperConfig = getPiperConfigDetails();
  const piperRuntime = getPiperRuntimeStatus();
  res.json({
    ok: true,
    data: {
      provider: defaults.provider,
      providerLabel: defaults.provider === 'piper' ? 'Piper local voice' : defaults.provider,
      defaultLang: defaults.lang || 'en',
      defaults: {
        piperSpeaker: defaults.piperSpeaker || '',
        piperLengthScale: defaults.piperLengthScale || '',
        piperNoiseScale: defaults.piperNoiseScale || '',
        piperNoiseW: defaults.piperNoiseW || ''
      },
      options: {
        lang: [
          defaults.lang || 'en',
          'en',
          'en-US',
          'en-GB'
        ].filter((value, index, list) => value && list.indexOf(value) === index),
        piperSpeaker: piperConfig.speakers || [],
        piperLengthScale: piperConfig.lengthScale || [],
        piperNoiseScale: piperConfig.noiseScale || [],
        piperNoiseW: piperConfig.noiseW || []
      },
      piperConfig,
      piperRuntime,
      piperConfigured: piperRuntime.hasModel
    }
  });
});

app.post('/api/tts/settings', admin.requireAdmin, (req, res) => {
  try {
    const saved = ttsSettings.save(req.body || {});
    logger.info(`TTS settings updated by ${req.user?.email || req.user?.preferred_username || req.user?.name || 'admin'}`);
    res.json({ ok: true, data: saved });
  } catch (err) {
    logger.error('tts settings save failed', err?.message || err);
    res.status(500).json({ ok: false, error: 'Could not save TTS settings' });
  }
});

app.get('/api/tts/audio', async (req, res) => {
  const text = req.query.text || '';
  const defaults = ttsSettings.current();
  const lang = req.query.lang || defaults.lang || 'en';
  const provider = resolveTtsProvider(req.query.provider, defaults.provider);
  const options = {
    piper: {
      speaker: req.query.speaker || defaults.piperSpeaker,
      lengthScale: req.query.lengthScale || defaults.piperLengthScale,
      noiseScale: req.query.noiseScale || defaults.piperNoiseScale,
      noiseW: req.query.noiseW || defaults.piperNoiseW
    }
  };
  if (!text) return res.status(400).json({ ok: false, error: 'text required' });
  const readinessError = ttsReadinessError(provider);
  if (readinessError) return res.status(503).json({ ok: false, error: readinessError });

  try {
    const result = await synthesizeConfiguredSpeech(text, lang, provider, options);

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('X-TTS-Provider', result.provider);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(result.audio);
  } catch (err) {
    logger.error('tts audio error', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Load AI rules
let AI_RULES = {};
const RULES_PATH = path.join(__dirname, '..', '.ai-rules.json');
function loadRules() {
  try {
    AI_RULES = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
    if (typeof logger !== 'undefined' && logger && logger.info) logger.info('AI rules loaded');
    else console.log('AI rules loaded');
  } catch (e) {
    if (typeof logger !== 'undefined' && logger && logger.warn) logger.warn('Failed to load AI rules', e.message);
    else console.warn('Failed to load AI rules', e.message);
    AI_RULES = {};
  }
}
loadRules();
fs.watchFile(RULES_PATH, (curr, prev) => {
  if (typeof logger !== 'undefined' && logger && logger.info) logger.info('.ai-rules.json changed, reloading');
  else console.log('.ai-rules.json changed, reloading');
  loadRules();
});

// Middleware to enforce rules on prompts
function applyAiRules(req, res, next) {
  const prompt = (req.body && req.body.prompt) || req.query.prompt || '';
  const forbidden = (AI_RULES.forbidden && AI_RULES.forbidden.patterns) || [];
  for (const pat of forbidden) {
    try {
      const re = new RegExp(pat, 'i');
      if (re.test(prompt)) return res.status(400).json({ ok: false, error: 'Prompt violates AI rules', pattern: pat });
    } catch (e) { logger.warn('Invalid rule pattern', pat, e.message); }
  }

  const prep = (AI_RULES.transformations && AI_RULES.transformations.prepend) || [];
  const append = (AI_RULES.transformations && AI_RULES.transformations.append) || [];
  const bobChatSkillInstructions = buildBobChatSkillInstructions(req);
  req.ai = {
    originalPrompt: prompt,
    systemInstructions: [...bobChatSkillInstructions, ...prep, ...append]
  };
  next();
}

function getErrorText(err) {
  const data = err?.response?.data;

  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object' && typeof data.pipe !== 'function') {
    try {
      return JSON.stringify(data);
    } catch (jsonErr) {
      return err?.message || String(err);
    }
  }

  return err?.message || String(err);
}

function sendSseError(res, err) {
  const error = getErrorText(err);
  const status = err?.response?.status || 500;

  if (!res.headersSent) {
    res.status(status);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders && res.flushHeaders();
  }

  res.write(`event: error\ndata: ${JSON.stringify(error)}\n\n`);
  res.end();
}

function isAdminRequest(req) {
  return Boolean(req.roles?.includes('admin'));
}

function ollamaDebugMetadata(req, input, output) {
  if (!isAdminRequest(req)) return {};
  return {
    ollamaInput: typeof input === 'string' ? input : JSON.stringify(input || ''),
    ollamaOutput: typeof output === 'string' ? output : JSON.stringify(output || {})
  };
}

function bobContractDebugOutput(contract) {
  return JSON.stringify({
    response: contract?.response || '',
    metadata: contract?.metadata || {}
  }, null, 2);
}

function bobContextUsageKey(req, conversationId = 'default') {
  return `${requestDatabaseUserKey(req)}:${conversationId}`;
}

function rememberBobContextUsage({ req, conversationId = 'default', model, promptTokens }) {
  const tokens = Number(promptTokens);
  if (!Number.isFinite(tokens) || tokens < 0) return;
  bobContextUsage.set(bobContextUsageKey(req, conversationId), {
    model,
    inputTokens: tokens,
    tokenMethod: 'ollama-prompt-eval-count',
    updatedAt: new Date().toISOString()
  });
}

function getBobContextUsage(req, conversationId = 'default') {
  return bobContextUsage.get(bobContextUsageKey(req, conversationId)) || null;
}

function buildBobContextMetadata({ estimatedInputTokens, actualInputTokens, tokenMethod, model, conversationId = 'default' }) {
  const actual = Number(actualInputTokens);
  const hasActual = Number.isFinite(actual) && actual >= 0;
  const estimated = Math.max(0, Number(estimatedInputTokens) || 0);
  return {
    model,
    conversationId,
    Estimated: estimated,
    Actual: hasActual ? actual : null,
    tokenMethod: hasActual ? (tokenMethod || 'ollama-prompt-eval-count') : 'local-character-estimate',
    modelContextTokens: memorySkill.budget.modelContextTokens,
    triggerTokens: Math.round(memorySkill.budget.modelContextTokens * memorySkill.budget.triggerRatio)
  };
}

async function generateOllamaText(model, prompt, options = {}) {
  const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
    model,
    prompt,
    stream: false,
    keep_alive: ollamaConfig.current().keepAlive,
    options
  }, {
    responseType: 'json',
    headers: { 'Content-Type': 'application/json' },
    timeout: 120000
  });

  return String(response.data?.response || '').trim();
}

async function buildBobPromptContext({ req, prompt, conversationId = 'default' }) {
  const [summaries, factoids] = await Promise.all([
    memory.getSummaries({ req }),
    memory.getFactoids({ req, limit: 50 })
  ]);
  const history = typeof memory.getUnprocessedMessages === 'function'
    ? await memory.getUnprocessedMessages({
      req,
      summaries,
      limit: memory.summaryScopes.short?.limit || 24,
      conversationId
    })
    : await memory.getRecent({ req, conversationId });
  const promptWithMemory = memory.buildPrompt(prompt, history, summaries, factoids, {
    systemInstructions: req.ai?.systemInstructions || []
  });

  return {
    factoids,
    history,
    promptWithMemory,
    summaries
  };
}

const memorySkill = createMemorySkillService({
  memory,
  logger,
  generateText: generateOllamaText,
  intervals: MEMORY_SUMMARY_INTERVALS,
  budget: MEMORY_BUDGET,
  getErrorText
});

async function runWebSearchSkill({ req, model, prompt }) {
  const query = extractSearchQuery(prompt);
  const results = await searchWeb(query);
  const inputContract = buildSkillInputContract({
    skill: 'web-search',
    prompt,
    context: { query, results }
  });
  const summaryPrompt = buildWebSummaryPrompt(prompt, query, results);
  const rawSummary = await generateOllamaText(model, summaryPrompt, { temperature: 0.2 });
  const fallback = results.length
    ? [
        `I searched the web for "${query}" and found these sources:`,
        '',
        ...results.map((item, index) => `${index + 1}. ${item.title} - ${item.url}${item.snippet ? `\n   ${item.snippet}` : ''}`)
      ].join('\n')
    : `I searched the web for "${query}", but I could not find usable results.`;
  const contract = parseSkillOutputContract(rawSummary, {
    skill: 'web-search',
    response: fallback,
    emotion: results.length ? 'focused' : 'concerned',
    data: { query },
    sources: results
  });
  contract.output.data = { query, ...(contract.output.data || {}) };
  contract.output.sources = contract.output.sources.length ? contract.output.sources : results;

  return {
    query,
    results,
    inputContract,
    outputContract: contract,
    response: contract.output.response || fallback,
    metadata: contract.output.metadata,
    sources: contract.output.sources,
    ollamaInput: summaryPrompt,
    ollamaOutput: rawSummary || fallback
  };
}

// expose rules endpoints
app.get('/api/rules', admin.requireAdmin, (req, res) => {
  res.json({ ok: true, data: AI_RULES });
});
app.post('/api/rules', admin.requireAdmin, (req, res) => {
  // basic: overwrite file (in real app add auth)
  try { fs.writeFileSync(RULES_PATH, JSON.stringify(req.body, null, 2), 'utf8'); loadRules(); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/memory/history', memory.historyHandler);
app.get('/api/memory/manager', memory.managerHandler);
app.get('/api/memory/context', applyAiRules, async (req, res) => {
  try {
    const model = req.query.model || DEFAULT_MODEL;
    const conversationId = req.query.conversationId || 'default';
    const prompt = req.ai?.originalPrompt || req.query.prompt || '';
    const [context, messageCount] = await Promise.all([
      buildBobPromptContext({ req, prompt, conversationId }),
      memory.getMessageCount({ req, conversationId })
    ]);
    const { history, summaries, promptWithMemory } = context;
    const estimatedInputTokens = estimateTokens(promptWithMemory);
    const actualUsage = getBobContextUsage(req, conversationId);
    const inputTokens = actualUsage?.inputTokens ?? estimatedInputTokens;
    const budget = memorySkill.budget;
    const memoryPressureTokens = Object.values(summaries || {}).reduce((total, summary) => total + estimateTokens(summary?.summary), 0) +
      (history || []).reduce((total, message) => total + estimateTokens(message?.content), 0);
    const messageDue = Object.keys(memory.summaryScopes).some(scope => {
      const interval = Math.max(1, Number(MEMORY_SUMMARY_INTERVALS[scope]) || 1);
      const sourceCount = Number(summaries[scope]?.sourceMessageCount || 0);
      return messageCount > 0 && messageCount - sourceCount >= interval;
    });
    const contextDue = isContextPressureHigh(summaries, history, budget);

    res.json({
      ok: true,
      data: {
        model,
        conversationId,
        inputTokens,
        estimatedInputTokens,
        actualInputTokens: actualUsage?.inputTokens ?? null,
        tokenMethod: actualUsage?.tokenMethod || 'local-character-estimate',
        actualUpdatedAt: actualUsage?.updatedAt || null,
        modelContextTokens: budget.modelContextTokens,
        usageRatio: Math.min(1, inputTokens / Math.max(1, budget.modelContextTokens)),
        triggerRatio: budget.triggerRatio,
        triggerTokens: Math.round(budget.modelContextTokens * budget.triggerRatio),
        memoryPressureTokens,
        memoryPressureTriggerTokens: Math.round(budget.availableMemoryTokens * budget.triggerRatio),
        updateDue: messageDue || contextDue,
        updateReason: contextDue ? 'context' : messageDue ? 'messages' : '',
        updating: memorySkill.isUpdating({ req, conversationId }),
        unprocessedMessages: history.length,
        maxWords: budget.maxWords
      }
    });
  } catch (err) {
    logger.error('memory context error', getErrorText(err));
    res.status(500).json({ ok: false, error: 'Memory context unavailable' });
  }
});
app.delete('/api/memory/messages/:id', async (req, res) => {
  try {
    const deleted = await memory.deleteMessage({ req, id: req.params.id });
    if (!deleted) return res.status(404).json({ ok: false, error: 'Chat memory item not found' });
    res.json({ ok: true });
  } catch (err) {
    logger.error('memory message delete failed', getErrorText(err));
    res.status(500).json({ ok: false, error: 'Could not delete chat memory item' });
  }
});
app.delete('/api/memory/factoids/:id', async (req, res) => {
  try {
    const deleted = await memory.deleteFactoid({ req, id: req.params.id });
    if (!deleted) return res.status(404).json({ ok: false, error: 'Factoid not found' });
    res.json({ ok: true });
  } catch (err) {
    logger.error('memory factoid delete failed', getErrorText(err));
    res.status(500).json({ ok: false, error: 'Could not delete factoid' });
  }
});
app.delete('/api/memory', async (req, res) => {
  if (req.body?.confirm !== 'WIPE') {
    return res.status(400).json({ ok: false, error: 'Type WIPE to confirm memory deletion' });
  }

  try {
    const deleted = await memory.clearAll({ req });
    res.json({ ok: true, data: deleted });
  } catch (err) {
    logger.error('memory wipe failed', getErrorText(err));
    res.status(500).json({ ok: false, error: 'Could not wipe memory' });
  }
});
app.post('/api/memory/summarize', async (req, res) => {
  const scope = req.body?.scope || 'cascade';
  const scopeConfig = memory.summaryScopes[scope];
  const isCascade = scope === 'cascade' || scope === 'all';
  if (!isCascade && !scopeConfig) return res.status(400).json({ ok: false, error: 'Invalid memory scope' });

  try {
    const model = req.body?.model || DEFAULT_MODEL;
    const summary = isCascade
      ? await memorySkill.runCascadeUpdate({ req, model, conversationId: req.body?.conversationId || 'default' })
      : await memorySkill.refreshSummary({ req, model, scope, conversationId: req.body?.conversationId || 'default' });
    res.json({ ok: true, data: summary });
  } catch (err) {
    const error = getErrorText(err);
    logger.error(`memory summarize ${scope} failed`, error);
    res.status(err?.response?.status || 500).json({ ok: false, error });
  }
});
app.get('/api/admin/bootstrap/status', admin.bootstrapStatus);
app.post('/api/admin/bootstrap', admin.bootstrapSelf);
app.get('/api/admin/links', admin.requireAdmin, (req, res) => {
  res.json({
    ok: true,
    data: {
      vaultwarden: process.env.VAULT_SITE || ''
    }
  });
});
app.get('/api/admin/users', admin.requireAdmin, admin.listUsers);
app.post('/api/admin/users/:userKey/roles/admin', admin.requireAdmin, admin.setUserAdmin);
app.delete('/api/admin/users/:userKey/roles/admin', admin.requireAdmin, admin.removeUserAdmin);
app.get('/api/activity/dashboard', admin.requireAdmin, activity.dashboard);
app.get('/api/security/dashboard', admin.requireAdmin, securityEvents.dashboard);
app.get('/api/yahoo/oauth/start', yahoo.startHandler);
app.get('/api/yahoo/oauth/callback', yahoo.callbackHandler);
app.get('/api/yahoo/account', yahoo.statusHandler);
app.post('/api/yahoo/oauth/refresh', yahoo.refreshHandler);
app.post('/api/yahoo/oauth/disconnect', yahoo.disconnectHandler);
app.post('/api/user-chat/key', userChat.upsertKey);
app.get('/api/user-chat/users', userChat.listUsers);
app.get('/api/user-chat/messages', userChat.listMessages);
app.post('/api/user-chat/messages', userChat.sendMessage);

// Non-streaming API proxy (awaits full response)
app.post('/api/chat', applyAiRules, async (req, res) => {
  try {
    const { model, prompt, parameters } = req.body;
    const chatModel = model || DEFAULT_MODEL;
    const originalPrompt = req.ai?.originalPrompt || prompt || '';

    if (shouldSearchWeb(originalPrompt)) {
      const search = await runWebSearchSkill({ req, model: chatModel, prompt: originalPrompt });
      await memory.addMessage({ req, role: 'user', model: chatModel, content: originalPrompt });
      await memory.addMessage({
        req,
        role: 'assistant',
        model: chatModel,
        content: search.response,
        metadata: {
          skill: 'web-search',
          skills: ['web-search'],
          ...search.metadata,
          inputContract: search.inputContract,
          outputContract: search.outputContract,
          query: search.query,
          results: search.sources,
          ...ollamaDebugMetadata(req, search.ollamaInput, search.ollamaOutput)
        }
      });
      memorySkill.updateAfterTurn({ req, model: chatModel });
      return res.json({
        ok: true,
        data: {
          response: search.response,
          done: true,
          skill: 'web-search',
          skills: ['web-search'],
          metadata: search.metadata,
          inputContract: search.inputContract,
          outputContract: search.outputContract,
          query: search.query,
          sources: search.sources,
          ...(isAdminRequest(req) ? { ollamaInput: search.ollamaInput, ollamaOutput: search.ollamaOutput } : {})
        }
      });
    }

    const { promptWithMemory } = await buildBobPromptContext({
      req,
      prompt: originalPrompt
    });
    const payload = Object.assign({
      model: chatModel,
      prompt: promptWithMemory,
      keep_alive: ollamaConfig.current().keepAlive
    }, parameters || {});

    const resp = await axios.post(`${OLLAMA_URL}/api/generate`, payload, {
      responseType: 'json',
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000
    });
    const estimatedInputTokens = estimateTokens(promptWithMemory);
    const actualInputTokens = Number(resp.data?.prompt_eval_count);
    rememberBobContextUsage({
      req,
      model: chatModel,
      promptTokens: actualInputTokens
    });

    await memory.addMessage({ req, role: 'user', model: chatModel, content: originalPrompt });
    const rawBobOutput = String(resp.data?.response || '');
    const bobContract = parseBobChatContract(rawBobOutput);
    const ctxMetadata = buildBobContextMetadata({
      estimatedInputTokens,
      actualInputTokens,
      tokenMethod: 'ollama-prompt-eval-count',
      model: chatModel
    });
    const responseMetadata = {
      ...bobContract.metadata,
      ctx: ctxMetadata
    };
    const assistantMessage = await memory.addMessage({
      req,
      role: 'assistant',
      model: chatModel,
      content: bobContract.response,
      metadata: {
        skill: 'bob-chat',
        skills: ['bob-chat'],
        ...responseMetadata,
        ...ollamaDebugMetadata(req, promptWithMemory, bobContractDebugOutput(bobContract))
      }
    });
    memorySkill.updateAfterTurn({ req, model: chatModel, sourceMessageId: assistantMessage?.id });
    res.json({
      ok: true,
      data: {
        ...resp.data,
        response: bobContract.response,
        metadata: responseMetadata
      }
    });
  } catch (err) {
    const error = getErrorText(err);
    logger.error('chat error', error);
    res.status(err?.response?.status || 500).json({ ok: false, error });
  }
});

// Streaming endpoint that proxies Ollama's streaming response to the browser as Server-Sent Events
app.get('/api/stream', applyAiRules, async (req, res) => {
  const model = req.query.model || DEFAULT_MODEL;
  const prompt = req.query.prompt || '';
  const originalPrompt = req.ai?.originalPrompt || prompt;

  logger.info(`Streaming chat request using model ${model}`);

  try {
    if (shouldSearchWeb(originalPrompt)) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders && res.flushHeaders();

      await memory.addMessage({ req, role: 'user', model, content: originalPrompt });
      const search = await runWebSearchSkill({ req, model, prompt: originalPrompt });
      await memory.addMessage({
        req,
        role: 'assistant',
        model,
        content: search.response,
        metadata: {
          skill: 'web-search',
          skills: ['web-search'],
          ...search.metadata,
          inputContract: search.inputContract,
          outputContract: search.outputContract,
          query: search.query,
          results: search.sources,
          ...ollamaDebugMetadata(req, search.ollamaInput, search.ollamaOutput)
        }
      });
      memorySkill.updateAfterTurn({ req, model });

      res.write(`data: ${JSON.stringify({
        response: search.response,
        done: true,
        skill: 'web-search',
        skills: ['web-search'],
        metadata: search.metadata,
        inputContract: search.inputContract,
        outputContract: search.outputContract,
        query: search.query,
        sources: search.sources,
        ...(isAdminRequest(req) ? { ollamaInput: search.ollamaInput, ollamaOutput: search.ollamaOutput } : {})
      })}\n\n`);
      res.write('event: done\ndata: [DONE]\n\n');
      return res.end();
    }

    const { promptWithMemory } = await buildBobPromptContext({
      req,
      prompt: originalPrompt
    });
    const payload = {
      model,
      keep_alive: ollamaConfig.current().keepAlive,
      prompt: promptWithMemory
    };
    await memory.addMessage({ req, role: 'user', model, content: originalPrompt });
    const resp = await axios.post(`${OLLAMA_URL}/api/generate`, payload, {
      responseType: 'stream',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      timeout: 0
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders && res.flushHeaders();
    res.write(`event: skills\ndata: ${JSON.stringify({ skills: ['bob-chat'] })}\n\n`);
    if (isAdminRequest(req)) {
      res.write(`event: ollama-debug\ndata: ${JSON.stringify({ ollamaInput: payload.prompt })}\n\n`);
    }

    const stream = resp.data;
    let rawAssistantResponse = '';
    let promptEvalCount = null;

    stream.on('data', (chunk) => {
      try {
        const text = chunk.toString();
        text.split(/\r?\n/).forEach((line) => {
          if (!line) return;
          try {
            const parsed = JSON.parse(line);
            if (typeof parsed.response === 'string') rawAssistantResponse += parsed.response;
            const parsedPromptEvalCount = Number(parsed.prompt_eval_count);
            if (Number.isFinite(parsedPromptEvalCount) && parsedPromptEvalCount >= 0) {
              promptEvalCount = parsedPromptEvalCount;
            }
          } catch (parseErr) {}
        });
      } catch (e) {}
    });

    stream.on('end', async () => {
      const estimatedInputTokens = estimateTokens(promptWithMemory);
      rememberBobContextUsage({ req, model, promptTokens: promptEvalCount });
      const bobContract = parseBobChatContract(rawAssistantResponse);
      const ctxMetadata = buildBobContextMetadata({
        estimatedInputTokens,
        actualInputTokens: promptEvalCount,
        tokenMethod: 'ollama-prompt-eval-count',
        model
      });
      const responseMetadata = {
        ...bobContract.metadata,
        ctx: ctxMetadata
      };
      const assistantMessage = await memory.addMessage({
        req,
        role: 'assistant',
        model,
        content: bobContract.response,
        metadata: {
          skill: 'bob-chat',
          skills: ['bob-chat'],
          ...responseMetadata,
          ...ollamaDebugMetadata(req, payload.prompt, bobContractDebugOutput(bobContract))
        }
      });
      memorySkill.updateAfterTurn({ req, model, sourceMessageId: assistantMessage?.id });
      if (isAdminRequest(req)) {
        res.write(`event: ollama-debug\ndata: ${JSON.stringify({ ollamaOutput: bobContractDebugOutput(bobContract) })}\n\n`);
      }
      res.write(`event: bob-response\ndata: ${JSON.stringify({
        response: bobContract.response,
        metadata: responseMetadata,
        skill: 'bob-chat',
        skills: ['bob-chat']
      })}\n\n`);
      res.write('event: done\ndata: [DONE]\n\n');
      res.end();
    });
    stream.on('error', (err) => { logger.error('stream error', getErrorText(err)); sendSseError(res, err); });
    req.on('close', () => { stream.destroy && stream.destroy(); });
  } catch (err) {
    const error = getErrorText(err);
    logger.error('stream setup error', error);
    sendSseError(res, err);
  }
});

// Ollama management: list models (HTTP proxy if available, fallback to `ollama list`)
app.get('/api/ollama/models', async (req, res) => {
  try {
    const resp = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 5000 });
    const models = Array.isArray(resp.data?.models) ? resp.data.models : resp.data;
    logger.info('Ollama HTTP API /api/tags succeeded');
    return res.json({ ok: true, data: models });
  } catch (httpErr) {
    logger.warn('Ollama HTTP API failed, trying CLI fallback', httpErr?.message || httpErr);
    // Fallback to ollama CLI
    exec(`"${OLLAMA_BIN}" list`, { timeout: 10000 }, (e, stdout, stderr) => {
      if (e) {
        logger.error('ollama list CLI failed', stderr || e.message);
        return res.status(500).json({ ok: false, error: `Ollama not available: ${stderr || e.message}. Ensure Ollama is running on ${OLLAMA_URL} or set OLLAMA_BIN environment variable.` });
      }
      const lines = stdout.split(/\r?\n/).filter(l => l.trim());
      // Try to extract model names
      const models = lines.map(l => {
        // common output: "model-name (size)"
        const parts = l.split(/\s+/);
        return parts[0];
      }).filter(m => m);
      logger.info(`ollama list CLI succeeded, found ${models.length} models`);
      res.json({ ok: true, data: models });
    });
  }
});

// Pull/install a model via the ollama CLI
app.post('/api/ollama/pull', admin.requireAdmin, (req, res) => {
  const model = req.body.model;
  if (!model) return res.status(400).json({ ok: false, error: 'model required' });
  logger.info(`Starting ollama pull ${model}`);

  axios.post(`${OLLAMA_URL}/api/pull`, { model, stream: false }, { timeout: 30 * 60 * 1000 })
    .then((resp) => {
      logger.info(`ollama pull ${model} succeeded via HTTP API`);
      res.json({ ok: true, data: resp.data });
    })
    .catch((httpErr) => {
      logger.warn(`ollama HTTP pull ${model} failed, trying CLI fallback`, getErrorText(httpErr));
      exec(`"${OLLAMA_BIN}" pull ${model}`, { timeout: 30 * 60 * 1000 }, (err, stdout, stderr) => {
        if (err) {
          const error = stderr || err.message;
          logger.error(`ollama pull ${model} failed`, error);
          return res.status(500).json({ ok: false, error: `Pull failed: ${error}` });
        }
        logger.info(`ollama pull ${model} succeeded via CLI`);
        res.json({ ok: true, out: stdout });
      });
    });
});

app.get('/api/ollama/config', admin.requireAdmin, (req, res) => {
  res.json({
    ok: true,
    data: {
      url: OLLAMA_URL,
      defaultModel: DEFAULT_MODEL,
      ...ollamaConfig.current()
    }
  });
});

app.post('/api/ollama/config', admin.requireAdmin, (req, res) => {
  try {
    const saved = ollamaConfig.save(req.body || {});
    logger.info(`Ollama config updated by ${req.user?.email || req.user?.preferred_username || req.user?.name || 'admin'}`);
    res.json({ ok: true, data: saved });
  } catch (err) {
    logger.error('ollama config save failed', err?.message || err);
    res.status(500).json({ ok: false, error: 'Could not save Ollama config' });
  }
});

// Remove a model via the ollama CLI
app.post('/api/ollama/remove', admin.requireAdmin, (req, res) => {
  const model = req.body.model;
  if (!model) return res.status(400).json({ ok: false, error: 'model required' });
  logger.info(`Starting ollama rm ${model}`);

  axios.delete(`${OLLAMA_URL}/api/delete`, {
    data: { model },
    timeout: 2 * 60 * 1000,
    headers: { 'Content-Type': 'application/json' }
  })
    .then((resp) => {
      logger.info(`ollama rm ${model} succeeded via HTTP API`);
      res.json({ ok: true, data: resp.data });
    })
    .catch((httpErr) => {
      logger.warn(`ollama HTTP rm ${model} failed, trying CLI fallback`, getErrorText(httpErr));
      exec(`"${OLLAMA_BIN}" rm ${model}`, { timeout: 2 * 60 * 1000 }, (err, stdout, stderr) => {
        if (err) {
          const error = stderr || err.message;
          logger.error(`ollama rm ${model} failed`, error);
          return res.status(500).json({ ok: false, error: `Remove failed: ${error}` });
        }
        logger.info(`ollama rm ${model} succeeded via CLI`);
        res.json({ ok: true, out: stdout });
      });
    });
});

// Monitor endpoint: try HTTP status, else run `ollama status` and return text
app.get('/api/ollama/monitor', admin.requireAdmin, async (req, res) => {
  try {
    const resp = await axios.get(`${OLLAMA_URL}/api/status`, { timeout: 5000 });
    logger.info('Ollama HTTP API /api/status succeeded');
    return res.json({ ok: true, data: resp.data });
  } catch (httpErr) {
    logger.warn('Ollama HTTP API /api/status failed, trying CLI', httpErr?.message || httpErr);
    exec(`"${OLLAMA_BIN}" status`, { timeout: 10000 }, (e, stdout, stderr) => {
      if (e) {
        logger.error('ollama status CLI failed', stderr || e.message);
        return res.status(500).json({ ok: false, error: `Ollama not available: ${stderr || e.message}. Ensure Ollama is running on ${OLLAMA_URL}.` });
      }
      res.json({ ok: true, data: { status: stdout.trim() } });
    });
  }
});

// Available models list from Ollama's official library
app.get('/api/ollama/available', admin.requireAdmin, async (req, res) => {
  try {
    const models = await getAvailableModels(logger);
    logger.info(`Returning ${models.length} available models to client`);
    res.json({ ok: true, data: models });
  } catch (err) {
    logger.error('Failed to fetch available models', err?.message || err);
    res.status(500).json({ ok: false, error: 'Failed to fetch available models' });
  }
});

// Remote control: soft reboot endpoint
app.post('/api/control/reboot', admin.requireAdmin, (req, res) => {
  logger.info('Soft reboot requested via API');
  res.json({ ok: true, msg: 'Rebooting server' });

  try {
    const node = process.execPath; // path to node executable
    const script = path.join(__dirname, 'index.js');
    logger.info(`Spawning detached process: ${node} ${script}`);
    const child = require('child_process').spawn(node, [script], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, PORT: process.env.PORT || 3000 }
    });
    child.unref();

    // Give the new process time to start, then shut down current one
    setTimeout(() => shutdownServer(0), 500); // Wait 500ms for new process to bind to port
  } catch (e) {
    logger.error('Reboot spawn failed:', e?.message);
  }
});

app.get('/api/ollama/monitor/details', admin.requireAdmin, async (req, res) => {
  const request = async (method, endpoint, data) => {
    try {
      const resp = await axios({
        method,
        url: `${OLLAMA_URL}${endpoint}`,
        data,
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      });
      return { ok: true, data: resp.data };
    } catch (err) {
      return { ok: false, error: getErrorText(err) };
    }
  };

  const [version, tags, running] = await Promise.all([
    request('get', '/api/version'),
    request('get', '/api/tags'),
    request('get', '/api/ps')
  ]);

  res.json({
    ok: version.ok || tags.ok || running.ok,
    data: {
      url: OLLAMA_URL,
      defaultModel: DEFAULT_MODEL,
      config: ollamaConfig.current(),
      version: version.data || null,
      models: tags.data?.models || [],
      running: running.data?.models || [],
      errors: {
        version: version.ok ? null : version.error,
        models: tags.ok ? null : tags.error,
        running: running.ok ? null : running.error
      }
    }
  });
});

app.post('/api/ollama/show', admin.requireAdmin, async (req, res) => {
  const model = req.body.model;
  if (!model) return res.status(400).json({ ok: false, error: 'model required' });

  try {
    const resp = await axios.post(`${OLLAMA_URL}/api/show`, { model }, { timeout: 30000 });
    res.json({ ok: true, data: resp.data });
  } catch (err) {
    const error = getErrorText(err);
    logger.error(`ollama show ${model} failed`, error);
    res.status(err?.response?.status || 500).json({ ok: false, error });
  }
});

app.post('/api/ollama/load', admin.requireAdmin, async (req, res) => {
  const model = req.body.model;
  const keepAlive = req.body.keepAlive || '5m';
  if (!model) return res.status(400).json({ ok: false, error: 'model required' });

  try {
    logger.info(`Loading model ${model} with keep_alive ${keepAlive}`);
    const resp = await axios.post(`${OLLAMA_URL}/api/generate`, {
      model,
      prompt: '',
      keep_alive: keepAlive,
      stream: false
    }, { timeout: 120000 });
    res.json({ ok: true, data: resp.data });
  } catch (err) {
    const error = getErrorText(err);
    logger.error(`ollama load ${model} failed`, error);
    res.status(err?.response?.status || 500).json({ ok: false, error });
  }
});

app.post('/api/ollama/unload', admin.requireAdmin, async (req, res) => {
  const model = req.body.model;
  if (!model) return res.status(400).json({ ok: false, error: 'model required' });

  try {
    logger.info(`Unloading model ${model}`);
    const resp = await axios.post(`${OLLAMA_URL}/api/generate`, {
      model,
      prompt: '',
      keep_alive: 0,
      stream: false
    }, { timeout: 30000 });
    res.json({ ok: true, data: resp.data });
  } catch (err) {
    const error = getErrorText(err);
    logger.error(`ollama unload ${model} failed`, error);
    res.status(err?.response?.status || 500).json({ ok: false, error });
  }
});

app.post('/api/control/shutdown', admin.requireAdmin, (req, res) => {
  logger.info('Shutdown requested via API');
  res.json({ ok: true, msg: 'Shutting down server' });
  setTimeout(() => shutdownServer(0), 100);
});

// Provide logs history
app.get('/api/logs', admin.requireAdmin, (req, res) => {
  res.json({ ok: true, data: logger.history(500) });
});

// SSE stream of logs
app.get('/api/logs/stream', admin.requireAdmin, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders && res.flushHeaders();

  const send = (entry) => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  };
  res.write('retry: 2000\n\n');
  // send recent history first
  logger.history(200).forEach(send);
  logger.on('log', send);
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    logger.removeListener('log', send);
  });
});

// Redirect unknown routes to root (SPA fallback) — must be last!
function shutdownServer(exitCode = 0) {
  try {
    logger.info('Closing server connections');
    if (server) {
      server.close(async () => {
        await memory.shutdown();
        await admin.shutdown();
        await activity.shutdown();
        await securityEvents.shutdown();
        await yahoo.shutdown();
        await userChat.shutdown();
        logger.info('Server closed, exiting process');
        process.exit(exitCode);
      });
    }

    setTimeout(() => {
      logger.warn('Force exiting process (shutdown timeout)');
      process.exit(exitCode || 1);
    }, 3000);
  } catch (e) {
    logger.error('Error during server shutdown:', e?.message);
    process.exit(1);
  }
}

app.get('*', (req, res) => {
  res.redirect('/');
});

// start server
const server = app.listen(PORT, () => {
  logger.info(`Server listening on http://localhost:${PORT} — proxying Ollama at ${OLLAMA_URL}`);
  logger.info(`Security middleware ${security.config.enabled ? 'enabled' : 'disabled'}`);
});
