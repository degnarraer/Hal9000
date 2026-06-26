require('dotenv').config();
const crypto = require('crypto');
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
const { createMemorySkillService, estimateTokens, isContextPressureHigh, transcriptFromMessages } = require('./memorySkill');
const { createAdminStore } = require('./admin');
const { createActivityMonitor } = require('./activity');
const { createSecurityEventStore } = require('./securityEvents');
const { createYahooStore } = require('./yahoo');
const { createUserChatStore } = require('./userChat');
const { createOllamaConfigStore } = require('./ollamaConfig');
const { buildBobChatFallbackResponse, buildBobChatSkillInstructions } = require('./bobChatSkill');
const { buildBobEmotionPrompt, heuristicBobEmotion, parseBobEmotionContract } = require('./bobEmotionSkill');
const { BOB_ROUTER_SKILLS, buildBobRouterPrompt, heuristicBobRoute, isAutoModel, parseBobRouterContract, parseModelSizeB, sanitizeModelRules, selectBobModel, selectRouterModel } = require('./bobRouterSkill');
const { shouldSearchWeb, extractSearchQuery, searchWeb, buildWebFallbackResponse, buildWebSummaryPrompt, hasUnsupportedWebClaims, isSearchDumpResponse } = require('./webSearch');
const { BOB_CHAT_RESPONSE_CONTRACT, BOB_EMOTIONS, buildSkillInputContract, parseBobChatContract, parseJsonObject, parseSkillOutputContract } = require('./bobSkillContracts');
const { filterSupportedFactoids } = require('./memoryFactoids');
const { createStreamingResponseSentenceEmitter, extractStreamingResponseText } = require('./bobStreamingText');
const { getTtsProvider, getSupportedTtsProviders, getPiperConfigDetails, getPiperRuntimeStatus, getRhubarbRuntimeStatus, resolveTtsProvider, buildPiperEnv, splitTextForTts, synthesizePiperSpeech, synthesizePiperSpeechFile, generateRhubarbVisemes } = require('./tts');
const { createTtsSettingsStore } = require('./ttsSettings');
const { requestDatabaseUserKey, userDisplayName } = require('./userIdentity');

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
const MAX_PULL_JOBS = Number(process.env.OLLAMA_PULL_JOB_HISTORY || 50);
const ROUTER_MODEL_MIN_SIZE_B = Number(process.env.OLLAMA_ROUTER_MODEL_MIN_B || 3);
const AUTO_MODEL_FALLBACK_MIN_SIZE_B = Number(process.env.OLLAMA_AUTO_MODEL_FALLBACK_MIN_B || 2);
const BOB_STAGE_DEFINITIONS_PATH = process.env.BOB_STAGE_DEFINITIONS_PATH || path.join(__dirname, '..', '.bob-stage-definitions.json');
const BOB_SKILL_DEFINITIONS_PATH = process.env.BOB_SKILL_DEFINITIONS_PATH || path.join(__dirname, '..', '.bob-skill-definitions.json');
const MEMORY_BACKGROUND_FACTOIDS = String(process.env.MEMORY_BACKGROUND_FACTOIDS || '').toLowerCase() === 'true';

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
const memoryEventClients = new Map();
const ttsGeneratedAudio = new Map();
const TTS_GENERATED_AUDIO_TTL_MS = Number(process.env.TTS_GENERATED_AUDIO_TTL_MS || 5 * 60 * 1000);

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
const ASSET_VERSION = String(Date.now());
const CACHE_BUSTED_ASSET_EXTENSIONS = new Set([
  '.css',
  '.js',
  '.mjs',
  '.json',
  '.webmanifest',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.wav',
  '.mp3',
  '.ogg'
]);

function withServerStartAssetVersion(url = '') {
  const raw = String(url || '');
  if (!raw.startsWith('/') || raw.startsWith('//')) return raw;
  if (raw.startsWith('/api/') || raw.startsWith('/auth/')) return raw;

  const [withoutHash, hash = ''] = raw.split('#');
  const [pathname, query = ''] = withoutHash.split('?');
  const extension = path.extname(pathname).toLowerCase();
  if (!CACHE_BUSTED_ASSET_EXTENSIONS.has(extension)) return raw;

  const params = new URLSearchParams(query);
  params.set('v', ASSET_VERSION);
  const nextQuery = params.toString();
  return `${pathname}${nextQuery ? `?${nextQuery}` : ''}${hash ? `#${hash}` : ''}`;
}

function injectServerStartAssetVersions(html = '') {
  return String(html || '').replace(/\b(src|href)=(["'])(\/[^"']+)\2/g, (_match, attribute, quote, url) => {
    return `${attribute}=${quote}${withServerStartAssetVersion(url)}${quote}`;
  });
}

// Serve index.html dynamically and inject a cache-busting query param for included assets.
// This must be registered before express.static, which would otherwise serve index.html directly.
function serveVersionedIndex(req, res) {
  const indexPath = path.join(__dirname, '..', 'public', 'index.html');
  fs.readFile(indexPath, 'utf8', (err, data) => {
    if (err) {
      logger.error('Failed to read index.html', err);
      return res.status(500).send('Internal Server Error');
    }
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(injectServerStartAssetVersions(data));
  });
}

app.get('/', serveVersionedIndex);
app.get('/index.html', serveVersionedIndex);

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

async function synthesizeConfiguredSpeechFile(text, lang, provider = ttsSettings.current().provider, options = {}) {
  return synthesizePiperSpeechFile(text, buildPiperEnv(options.piper));
}

function ttsReadinessError(provider) {
  if (provider !== 'piper') return '';
  const piper = getPiperRuntimeStatus();
  if (!piper.hasModel) return 'Piper is not configured. Set TTS_PIPER_MODEL to a Piper .onnx voice model path.';
  if (!piper.modelExists) return `Piper model file is not mounted or readable at ${piper.model}.`;
  if (piper.hasConfig && !piper.configLoaded) return `Piper config file is not mounted or readable at ${piper.config}.`;
  if (!piper.binExists) return `Piper executable is not mounted or readable at ${piper.bin}.`;
  return '';
}

function cleanupGeneratedTtsAudio(id) {
  const item = ttsGeneratedAudio.get(id);
  if (!item) return;
  ttsGeneratedAudio.delete(id);
  if (item.timer) clearTimeout(item.timer);
  if (item.path) fs.unlink(item.path, () => {});
}

function rememberGeneratedTtsAudio({ path: audioPath, contentType = 'audio/wav', text = '' }) {
  const id = crypto.randomUUID();
  const expiresAt = Date.now() + TTS_GENERATED_AUDIO_TTL_MS;
  const timer = setTimeout(() => cleanupGeneratedTtsAudio(id), TTS_GENERATED_AUDIO_TTL_MS);
  timer.unref?.();
  ttsGeneratedAudio.set(id, {
    id,
    path: audioPath,
    contentType,
    text,
    expiresAt,
    timer
  });
  return {
    id,
    url: `/api/tts/generated/${encodeURIComponent(id)}`,
    expiresAt: new Date(expiresAt).toISOString()
  };
}

async function buildTtsVisemeItem({ text, lang, provider, options }) {
  const audio = await synthesizeConfiguredSpeechFile(text, lang, provider, options);
  const stored = rememberGeneratedTtsAudio({ path: audio.path, contentType: audio.contentType, text });
  const rhubarbStatus = getRhubarbRuntimeStatus();
  if (!rhubarbStatus.configured) {
    return {
      text,
      provider: audio.provider,
      contentType: audio.contentType,
      ...stored,
      visemes: [],
      visemeStatus: { ok: false, state: 'missing', reason: 'Rhubarb is not configured. Set TTS_RHUBARB_BIN or RHUBARB_BIN.' }
    };
  }

  try {
    const visemes = await generateRhubarbVisemes(audio.path);
    return {
      text,
      provider: audio.provider,
      contentType: audio.contentType,
      ...stored,
      visemes,
      visemeStatus: { ok: true, state: 'generated', count: visemes.length, bin: rhubarbStatus.bin }
    };
  } catch (err) {
    return {
      text,
      provider: audio.provider,
      contentType: audio.contentType,
      ...stored,
      visemes: [],
      visemeStatus: { ok: false, state: 'error', reason: getErrorText(err), bin: rhubarbStatus.bin }
    };
  }
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
    const includeVisemes = /^(1|true|yes)$/i.test(String(req.query.visemes || req.query.includeVisemes || ''));
    const options = {
      piper: {
        speaker: speaker || defaults.piperSpeaker,
        lengthScale: lengthScale || defaults.piperLengthScale,
        noiseScale: noiseScale || defaults.piperNoiseScale,
        noiseW: noiseW || defaults.piperNoiseW
      }
    };
    if (includeVisemes) {
      const items = [];
      for (const chunk of chunks) {
        items.push(await buildTtsVisemeItem({ text: chunk, lang, provider, options }));
      }
      return res.json({
        ok: true,
        provider,
        lang,
        urls: items.map(item => item.url),
        url: items[0]?.url || '',
        items,
        visemeMode: 'rhubarb'
      });
    }

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

app.get('/api/tts/generated/:id', async (req, res) => {
  const id = String(req.params.id || '').trim();
  const item = ttsGeneratedAudio.get(id);
  if (!item || !item.path) return res.status(404).json({ ok: false, error: 'Generated TTS audio expired or was not found' });
  if (Date.now() > item.expiresAt) {
    cleanupGeneratedTtsAudio(id);
    return res.status(404).json({ ok: false, error: 'Generated TTS audio expired' });
  }

  res.type(item.contentType || 'audio/wav');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(item.path, err => {
    if (err) logger.warn('generated tts audio send failed', getErrorText(err));
  });
});

app.get('/api/tts/status', async (req, res) => {
  const defaults = ttsSettings.current();
  const piperConfig = getPiperConfigDetails();
  const piperRuntime = getPiperRuntimeStatus();
  const rhubarbRuntime = getRhubarbRuntimeStatus();
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
      rhubarbRuntime,
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

  const bobChatSkillInstructions = buildBobChatSkillInstructions(req, prompt);
  req.ai = {
    originalPrompt: prompt,
    systemInstructions: bobChatSkillInstructions
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

function memoryEventUserKey(req) {
  try {
    return requestDatabaseUserKey(req);
  } catch (err) {
    return '';
  }
}

function sendMemoryEvent(res, event = {}) {
  res.write(`event: memory-changed\ndata: ${JSON.stringify({
    type: event.type || 'memory',
    count: Number(event.count || 0),
    updatedAt: new Date().toISOString()
  })}\n\n`);
}

function publishMemoryChanged({ req, type = 'memory', count = 0 } = {}) {
  const userKey = memoryEventUserKey(req);
  if (!userKey) return;
  const clients = memoryEventClients.get(userKey);
  if (!clients?.size) return;
  for (const client of [...clients]) {
    try {
      sendMemoryEvent(client, { type, count });
    } catch (err) {
      clients.delete(client);
    }
  }
  if (!clients.size) memoryEventClients.delete(userKey);
}

const ollamaModelStatusClients = new Set();
const activeOllamaModelRequests = new Map();
let ollamaModelStatusPublishPromise = null;
let ollamaModelStatusPendingReason = '';
let ollamaModelStatusExpireTimer = null;
let ollamaModelStatusSettledTimer = null;
let lastOllamaModelStatusSnapshot = null;

async function requestOllamaApi(method, endpoint, data, timeout = 10000) {
  try {
    const resp = await axios({
      method,
      url: `${OLLAMA_URL}${endpoint}`,
      data,
      timeout,
      headers: { 'Content-Type': 'application/json' }
    });
    return { ok: true, data: resp.data };
  } catch (err) {
    return { ok: false, error: getErrorText(err) };
  }
}

function getActiveOllamaModels() {
  return [...activeOllamaModelRequests.entries()]
    .filter(([, activity]) => activity?.count > 0)
    .map(([model, activity]) => ({
      model,
      count: activity.count,
      reasons: [...(activity.reasons || new Map()).entries()]
        .filter(([, count]) => count > 0)
        .map(([reason, detail]) => ({
          reason,
          count: detail.count,
          oldestStartedAt: detail.oldestStartedAt,
          newestStartedAt: detail.newestStartedAt
        }))
    }));
}

function getOllamaActivityForModel(name) {
  const active = activeOllamaModelRequests.get(name);
  const activeCount = active?.count || 0;
  return {
    active: activeCount > 0,
    activeCount,
    activeReasons: [...(active?.reasons || new Map()).entries()]
      .filter(([, detail]) => detail.count > 0)
      .map(([reason, detail]) => ({
        reason,
        count: detail.count,
        oldestStartedAt: detail.oldestStartedAt,
        newestStartedAt: detail.newestStartedAt
      }))
  };
}

function beginOllamaModelActivity(model, reason = 'ollama-generate') {
  const name = String(model || '').trim();
  if (!name) return () => {};
  const reasonKey = String(reason || 'ollama-generate').trim() || 'ollama-generate';
  const startedAt = new Date().toISOString();
  const activity = activeOllamaModelRequests.get(name) || { count: 0, reasons: new Map() };
  activity.count += 1;
  const reasonDetail = activity.reasons.get(reasonKey) || { count: 0, oldestStartedAt: startedAt, newestStartedAt: startedAt };
  reasonDetail.count += 1;
  reasonDetail.oldestStartedAt = reasonDetail.oldestStartedAt || startedAt;
  reasonDetail.newestStartedAt = startedAt;
  activity.reasons.set(reasonKey, reasonDetail);
  activeOllamaModelRequests.set(name, activity);
  publishOllamaModelStatus(`${reason}-start`);
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    const current = activeOllamaModelRequests.get(name);
    if (current) {
      current.count = Math.max(0, Number(current.count || 0) - 1);
      const currentReason = current.reasons?.get(reasonKey);
      const nextReasonCount = Math.max(0, Number(currentReason?.count || 0) - 1);
      if (nextReasonCount > 0) current.reasons.set(reasonKey, {
        ...currentReason,
        count: nextReasonCount
      });
      else current.reasons?.delete(reasonKey);
      if (current.count > 0) activeOllamaModelRequests.set(name, current);
      else activeOllamaModelRequests.delete(name);
    }
    publishOllamaModelStatus(`${reason}-finish`);
    scheduleOllamaModelStatusSettledPublish(`${reason}-settled`);
  };
}

function scheduleOllamaModelStatusSettledPublish(reason = 'activity-settled') {
  if (!ollamaModelStatusClients.size) return;
  if (ollamaModelStatusSettledTimer) clearTimeout(ollamaModelStatusSettledTimer);
  ollamaModelStatusSettledTimer = setTimeout(() => {
    ollamaModelStatusSettledTimer = null;
    publishOllamaModelStatus(reason);
  }, 350);
}

function summarizeOllamaRuntimeModel(model = {}) {
  const name = model.name || model.model || '';
  const activity = getOllamaActivityForModel(name);
  return {
    name,
    model: model.model || name,
    loaded: true,
    active: activity.active,
    activeCount: activity.activeCount,
    activeReasons: activity.activeReasons,
    size: model.size ?? null,
    sizeVram: model.size_vram ?? null,
    digest: model.digest || '',
    details: model.details || null,
    expiresAt: model.expires_at || null,
    processor: model.processor || ''
  };
}

function buildCachedOllamaModelStatusSnapshot(reason = 'activity-update') {
  const base = lastOllamaModelStatusSnapshot || {
    ok: true,
    data: {
      url: OLLAMA_URL,
      defaultModel: DEFAULT_MODEL,
      config: ollamaConfig.current(),
      version: null,
      installedCount: 0,
      models: [],
      running: [],
      activeModels: [],
      errors: { version: null, models: null, running: null }
    }
  };
  const runningModels = Array.isArray(base.data?.running)
    ? base.data.running.map(model => {
      const name = model.name || model.model || '';
      const activity = getOllamaActivityForModel(name);
      return {
        ...model,
        active: activity.active,
        activeCount: activity.activeCount,
        activeReasons: activity.activeReasons
      };
    }).filter(model => model.name || model.model)
    : [];
  const loadedNames = new Set(runningModels.map(model => model.name || model.model));
  const activeOnly = getActiveOllamaModels()
    .filter(model => !loadedNames.has(model.model))
    .map(model => ({
      name: model.model,
      model: model.model,
      loaded: false,
      active: true,
      activeCount: model.count,
      activeReasons: model.reasons || [],
      size: null,
      sizeVram: null,
      digest: '',
      details: null,
      expiresAt: null,
      processor: ''
    }));

  return {
    ...base,
    reason,
    updatedAt: new Date().toISOString(),
    data: {
      ...base.data,
      url: OLLAMA_URL,
      defaultModel: DEFAULT_MODEL,
      config: ollamaConfig.current(),
      running: [...runningModels, ...activeOnly],
      activeModels: getActiveOllamaModels()
    }
  };
}

async function buildOllamaModelStatusSnapshot(reason = 'update') {
  const [version, tags, running] = await Promise.all([
    requestOllamaApi('get', '/api/version'),
    requestOllamaApi('get', '/api/tags'),
    requestOllamaApi('get', '/api/ps')
  ]);
  const runningModels = Array.isArray(running.data?.models)
    ? running.data.models.map(summarizeOllamaRuntimeModel).filter(model => model.name)
    : [];
  const loadedNames = new Set(runningModels.map(model => model.name));
  const activeOnly = getActiveOllamaModels()
    .filter(model => !loadedNames.has(model.model))
    .map(model => ({
      name: model.model,
      model: model.model,
      loaded: false,
      active: true,
      activeCount: model.count,
      activeReasons: model.reasons || [],
      size: null,
      sizeVram: null,
      digest: '',
      details: null,
      expiresAt: null,
      processor: ''
    }));

  const snapshot = {
    ok: version.ok || tags.ok || running.ok,
    reason,
    updatedAt: new Date().toISOString(),
    data: {
      url: OLLAMA_URL,
      defaultModel: DEFAULT_MODEL,
      config: ollamaConfig.current(),
      version: version.data || null,
      installedCount: Array.isArray(tags.data?.models) ? tags.data.models.length : 0,
      models: tags.data?.models || [],
      running: [...runningModels, ...activeOnly],
      activeModels: getActiveOllamaModels(),
      errors: {
        version: version.ok ? null : version.error,
        models: tags.ok ? null : tags.error,
        running: running.ok ? null : running.error
      }
    }
  };
  lastOllamaModelStatusSnapshot = snapshot;
  return snapshot;
}

function scheduleOllamaModelStatusExpiration(snapshot) {
  if (ollamaModelStatusExpireTimer) {
    clearTimeout(ollamaModelStatusExpireTimer);
    ollamaModelStatusExpireTimer = null;
  }
  if (!ollamaModelStatusClients.size) return;
  const now = Date.now();
  const nextExpiry = (snapshot?.data?.running || [])
    .map(model => model.expiresAt ? new Date(model.expiresAt).getTime() : NaN)
    .filter(time => Number.isFinite(time) && time > now)
    .sort((a, b) => a - b)[0];
  if (!nextExpiry) return;
  const delay = Math.min(Math.max(500, nextExpiry - now + 250), 2_147_483_647);
  ollamaModelStatusExpireTimer = setTimeout(() => {
    ollamaModelStatusExpireTimer = null;
    publishOllamaModelStatus('model-expiration');
  }, delay);
}

function sendOllamaModelStatusEvent(res, snapshot) {
  res.write(`event: model-status\ndata: ${JSON.stringify(snapshot)}\n\n`);
}

function publishOllamaModelStatus(reason = 'update') {
  if (!ollamaModelStatusClients.size) return;
  const cachedSnapshot = buildCachedOllamaModelStatusSnapshot(reason);
  for (const client of ollamaModelStatusClients) {
    try {
      sendOllamaModelStatusEvent(client, cachedSnapshot);
    } catch (err) {
      ollamaModelStatusClients.delete(client);
    }
  }
  scheduleOllamaModelStatusExpiration(cachedSnapshot);

  ollamaModelStatusPendingReason = reason;
  if (ollamaModelStatusPublishPromise) return;

  ollamaModelStatusPublishPromise = (async () => {
    while (ollamaModelStatusPendingReason) {
      const nextReason = ollamaModelStatusPendingReason;
      ollamaModelStatusPendingReason = '';
      const snapshot = await buildOllamaModelStatusSnapshot(nextReason);
      for (const client of ollamaModelStatusClients) {
        try {
          sendOllamaModelStatusEvent(client, snapshot);
        } catch (err) {
          ollamaModelStatusClients.delete(client);
        }
      }
      scheduleOllamaModelStatusExpiration(snapshot);
    }
  })().catch(err => {
    logger.warn('Ollama model status publish failed', getErrorText(err));
  }).finally(() => {
    ollamaModelStatusPublishPromise = null;
  });
}

const ollamaPullJobs = new Map();
const activeOllamaPullsByModel = new Map();

function serializeOllamaPullJob(job) {
  return {
    id: job.id,
    model: job.model,
    status: job.status,
    statusText: job.statusText || '',
    source: job.source || '',
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt || '',
    error: job.error || '',
    completed: job.completed ?? null,
    total: job.total ?? null,
    digest: job.digest || ''
  };
}

function trimOllamaPullJobs() {
  const jobs = [...ollamaPullJobs.values()]
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  jobs.slice(MAX_PULL_JOBS).forEach(job => {
    if (job.status !== 'running') ollamaPullJobs.delete(job.id);
  });
}

function updateOllamaPullJob(job, patch = {}) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
}

function parseOllamaPullLine(job, line) {
  if (!line.trim()) return;
  try {
    const parsed = JSON.parse(line);
    updateOllamaPullJob(job, {
      statusText: parsed.status || job.statusText,
      digest: parsed.digest || job.digest,
      completed: Number.isFinite(Number(parsed.completed)) ? Number(parsed.completed) : job.completed,
      total: Number.isFinite(Number(parsed.total)) ? Number(parsed.total) : job.total
    });
    if (parsed.error) throw new Error(parsed.error);
  } catch (err) {
    if (line.trim().startsWith('{')) throw err;
    updateOllamaPullJob(job, { statusText: line.trim() });
  }
}

async function pullOllamaModelViaHttp(job) {
  updateOllamaPullJob(job, { source: 'http', statusText: 'Starting download' });
  const resp = await axios.post(`${OLLAMA_URL}/api/pull`, { model: job.model, stream: true }, {
    responseType: 'stream',
    headers: { 'Content-Type': 'application/json' },
    timeout: 0
  });

  await new Promise((resolve, reject) => {
    let buffer = '';
    resp.data.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      try {
        lines.forEach(line => parseOllamaPullLine(job, line));
      } catch (err) {
        reject(err);
      }
    });
    resp.data.on('end', () => {
      try {
        if (buffer.trim()) parseOllamaPullLine(job, buffer);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
    resp.data.on('error', reject);
  });
}

function pullOllamaModelViaCli(job) {
  updateOllamaPullJob(job, { source: 'cli', statusText: 'Starting CLI download' });
  return new Promise((resolve, reject) => {
    const child = spawn(String(OLLAMA_BIN).replace(/^"|"$/g, ''), ['pull', job.model], {
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
      const latest = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).pop();
      if (latest) updateOllamaPullJob(job, { statusText: latest });
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
      const latest = stderr.split(/\r?\n/).map(line => line.trim()).filter(Boolean).pop();
      if (latest) updateOllamaPullJob(job, { statusText: latest });
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) return resolve(stdout);
      reject(new Error(stderr || `ollama pull exited with code ${code}`));
    });
  });
}

async function runOllamaPullJob(job) {
  try {
    logger.info(`Starting ollama pull ${job.model}`);
    try {
      await pullOllamaModelViaHttp(job);
      logger.info(`ollama pull ${job.model} succeeded via HTTP API`);
    } catch (httpErr) {
      logger.warn(`ollama HTTP pull ${job.model} failed, trying CLI fallback`, getErrorText(httpErr));
      await pullOllamaModelViaCli(job);
      logger.info(`ollama pull ${job.model} succeeded via CLI`);
    }
    updateOllamaPullJob(job, {
      status: 'succeeded',
      statusText: job.statusText || 'Download complete',
      finishedAt: new Date().toISOString()
    });
  } catch (err) {
    const error = getErrorText(err);
    updateOllamaPullJob(job, {
      status: 'failed',
      statusText: 'Download failed',
      error,
      finishedAt: new Date().toISOString()
    });
    logger.error(`ollama pull ${job.model} failed`, error);
  } finally {
    activeOllamaPullsByModel.delete(job.model);
    trimOllamaPullJobs();
    publishOllamaModelStatus('pull-finished');
  }
}

function startOllamaPullJob(model) {
  const cleanModel = String(model || '').trim();
  const activeJobId = activeOllamaPullsByModel.get(cleanModel);
  if (activeJobId && ollamaPullJobs.has(activeJobId)) {
    return { job: ollamaPullJobs.get(activeJobId), reused: true };
  }

  const now = new Date().toISOString();
  const job = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    model: cleanModel,
    status: 'running',
    statusText: 'Queued',
    source: '',
    startedAt: now,
    updatedAt: now,
    finishedAt: '',
    error: '',
    completed: null,
    total: null,
    digest: ''
  };
  ollamaPullJobs.set(job.id, job);
  activeOllamaPullsByModel.set(cleanModel, job.id);
  trimOllamaPullJobs();
  runOllamaPullJob(job);
  return { job, reused: false };
}

async function getInstalledOllamaModels() {
  try {
    const resp = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 5000 });
    const models = Array.isArray(resp.data?.models) ? resp.data.models : resp.data;
    logger.info('Ollama HTTP API /api/tags succeeded');
    return Array.isArray(models) ? models : [];
  } catch (httpErr) {
    logger.warn('Ollama HTTP API failed, trying CLI fallback', httpErr?.message || httpErr);
    return new Promise((resolve, reject) => {
      exec(`"${OLLAMA_BIN}" list`, { timeout: 10000 }, (e, stdout, stderr) => {
        if (e) {
          logger.error('ollama list CLI failed', stderr || e.message);
          reject(new Error(`Ollama not available: ${stderr || e.message}. Ensure Ollama is running on ${OLLAMA_URL} or set OLLAMA_BIN environment variable.`));
          return;
        }
        const lines = stdout.split(/\r?\n/).filter(l => l.trim());
        const models = lines.map(l => l.split(/\s+/)[0]).filter(Boolean);
        logger.info(`ollama list CLI succeeded, found ${models.length} models`);
        resolve(models);
      });
    });
  }
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

function skillDebugEntry({ skill, type, value }) {
  return {
    skill,
    type,
    label: `${String(skill || 'skill').replace(/[-_]+/g, ' ')} ${type}`,
    value: typeof value === 'string' ? value : JSON.stringify(value || {}, null, 2)
  };
}

function skillDebugMetadata(req, entries = []) {
  if (!isAdminRequest(req)) return {};
  return {
    skillDebug: entries.filter(entry => entry && entry.skill && entry.type && String(entry.value || '').trim())
  };
}

function validateBobChatRawContract(rawOutput) {
  const raw = String(rawOutput || '').trim();
  let parsed = null;

  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    parsed = null;
  }

  const isObject = Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
  const metadata = isObject ? parsed.metadata : null;
  const metadataIsObject = Boolean(metadata && typeof metadata === 'object' && !Array.isArray(metadata));
  const factoidsIsArray = isObject && Array.isArray(parsed.factoids);
  const keys = isObject ? Object.keys(parsed).sort() : [];
  const expectedKeys = ['factoids', 'metadata', 'response'];
  const emotion = metadataIsObject ? String(metadata.emotion || '').trim().toLowerCase() : '';
  const checks = [
    {
      label: 'Strict JSON object',
      pass: isObject
    },
    {
      label: 'Only response, metadata, and factoids keys',
      pass: isObject && keys.length === expectedKeys.length && expectedKeys.every(key => keys.includes(key))
    },
    {
      label: 'Response is a non-empty string',
      pass: isObject && typeof parsed.response === 'string' && parsed.response.trim().length > 0
    },
    {
      label: 'Metadata is an object',
      pass: metadataIsObject
    },
    {
      label: 'Factoids is an array',
      pass: factoidsIsArray
    },
    {
      label: 'Emotion is allowed',
      pass: metadataIsObject && BOB_EMOTIONS.has(emotion)
    },
    {
      label: 'Minified JSON only',
      pass: isObject && JSON.stringify(parsed) === raw
    }
  ];

  return {
    valid: checks.every(check => check.pass),
    checks,
    parsed,
    lenientParsed: parseJsonObject(raw)
  };
}

function applyBobChatFallbackIfNeeded({ req, prompt, contract, rawOutput }) {
  if (String(contract?.response || '').trim()) return contract;
  const fallback = buildBobChatFallbackResponse(req, prompt, String(rawOutput || '').trim() ? 'invalid-empty-response' : 'empty-model-output');
  return {
    response: fallback.response,
    metadata: {
      ...(contract?.metadata || {}),
      ...fallback.metadata
    },
    factoids: []
  };
}

function extractResponseFactoids(rawOutput) {
  const parsed = parseJsonObject(rawOutput);
  if (Array.isArray(parsed?.factoids)) return parsed.factoids;
  if (Array.isArray(parsed?.output?.factoids)) return parsed.output.factoids;
  return [];
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

async function generateOllamaText(model, prompt, options = {}, requestOptions = {}) {
  if (typeof requestOptions.onChunk === 'function') {
    const response = await generateOllamaStream(model, prompt, options, requestOptions);
    return extractOllamaText(response.data).trim();
  }
  const response = await generateOllama(model, prompt, options, requestOptions);
  return extractOllamaText(response.data).trim();
}

async function generateOllama(model, prompt, options = {}, requestOptions = {}) {
  const finishActivity = beginOllamaModelActivity(model, requestOptions.reason || 'generate');
  try {
    return await axios.post(`${OLLAMA_URL}/api/generate`, {
      model,
      prompt,
      stream: false,
      ...(requestOptions.think !== undefined ? { think: Boolean(requestOptions.think) } : {}),
      ...(requestOptions.format ? { format: requestOptions.format } : {}),
      keep_alive: ollamaConfig.current().keepAlive,
      options
    }, {
      responseType: 'json',
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000
    });
  } finally {
    finishActivity();
  }
}

async function generateOllamaStream(model, prompt, options = {}, requestOptions = {}) {
  const finishActivity = beginOllamaModelActivity(model, requestOptions.reason || 'generate');
  try {
    const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
      model,
      prompt,
      stream: true,
      ...(requestOptions.think !== undefined ? { think: Boolean(requestOptions.think) } : {}),
      ...(requestOptions.format ? { format: requestOptions.format } : {}),
      keep_alive: ollamaConfig.current().keepAlive,
      options
    }, {
      responseType: 'stream',
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000
    });

    let buffer = '';
    let accumulated = '';
    let finalPayload = {};
    const responseSentenceEmitter = createStreamingResponseSentenceEmitter();
    const publishStreamPiece = (piece, parsed) => {
      if (!piece) return;
      accumulated += piece;
      const responseSpeech = responseSentenceEmitter.push(accumulated);
      const info = {
        accumulated,
        raw: parsed,
        responseText: responseSpeech.responseText,
        responseDelta: responseSpeech.responseDelta,
        responseSentences: responseSpeech.sentences
      };
      requestOptions.onChunk?.(piece, info);
      responseSpeech.sentences.forEach(sentence => {
        requestOptions.onResponseSentence?.(sentence, info);
      });
    };
    await new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        response.data.off?.('data', onData);
        response.data.off?.('end', onEnd);
        response.data.off?.('error', onError);
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        try {
          const finalSpeech = responseSentenceEmitter.flush();
          finalSpeech.sentences.forEach(sentence => {
            requestOptions.onResponseSentence?.(sentence, {
              accumulated,
              raw: finalPayload,
              responseText: finalSpeech.responseText,
              responseDelta: finalSpeech.responseDelta,
              responseSentences: finalSpeech.sentences,
              final: true
            });
          });
        } catch (err) {
          cleanup();
          reject(err);
          return;
        }
        cleanup();
        resolve();
        response.data.destroy?.();
      };
      const fail = err => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };
      const processLine = line => {
        const text = line.trim();
        if (!text || settled) return;
        const parsed = JSON.parse(text);
        const piece = String(parsed.response || parsed.message?.content || '');
        publishStreamPiece(piece, parsed);
        finalPayload = { ...parsed, response: accumulated || parsed.response || '' };
        if (parsed.done === true) finish();
      };
      const onData = chunk => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          try {
            processLine(line);
            if (settled) return;
          } catch (err) {
            fail(err);
            return;
          }
        }
      };
      const onEnd = () => {
        if (settled) return;
        try {
          if (buffer.trim()) processLine(buffer);
          if (!settled) finish();
        } catch (err) {
          fail(err);
        }
      };
      const onError = err => fail(err);
      response.data.on('data', onData);
      response.data.on('end', onEnd);
      response.data.on('error', onError);
    });

    return { data: finalPayload };
  } finally {
    finishActivity();
  }
}

function extractOllamaText(data = {}) {
  const normalized = normalizeOllamaGenerateData(data);
  return String(normalized?.response || normalized?.message?.content || '');
}

function summarizeOllamaGenerateData(data = {}) {
  const normalized = normalizeOllamaGenerateData(data);
  return {
    rawType: Array.isArray(data) ? 'array' : typeof data,
    response: normalized?.response ?? null,
    responseLength: String(normalized?.response || '').length,
    messageContent: normalized?.message?.content ?? null,
    messageContentLength: String(normalized?.message?.content || '').length,
    thinking: normalized?.thinking ?? null,
    thinkingLength: String(normalized?.thinking || '').length,
    done: normalized?.done ?? null,
    doneReason: normalized?.done_reason || '',
    error: normalized?.error || '',
    promptEvalCount: normalized?.prompt_eval_count ?? null,
    evalCount: normalized?.eval_count ?? null,
    totalDuration: normalized?.total_duration ?? null,
    loadDuration: normalized?.load_duration ?? null,
    rawKeys: normalized && typeof normalized === 'object' && !Array.isArray(normalized) ? Object.keys(normalized) : [],
    rawStringLength: typeof data === 'string' ? data.length : 0,
    rawStringPreview: typeof data === 'string' ? data.slice(0, 500) : ''
  };
}

function ollamaTimingSummary(data = {}) {
  const normalized = normalizeOllamaGenerateData(data);
  const nsToMs = value => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number / 1_000_000) : null;
  };
  const totalMs = nsToMs(normalized?.total_duration);
  const loadMs = nsToMs(normalized?.load_duration);
  return {
    totalMs,
    loadMs,
    generationMs: totalMs !== null && loadMs !== null ? Math.max(0, totalMs - loadMs) : null,
    promptEvalCount: normalized?.prompt_eval_count ?? null,
    evalCount: normalized?.eval_count ?? null
  };
}

function normalizeOllamaGenerateData(data = {}) {
  if (typeof data !== 'string') return data || {};
  const trimmed = data.trim();
  if (!trimmed) return {};
  const lines = trimmed.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const parsed = [];
  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (item && typeof item === 'object') parsed.push(item);
    } catch (err) {}
  }
  if (!parsed.length) {
    try {
      const item = JSON.parse(trimmed);
      return item && typeof item === 'object' ? item : { response: trimmed };
    } catch (err) {
      return { response: trimmed };
    }
  }
  return parsed.reduce((merged, item) => ({
    ...merged,
    ...item,
    response: `${merged.response || ''}${item.response || ''}`,
    thinking: `${merged.thinking || ''}${item.thinking || ''}`
  }), {});
}

async function probeOllamaModel(model) {
  const name = String(model || '').trim();
  const result = {
    model: name,
    show: { ok: false, error: '', details: null },
    generate: { ok: false, error: '', response: '', evalCount: null, promptEvalCount: null, totalDuration: null, raw: null },
    jsonGenerate: { ok: false, error: '', response: '', evalCount: null, promptEvalCount: null, totalDuration: null, raw: null }
  };
  if (!name) {
    result.show.error = 'model required';
    result.generate.error = 'model required';
    return result;
  }

  try {
    const show = await axios.post(`${OLLAMA_URL}/api/show`, { model: name }, { timeout: 30000 });
    result.show.ok = true;
    result.show.details = {
      modelInfo: show.data?.model_info || null,
      parameters: show.data?.parameters || '',
      template: show.data?.template ? String(show.data.template).slice(0, 500) : '',
      details: show.data?.details || null
    };
  } catch (err) {
    result.show.error = getErrorText(err);
  }

  try {
    const probe = await axios.post(`${OLLAMA_URL}/api/generate`, {
      model: name,
      prompt: 'Reply with exactly: ok',
      stream: false,
      think: false,
      keep_alive: ollamaConfig.current().keepAlive,
      options: { temperature: 0, num_predict: 64 }
    }, {
      responseType: 'json',
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000
    });
    result.generate.ok = true;
    result.generate.response = extractOllamaText(probe.data);
    result.generate.evalCount = probe.data?.eval_count ?? null;
    result.generate.promptEvalCount = probe.data?.prompt_eval_count ?? null;
    result.generate.totalDuration = probe.data?.total_duration ?? null;
    result.generate.raw = summarizeOllamaGenerateData(probe.data);
  } catch (err) {
    result.generate.error = getErrorText(err);
  }

  try {
    const probe = await axios.post(`${OLLAMA_URL}/api/generate`, {
      model: name,
      prompt: 'Return minified JSON exactly: {"ok":true}',
      stream: false,
      think: false,
      format: 'json',
      keep_alive: ollamaConfig.current().keepAlive,
      options: { temperature: 0, num_predict: 128 }
    }, {
      responseType: 'json',
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000
    });
    result.jsonGenerate.ok = true;
    result.jsonGenerate.response = extractOllamaText(probe.data);
    result.jsonGenerate.evalCount = probe.data?.eval_count ?? null;
    result.jsonGenerate.promptEvalCount = probe.data?.prompt_eval_count ?? null;
    result.jsonGenerate.totalDuration = probe.data?.total_duration ?? null;
    result.jsonGenerate.raw = summarizeOllamaGenerateData(probe.data);
  } catch (err) {
    result.jsonGenerate.error = getErrorText(err);
  }

  return result;
}

function withoutDuplicateCurrentTurn(history = [], prompt = '') {
  const target = String(prompt || '').trim().toLowerCase();
  if (!target) return history || [];
  const rows = [];
  for (let index = 0; index < (history || []).length; index += 1) {
    const row = history[index];
    const content = String(row?.content || '').trim().toLowerCase();
    const isSameUserPrompt = row?.role === 'user' && (
      content === target ||
      (content.includes(target) && content.length - target.length <= 32) ||
      (target.includes(content) && target.length - content.length <= 32)
    );
    if (isSameUserPrompt) {
      if (history[index + 1]?.role === 'assistant') index += 1;
      continue;
    }
    if (row?.role === 'assistant') {
      const metadata = row.metadata || {};
      const invalidContract = metadata.contractValid === false;
      const promptLeak = /current user message|output only|minified json|no fences|json structure/i.test(String(row.content || ''));
      const nameConfusion = /hello,\s*bob|hi,\s*bob/i.test(String(row.content || ''));
      if (invalidContract || promptLeak || nameConfusion) continue;
    }
    rows.push(row);
  }
  return rows;
}

async function classifyBobEmotion({ model, prompt, response, recentMessages = [], fallback }) {
  const emotionPrompt = buildBobEmotionPrompt({ prompt, response, recentMessages });
  const heuristic = fallback || heuristicBobEmotion({ prompt, response });

  try {
    const rawOutput = await generateOllamaText(model, emotionPrompt, { temperature: 0.1 }, { format: 'json', think: false, reason: 'bob-emotion' });
    const contract = parseBobEmotionContract(rawOutput, heuristic);
    return {
      ...contract,
      input: emotionPrompt,
      output: rawOutput
    };
  } catch (err) {
    logger.warn('Bob emotion skill failed', getErrorText(err));
    return {
      emotion: heuristic,
      reason: '',
      contractValid: false,
      input: emotionPrompt,
      output: getErrorText(err)
    };
  }
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
  const promptHistory = withoutDuplicateCurrentTurn(history, prompt);
  const promptWithMemory = memory.buildPrompt(prompt, promptHistory, summaries, factoids, {
    systemInstructions: req.ai?.systemInstructions || []
  });

  return {
    factoids,
    history: promptHistory,
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
  backgroundFactoids: MEMORY_BACKGROUND_FACTOIDS,
  getErrorText,
  onMemoryChanged: publishMemoryChanged
});

async function runWebSearchSkill({ req, model, prompt, query: routedQuery = '', onLiveOutput = null }) {
  const query = routedQuery || extractSearchQuery(prompt);
  const results = await searchWeb(query);
  const inputContract = buildSkillInputContract({
    skill: 'web-search',
    prompt,
    context: { query, results }
  });
  const summaryPrompt = buildWebSummaryPrompt(prompt, query, results);
  const rawSummary = await generateOllamaText(model, summaryPrompt, { temperature: 0.2 }, {
    format: 'json',
    think: false,
    reason: 'web-search-summary',
    ...(typeof onLiveOutput === 'function' ? {
      onChunk: (chunk, info = {}) => onLiveOutput({ stage: 'response-stage', skill: 'web-search', chunk, accumulated: info.accumulated || chunk })
    } : {})
  });
  const fallback = buildWebFallbackResponse(query, results);
  const contract = parseSkillOutputContract(rawSummary, {
    skill: 'web-search',
    response: fallback,
    emotion: results.length ? 'focused' : 'concerned',
    data: { query },
    sources: results
  });
  contract.output.factoids = extractResponseFactoids(rawSummary);
  contract.output.data = { query, ...(contract.output.data || {}) };
  contract.output.data.query = query;
  const hasPlaceholderSources = contract.output.sources.some(source =>
    /source title/i.test(String(source?.title || '')) ||
    String(source?.url || '').trim() === 'https://source'
  );
  contract.output.sources = contract.output.sources.length && !hasPlaceholderSources ? contract.output.sources : results;
  if (isSearchDumpResponse(contract.output.response) || hasUnsupportedWebClaims(contract.output.response, results)) {
    contract.output.response = fallback;
    contract.output.metadata.contractValid = false;
  }

  return {
    query,
    results,
    inputContract,
    outputContract: contract,
    factoids: contract.output.factoids || [],
    response: contract.output.response || fallback,
    metadata: contract.output.metadata,
    sources: contract.output.sources,
    skillDebug: [
      skillDebugEntry({ skill: 'web-search', type: 'input', value: summaryPrompt }),
      skillDebugEntry({ skill: 'web-search', type: 'output', value: rawSummary || fallback })
    ],
    ollamaInput: summaryPrompt,
    ollamaOutput: rawSummary || fallback
  };
}

function defaultBobModelRules(overrides = {}) {
  return sanitizeModelRules({
    routerMinSizeB: overrides.routerMinSizeB ?? ROUTER_MODEL_MIN_SIZE_B,
    fallbackMinSizeB: overrides.fallbackMinSizeB ?? AUTO_MODEL_FALLBACK_MIN_SIZE_B,
    minByTask: overrides.minByTask || {}
  });
}

function safePositiveLimit(value, fallback = 5, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), max);
}

function parseJsonTemplate(value, fallback) {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(String(value || ''));
  } catch (err) {
    return fallback;
  }
}

function normalizeStageFileTemplateTokens(raw) {
  return String(raw || '').replace(/\[\[\s*(CHAT INPUT|CHAT INPUIT|REQUEST ID|REQUEST TIMESTAMP|TIMESTAMP|SESSION ID|USER ID|USER NAME|AVAILABLE SKILLS|FACTOIDS|CHAT MEMORY|SEARCH QUERY|SEARCH RESULTS)(?:\s+(\d+))?\s*\]\]/gi, (_match, tag, limit) => {
    const normalized = `[${String(tag || '').toUpperCase()}${limit ? ` ${limit}` : ''}]`;
    return JSON.stringify(normalized);
  });
}

function normalizeStageInstructions(value) {
  if (Array.isArray(value)) return value.map(item => String(item || '')).filter(Boolean);
  const text = String(value ?? '').trim();
  if (!text) return [];
  if (text === 'NO DATA') return ['NO DATA'];
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function stageInstructionsText(instructions) {
  const lines = normalizeStageInstructions(instructions);
  return lines.length ? lines.join('\n') : 'NO DATA';
}

function parseStageJsonField(value, label) {
  if (value && typeof value === 'object') return value;
  if (String(value || '').trim() === 'NO DATA') return 'NO DATA';
  try {
    return JSON.parse(String(value || ''));
  } catch (err) {
    const error = new Error(`${label} must be valid JSON`);
    error.statusCode = 400;
    throw error;
  }
}

function bobStageTitle(stage) {
  return stage === 'response' ? 'Response Stage' : 'Router Stage';
}

function normalizeBobSkillName(skill) {
  return String(skill || '').trim() === 'web-search' ? 'web-search' : 'bob-chat';
}

function bobSkillTitle(skill) {
  return normalizeBobSkillName(skill) === 'web-search' ? 'Web Search Skill' : 'Bob Chat Skill';
}

function noDataBobStageDefinition(stage) {
  return {
    title: bobStageTitle(stage),
    inputTemplate: 'NO DATA',
    outputTemplate: 'NO DATA',
    instructions: ['NO DATA'],
    skillDescription: 'NO DATA'
  };
}

function normalizeBobStageDefinition(stage, value = {}) {
  const noData = noDataBobStageDefinition(stage);
  return {
    title: bobStageTitle(stage),
    inputTemplate: value.inputTemplate && typeof value.inputTemplate === 'object'
      ? value.inputTemplate
      : value.inputTemplate === undefined ? noData.inputTemplate : parseJsonTemplate(value.inputTemplate, noData.inputTemplate),
    outputTemplate: value.outputTemplate && typeof value.outputTemplate === 'object'
      ? value.outputTemplate
      : value.outputTemplate === undefined ? noData.outputTemplate : parseJsonTemplate(value.outputTemplate, noData.outputTemplate),
    instructions: normalizeStageInstructions(value.instructions ?? value.skillDescription ?? noData.instructions),
    skillDescription: stageInstructionsText(value.instructions ?? value.skillDescription ?? noData.instructions)
  };
}

function loadBobStageDefinitions() {
  const noData = {
    router: noDataBobStageDefinition('router'),
    response: noDataBobStageDefinition('response')
  };
  try {
    if (!fs.existsSync(BOB_STAGE_DEFINITIONS_PATH)) return noData;
    const parsed = JSON.parse(normalizeStageFileTemplateTokens(fs.readFileSync(BOB_STAGE_DEFINITIONS_PATH, 'utf8')));
    const saved = parsed?.stages || parsed || {};
    return {
      router: saved.router ? normalizeBobStageDefinition('router', saved.router) : noData.router,
      response: saved.response ? normalizeBobStageDefinition('response', saved.response) : noData.response
    };
  } catch (err) {
    logger.warn('Bob stage definitions load failed', err?.message || err);
    return noData;
  }
}

function saveBobStageDefinition(stage, value = {}) {
  const stageName = stage === 'response' ? 'response' : 'router';
  const current = loadBobStageDefinitions();
  current[stageName] = {
    title: bobStageTitle(stageName),
    inputTemplate: parseStageJsonField(value.inputTemplate, 'JSON input structure'),
    outputTemplate: parseStageJsonField(value.outputTemplate, 'JSON output structure'),
    instructions: normalizeStageInstructions(value.instructions ?? value.skillDescription)
  };
  fs.writeFileSync(BOB_STAGE_DEFINITIONS_PATH, `${JSON.stringify({
    version: '1.0',
    stages: current
  }, null, 2)}\n`, 'utf8');
  return current[stageName];
}

function noDataBobSkillDefinition(skill) {
  return {
    title: bobSkillTitle(skill),
    inputTemplate: 'NO DATA',
    outputTemplate: 'NO DATA',
    instructions: ['NO DATA'],
    skillDescription: 'NO DATA'
  };
}

function normalizeBobSkillDefinition(skill, value = {}) {
  const skillName = normalizeBobSkillName(skill);
  const noData = noDataBobSkillDefinition(skillName);
  return {
    title: value.title || bobSkillTitle(skillName),
    inputTemplate: value.inputTemplate && typeof value.inputTemplate === 'object'
      ? value.inputTemplate
      : value.inputTemplate === undefined ? noData.inputTemplate : parseJsonTemplate(value.inputTemplate, noData.inputTemplate),
    outputTemplate: value.outputTemplate && typeof value.outputTemplate === 'object'
      ? value.outputTemplate
      : value.outputTemplate === undefined ? noData.outputTemplate : parseJsonTemplate(value.outputTemplate, noData.outputTemplate),
    instructions: normalizeStageInstructions(value.instructions ?? value.skillDescription ?? noData.instructions),
    skillDescription: stageInstructionsText(value.instructions ?? value.skillDescription ?? noData.instructions)
  };
}

function loadBobSkillDefinitions() {
  const noData = {
    'bob-chat': noDataBobSkillDefinition('bob-chat'),
    'web-search': noDataBobSkillDefinition('web-search')
  };
  try {
    if (!fs.existsSync(BOB_SKILL_DEFINITIONS_PATH)) return noData;
    const parsed = JSON.parse(normalizeStageFileTemplateTokens(fs.readFileSync(BOB_SKILL_DEFINITIONS_PATH, 'utf8')));
    const saved = parsed?.skills || parsed || {};
    return {
      'bob-chat': saved['bob-chat'] ? normalizeBobSkillDefinition('bob-chat', saved['bob-chat']) : noData['bob-chat'],
      'web-search': saved['web-search'] ? normalizeBobSkillDefinition('web-search', saved['web-search']) : noData['web-search']
    };
  } catch (err) {
    logger.warn('Bob skill definitions load failed', err?.message || err);
    return noData;
  }
}

function saveBobSkillDefinition(skill, value = {}) {
  const skillName = normalizeBobSkillName(skill);
  const current = loadBobSkillDefinitions();
  current[skillName] = {
    title: bobSkillTitle(skillName),
    inputTemplate: parseStageJsonField(value.inputTemplate, 'JSON input structure'),
    outputTemplate: parseStageJsonField(value.outputTemplate, 'JSON output structure'),
    instructions: normalizeStageInstructions(value.instructions ?? value.skillDescription)
  };
  fs.writeFileSync(BOB_SKILL_DEFINITIONS_PATH, `${JSON.stringify({
    version: '1.0',
    skills: current
  }, null, 2)}\n`, 'utf8');
  return current[skillName];
}

function formatStageFactoids(factoids = []) {
  if (!factoids.length) return 'NO DATA';
  return factoids.map(item => ({
    key: item.factKey || item.fact_key || '',
    category: item.category || 'general',
    value: item.fact || '',
    confidence: Number(item.confidence || 0)
  }));
}

function formatStageChatMemory(messages = []) {
  if (!messages.length) return 'NO DATA';
  try {
    const parsed = JSON.parse(transcriptFromMessages(messages));
    return parsed.chatHistory?.length ? parsed.chatHistory : 'NO DATA';
  } catch (err) {
    return 'NO DATA';
  }
}

function requestCookie(req, name) {
  const cookies = String(req?.headers?.cookie || '').split(';');
  for (const cookie of cookies) {
    const index = cookie.indexOf('=');
    if (index < 0) continue;
    const key = cookie.slice(0, index).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(cookie.slice(index + 1).trim());
    } catch (err) {
      return cookie.slice(index + 1).trim();
    }
  }
  return '';
}

function buildBobRouterRequestContext(req) {
  let userId = '';
  try {
    userId = requestDatabaseUserKey(req);
  } catch (err) {
    userId = '';
  }
  const userName = userDisplayName(req?.user || {});
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: req?.sessionID || requestCookie(req, 'ollama_agent_session') || 'NO DATA',
    userId: userId || 'NO DATA',
    userName: userName && userName !== 'Signed in user' ? userName : 'NO DATA'
  };
}

function collectStageTagLimits(value, limits = { factoids: 0, chatMemory: 0 }) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\[(FACTOIDS|CHAT MEMORY)(?:\s+(\d+))?\]/gi)) {
      const limit = safePositiveLimit(match[2], 5);
      if (match[1].toUpperCase() === 'FACTOIDS') limits.factoids = Math.max(limits.factoids, limit);
      if (match[1].toUpperCase() === 'CHAT MEMORY') limits.chatMemory = Math.max(limits.chatMemory, limit);
    }
    return limits;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectStageTagLimits(item, limits));
    return limits;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(item => collectStageTagLimits(item, limits));
  }
  return limits;
}

function replaceStageTags(value, data) {
  if (typeof value === 'string') {
    const exact = value.trim().match(/^\[(CHAT INPUT|CHAT INPUIT|REQUEST ID|REQUEST TIMESTAMP|TIMESTAMP|SESSION ID|USER ID|USER NAME|AVAILABLE SKILLS|FACTOIDS|CHAT MEMORY|SEARCH QUERY|SEARCH RESULTS)(?:\s+(\d+))?\]$/i);
    if (exact) return stageTagValue(exact[1], exact[2], data);
    return value.replace(/\[(CHAT INPUT|CHAT INPUIT|REQUEST ID|REQUEST TIMESTAMP|TIMESTAMP|SESSION ID|USER ID|USER NAME|AVAILABLE SKILLS|FACTOIDS|CHAT MEMORY|SEARCH QUERY|SEARCH RESULTS)(?:\s+(\d+))?\]/gi, (_match, tag, limit) => {
      const replacement = stageTagValue(tag, limit, data);
      return typeof replacement === 'string' ? replacement : JSON.stringify(replacement);
    });
  }
  if (Array.isArray(value)) return value.map(item => replaceStageTags(item, data));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceStageTags(item, data)]));
  }
  return value;
}

function stageTagValue(tag, limit, data) {
  const name = String(tag || '').toUpperCase();
  if (name === 'CHAT INPUT' || name === 'CHAT INPUIT') return data.prompt || 'NO DATA';
  if (name === 'REQUEST ID') return data.request.id || 'NO DATA';
  if (name === 'REQUEST TIMESTAMP' || name === 'TIMESTAMP') return data.request.timestamp || 'NO DATA';
  if (name === 'SESSION ID') return data.request.sessionId || 'NO DATA';
  if (name === 'USER ID') return data.request.userId || 'NO DATA';
  if (name === 'USER NAME') return data.request.userName || 'NO DATA';
  if (name === 'AVAILABLE SKILLS') return BOB_ROUTER_SKILLS;
  if (name === 'FACTOIDS') return data.factoids.length ? data.factoids.slice(0, safePositiveLimit(limit, data.factoids.length || 5)) : 'NO DATA';
  if (name === 'CHAT MEMORY') return data.chatMemory.length ? data.chatMemory.slice(0, safePositiveLimit(limit, data.chatMemory.length || 5)) : 'NO DATA';
  if (name === 'SEARCH QUERY') return data.searchQuery || 'NO DATA';
  if (name === 'SEARCH RESULTS') return data.searchResults?.length ? data.searchResults.slice(0, safePositiveLimit(limit, data.searchResults.length || 5)) : 'NO DATA';
  return 'NO DATA';
}

function bobStageTagSummary(data) {
  return {
    supported: ['[CHAT INPUT]', '[REQUEST ID]', '[REQUEST TIMESTAMP]', '[SESSION ID]', '[USER ID]', '[USER NAME]', '[AVAILABLE SKILLS]', '[FACTOIDS #]', '[CHAT MEMORY #]', '[SEARCH QUERY]', '[SEARCH RESULTS #]'],
    resolved: {
      chatInput: data.prompt ? 'provided' : 'NO DATA',
      requestId: data.request.id || 'NO DATA',
      requestTimestamp: data.request.timestamp || 'NO DATA',
      sessionId: data.request.sessionId || 'NO DATA',
      userId: data.request.userId || 'NO DATA',
      userName: data.request.userName || 'NO DATA',
      availableSkills: BOB_ROUTER_SKILLS.length || 'NO DATA',
      factoids: data.factoids.length || 'NO DATA',
      chatMemory: data.chatMemory.length || 'NO DATA',
      searchQuery: data.searchQuery || 'NO DATA',
      searchResults: data.searchResults?.length || 'NO DATA'
    }
  };
}

async function buildBobStageRenderContext({ req, prompt = '', values = [], query = '', results = [] } = {}) {
  const limits = collectStageTagLimits(values);
  const [factoidsRaw, chatMemoryRaw] = await Promise.all([
    limits.factoids > 0 ? memory.getFactoids({ req, limit: limits.factoids }) : [],
    limits.chatMemory > 0 ? memory.getMessages({ req, limit: limits.chatMemory }) : []
  ]);
  const data = {
    prompt: String(prompt || '').trim(),
    request: buildBobRouterRequestContext(req),
    factoids: formatStageFactoids(factoidsRaw),
    chatMemory: formatStageChatMemory(chatMemoryRaw),
    searchQuery: String(query || extractSearchQuery(prompt) || '').trim(),
    searchResults: Array.isArray(results) && results.length ? results : []
  };
  if (data.factoids === 'NO DATA') data.factoids = [];
  if (data.chatMemory === 'NO DATA') data.chatMemory = [];
  return {
    data,
    tags: bobStageTagSummary(data)
  };
}

async function renderBobStageInput({ req, stage = 'router', prompt = '', inputTemplate } = {}) {
  const stageName = stage === 'response' ? 'response' : 'router';
  const base = loadBobStageDefinitions()[stageName];
  const input = inputTemplate === undefined
    ? base.inputTemplate
    : parseStageJsonField(inputTemplate, 'JSON input structure');
  const context = await buildBobStageRenderContext({ req, prompt, values: [input] });
  return {
    stage: stageName,
    title: base.title,
    persistedPath: BOB_STAGE_DEFINITIONS_PATH,
    inputTemplate: input,
    outputTemplate: base.outputTemplate,
    instructions: base.instructions,
    skillDescription: base.skillDescription,
    tags: context.tags,
    rendered: {
      input: replaceStageTags(input, context.data)
    }
  };
}

async function renderBobStageDefinition({ req, stage = 'router', prompt = '', inputTemplate, outputTemplate, skillDescription, inputOnly = false } = {}) {
  const stageName = stage === 'response' ? 'response' : 'router';
  const base = loadBobStageDefinitions()[stageName];
  const input = inputTemplate === undefined
    ? base.inputTemplate
    : parseStageJsonField(inputTemplate, 'JSON input structure');
  const output = outputTemplate === undefined
    ? base.outputTemplate
    : inputOnly ? base.outputTemplate : parseStageJsonField(outputTemplate, 'JSON output structure');
  const description = String(skillDescription ?? base.skillDescription);
  const renderValues = inputOnly ? [input] : [input, output, description];
  const context = await buildBobStageRenderContext({ req, prompt, values: renderValues });

  return {
    stage: stageName,
    title: base.title,
    persistedPath: BOB_STAGE_DEFINITIONS_PATH,
    tags: context.tags,
    inputTemplate: input,
    outputTemplate: output,
    instructions: normalizeStageInstructions(description),
    skillDescription: description,
    rendered: {
      input: replaceStageTags(input, context.data),
      ...(inputOnly ? {} : {
        output: replaceStageTags(output, context.data),
        skillDescription: replaceStageTags(description, context.data)
      })
    }
  };
}

async function renderBobSkillDefinition({ req, skill = 'bob-chat', prompt = '', inputTemplate, outputTemplate, skillDescription, inputOnly = false } = {}) {
  const skillName = normalizeBobSkillName(skill);
  const base = loadBobSkillDefinitions()[skillName];
  const input = inputTemplate === undefined
    ? base.inputTemplate
    : parseStageJsonField(inputTemplate, 'JSON input structure');
  const output = outputTemplate === undefined
    ? base.outputTemplate
    : inputOnly ? base.outputTemplate : parseStageJsonField(outputTemplate, 'JSON output structure');
  const description = String(skillDescription ?? base.skillDescription);
  const renderValues = inputOnly ? [input] : [input, output, description];
  const context = await buildBobStageRenderContext({ req, prompt, values: renderValues });

  return {
    skill: skillName,
    title: base.title,
    persistedPath: BOB_SKILL_DEFINITIONS_PATH,
    tags: context.tags,
    inputTemplate: input,
    outputTemplate: output,
    instructions: normalizeStageInstructions(description),
    skillDescription: description,
    rendered: {
      input: replaceStageTags(input, context.data),
      ...(inputOnly ? {} : {
        output: replaceStageTags(output, context.data),
        skillDescription: replaceStageTags(description, context.data)
      })
    }
  };
}

function traceToSkillDebug(trace = []) {
  return (trace || []).flatMap(entry => [
    skillDebugEntry({ skill: entry.skill, type: 'input', value: entry.input }),
    skillDebugEntry({ skill: entry.skill, type: 'output', value: entry.output || JSON.stringify(entry.parsed || {}, null, 2) })
  ]);
}

function buildModelDiagnosticsTrace({ installedModels = [], diagnosticModels = [], modelDiagnostics = [] } = {}) {
  return {
    skill: 'ollama-model-diagnostics',
    expectedContract: [
      {
        model: 'model name',
        show: { ok: true },
        generate: { ok: true, response: 'non-empty text' },
        jsonGenerate: { ok: true, response: 'non-empty JSON text' }
      }
    ],
    input: JSON.stringify({
      ollamaUrl: OLLAMA_URL,
      installedModelNames: installedModels.map(item => typeof item === 'string' ? item : item?.name || item?.model || '').filter(Boolean),
      diagnosticModels
    }, null, 2),
    output: JSON.stringify(modelDiagnostics, null, 2),
    parsed: modelDiagnostics,
    contractValid: modelDiagnostics.every(item =>
      item.show.ok &&
      item.generate.ok &&
      String(item.generate.response || '').trim() &&
      item.jsonGenerate.ok &&
      String(item.jsonGenerate.response || '').trim()
    )
  };
}

function buildRouterTrace({ routerInput, routerRawOutput, route, routerGenerateData, expectedContract }) {
  return {
    skill: 'router-stage',
    expectedContract: expectedContract || {
      skill: 'bob-chat',
      query: '',
      reason: 'short reason'
    },
    input: routerInput,
    output: routerRawOutput,
    parsed: {
      ...route,
      rawGenerate: routerGenerateData
    },
    contractValid: Boolean(route.contractValid)
  };
}

async function selectBobTurnRouteAndModel({ req, prompt, requestedModel, modelRules }) {
  const installedModels = isAutoModel(requestedModel) ? await getInstalledOllamaModels() : [];
  const routerModelRoute = isAutoModel(requestedModel)
    ? selectRouterModel({
      installedModels,
      defaultModel: DEFAULT_MODEL,
      minSizeB: modelRules.routerMinSizeB
    })
    : {
      model: requestedModel || DEFAULT_MODEL,
      minSizeB: modelRules.routerMinSizeB,
      candidates: [],
      reason: 'Manual model selection uses the selected model for routing.'
    };
  const routerStageInput = await renderBobStageInput({ req, stage: 'router', prompt });
  const routerInput = buildBobRouterPrompt({
    prompt,
    envelope: routerStageInput.rendered.input,
    outputContract: routerStageInput.outputTemplate,
    skillDescription: routerStageInput.skillDescription
  });
  let routerRawOutput = '';
  let routerGenerateData = null;
  let route;

  try {
    const routerGenerate = await generateOllama(routerModelRoute.model, routerInput, { temperature: 0 }, { format: 'json', think: false, reason: 'router-stage' });
    routerGenerateData = summarizeOllamaGenerateData(routerGenerate.data);
    routerRawOutput = extractOllamaText(routerGenerate.data).trim();
    route = parseBobRouterContract(routerRawOutput, prompt);
  } catch (err) {
    route = heuristicBobRoute(prompt, false);
    routerRawOutput = getErrorText(err);
    routerGenerateData = { error: routerRawOutput };
  }

  const modelRoute = selectBobModel({
    requestedModel,
    installedModels,
    route,
    prompt,
    defaultModel: DEFAULT_MODEL,
    minAutoSizeB: modelRules.fallbackMinSizeB,
    modelRules
  });

  return {
    installedModels,
    routerModelRoute,
    modelRoute,
    model: modelRoute.model,
    route,
    routerStageInput,
    routerInput,
    routerRawOutput,
    routerGenerateData
  };
}

async function persistBobUserMessage({ req, model, prompt }) {
  const userMessage = await memory.addMessage({ req, role: 'user', model, content: prompt });
  if (userMessage) publishMemoryChanged({ req, type: 'user-message', count: 1 });
  return userMessage;
}

async function persistResponseFactoids({ req, model, factoids, evidenceMessages, sourceMessageId }) {
  if (!Array.isArray(factoids) || factoids.length === 0) return [];
  const supported = filterSupportedFactoids(factoids, evidenceMessages || []);
  if (supported.length === 0) return [];
  const saved = await memory.saveFactoids({
    req,
    model,
    sourceMessageId,
    factoids: supported
  });
  if (saved.length > 0) publishMemoryChanged({ req, type: 'factoids', count: saved.length });
  return saved;
}

async function persistBobAssistantMessage({ req, model, response, metadata, route, trace, sourceMessageId, factoids = [], evidenceMessages = [] }) {
  const assistantMessage = await memory.addMessage({
    req,
    role: 'assistant',
    model,
    content: response,
    metadata: {
      skill: metadata.skill,
      skills: metadata.skills,
      ...metadata,
      router: route,
      ...skillDebugMetadata(req, traceToSkillDebug(trace))
    }
  });
  if (assistantMessage) publishMemoryChanged({ req, type: 'assistant-message', count: 1 });
  try {
    await persistResponseFactoids({
      req,
      model,
      factoids,
      evidenceMessages,
      sourceMessageId: sourceMessageId || assistantMessage?.id
    });
  } catch (err) {
    logger.warn('Response factoid persistence failed', getErrorText(err));
  }
  memorySkill.updateAfterTurn({ req, model, sourceMessageId: sourceMessageId || assistantMessage?.id });
  return assistantMessage;
}

async function runBobTurn({ req, prompt, requestedModel = DEFAULT_MODEL, parameters = {}, modelRules = defaultBobModelRules(), includeDiagnostics = false, persist = false, deferEmotion = true, onLiveOutput = null, onResultReady = null } = {}) {
  const startedAt = Date.now();
  const originalPrompt = String(prompt || '').trim();
  const stageSkills = ['router-stage', 'response-stage'];
  const rules = sanitizeModelRules(modelRules);
  const context = await buildBobPromptContext({ req, prompt: originalPrompt });
  const selection = await selectBobTurnRouteAndModel({
    req,
    prompt: originalPrompt,
    requestedModel,
    modelRules: rules
  });
  const {
    installedModels,
    routerModelRoute,
    modelRoute,
    model,
    route,
    routerStageInput,
    routerInput,
    routerRawOutput,
    routerGenerateData
  } = selection;
  const trace = [
    buildRouterTrace({
      routerInput,
      routerRawOutput,
      route,
      routerGenerateData,
      expectedContract: routerStageInput?.outputTemplate
    })
  ];
  let modelDiagnostics = [];
  const persistedUserMessage = persist
    ? await persistBobUserMessage({ req, model, prompt: originalPrompt })
    : null;

  if (includeDiagnostics) {
    const diagnosticModels = [...new Set([routerModelRoute.model, model].filter(Boolean))];
    modelDiagnostics = await Promise.all(diagnosticModels.map(probeOllamaModel));
    trace.unshift(buildModelDiagnosticsTrace({ installedModels, diagnosticModels, modelDiagnostics }));
  }

  if (route.skill === 'web-search') {
    const search = await runWebSearchSkill({ req, model, prompt: originalPrompt, query: route.query, onLiveOutput });
    const responseMetadata = {
      ...search.metadata,
      skill: 'web-search',
      skills: stageSkills,
      router: route,
      inputContract: search.inputContract,
      outputContract: search.outputContract,
      sources: search.sources,
      results: search.sources,
      query: search.query
    };
    trace.push({
      skill: 'response-stage',
      expectedContract: {
        contractVersion: 1,
        skill: 'web-search',
        output: {
          response: 'text shown to the user',
          metadata: { emotion: 'focused' },
          data: { query: 'search query' },
          sources: [{ title: 'source title', url: 'https://source', snippet: 'short snippet' }],
          factoids: [{
            factKey: 'short-stable-key',
            category: 'preference|project|identity|environment|workflow|constraint|general',
            fact: 'The user ...',
            confidence: 0
          }]
        }
      },
      input: search.ollamaInput,
      output: search.ollamaOutput,
      parsed: search.outputContract,
      contractValid: Boolean(search.outputContract?.output?.metadata?.contractValid)
    });
    const result = {
      model,
      requestedModel,
      modelRoute,
      routerModel: routerModelRoute.model,
      routerModelRoute,
      modelRules: rules,
      modelDiagnostics,
      prompt: originalPrompt,
      elapsedMs: Date.now() - startedAt,
      route,
      response: search.response,
      metadata: {
        ...responseMetadata,
        ...skillDebugMetadata(req, traceToSkillDebug(trace))
      },
      skill: 'web-search',
      skills: responseMetadata.skills,
      inputContract: search.inputContract,
      outputContract: search.outputContract,
      factoids: search.factoids || [],
      query: search.query,
      sources: search.sources,
      llm: trace,
      done: true
    };
    onResultReady?.(result);
    if (persist) {
      await persistBobAssistantMessage({
        req,
        model,
        response: search.response,
        metadata: responseMetadata,
        route,
        trace,
        sourceMessageId: persistedUserMessage?.id,
        factoids: search.factoids || [],
        evidenceMessages: [{ role: 'user', content: originalPrompt }]
      });
    }
    return result;
  }

  const { history, promptWithMemory } = context;
  const payload = {
    model,
    prompt: promptWithMemory,
    format: 'json',
    think: false,
    keep_alive: ollamaConfig.current().keepAlive,
    ...parameters
  };
  const response = typeof onLiveOutput === 'function'
    ? await generateOllamaStream(model, promptWithMemory, payload.options || {}, {
      format: payload.format,
      think: payload.think,
      reason: 'bob-chat-response',
      onChunk: (chunk, info = {}) => onLiveOutput({
        stage: 'response-stage',
        skill: 'bob-chat',
        chunk,
        accumulated: info.accumulated || chunk,
        responseText: info.responseText || '',
        responseDelta: info.responseDelta || '',
        responseSentences: info.responseSentences || []
      }),
      onResponseSentence: (sentence, info = {}) => onLiveOutput({
        stage: 'response-stage',
        skill: 'bob-chat',
        speech: sentence,
        accumulated: info.accumulated || '',
        responseText: info.responseText || '',
        final: Boolean(info.final)
      })
    })
    : await generateOllama(model, promptWithMemory, payload.options || {}, { format: payload.format, think: payload.think, reason: 'bob-chat-response' });
  const rawBobOutput = extractOllamaText(response.data);
  const rawBobGenerate = summarizeOllamaGenerateData(response.data);
  const actualGenerate = {
    model,
    ok: true,
    responseLength: rawBobOutput.length,
    ...rawBobGenerate
  };
  const estimatedInputTokens = estimateTokens(promptWithMemory);
  const actualInputTokens = Number(response.data?.prompt_eval_count);
  const bobContract = applyBobChatFallbackIfNeeded({
    req,
    prompt: originalPrompt,
    contract: parseBobChatContract(rawBobOutput),
    rawOutput: rawBobOutput
  });
  const responseFactoidEvidence = [
    ...history,
    { role: 'user', content: originalPrompt }
  ];
  const validation = validateBobChatRawContract(rawBobOutput);
  const emotionContract = deferEmotion
    ? {
      emotion: bobContract.metadata?.emotion || heuristicBobEmotion({ prompt: originalPrompt, response: bobContract.response }),
      reason: '',
      contractValid: null,
      deferred: true,
      input: '',
      output: ''
    }
    : await classifyBobEmotion({
      model,
      prompt: originalPrompt,
      response: bobContract.response,
      recentMessages: history
    });
  const ctxMetadata = buildBobContextMetadata({
    estimatedInputTokens,
    actualInputTokens,
    tokenMethod: 'ollama-prompt-eval-count',
    model
  });
  const responseMetadata = {
    ...bobContract.metadata,
    emotion: emotionContract.emotion,
    emotionSkill: {
      reason: emotionContract.reason,
      contractValid: emotionContract.contractValid,
      deferred: Boolean(emotionContract.deferred)
    },
    ctx: ctxMetadata,
    skill: 'bob-chat',
    skills: stageSkills
  };

  trace.push({
    skill: 'response-stage',
    expectedContract: BOB_CHAT_RESPONSE_CONTRACT,
    input: payload.prompt,
    output: rawBobOutput,
    parsed: {
      response: bobContract.response,
      metadata: bobContract.metadata,
      factoids: bobContract.factoids || [],
      model,
      generate: actualGenerate,
      rawGenerate: rawBobGenerate
    },
    contractValid: validation.valid,
    validation
  });

  const result = {
    ...response.data,
    model,
    requestedModel,
    modelRoute,
    routerModel: routerModelRoute.model,
    routerModelRoute,
    modelRules: rules,
    modelDiagnostics,
    prompt: originalPrompt,
    elapsedMs: Date.now() - startedAt,
    expectedContract: BOB_CHAT_RESPONSE_CONTRACT,
    validation,
    route,
    response: bobContract.response,
    factoids: bobContract.factoids || [],
    metadata: {
      ...responseMetadata,
      ...skillDebugMetadata(req, traceToSkillDebug(trace))
    },
    usage: {
      ...actualGenerate,
      promptEvalCount: response.data?.prompt_eval_count ?? null,
      evalCount: response.data?.eval_count ?? null,
      totalDuration: response.data?.total_duration ?? null,
      timing: ollamaTimingSummary(response.data)
    },
    llm: trace,
    skill: 'bob-chat',
    skills: responseMetadata.skills,
    deferredEmotion: null
  };
  onResultReady?.(result);

  if (persist) {
    rememberBobContextUsage({ req, model, promptTokens: actualInputTokens });
    await persistBobAssistantMessage({
      req,
      model,
      response: bobContract.response,
      metadata: responseMetadata,
      route,
      trace,
      sourceMessageId: persistedUserMessage?.id,
      factoids: bobContract.factoids || [],
      evidenceMessages: responseFactoidEvidence
    });
  }

  return result;
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

app.get('/api/memory/events', admin.requireAdmin, (req, res) => {
  const userKey = memoryEventUserKey(req);
  if (!userKey) return res.status(401).json({ ok: false, error: 'User identity unavailable' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders && res.flushHeaders();

  if (!memoryEventClients.has(userKey)) memoryEventClients.set(userKey, new Set());
  const clients = memoryEventClients.get(userKey);
  clients.add(res);
  res.write('retry: 2000\n\n');
  sendMemoryEvent(res, { type: 'connected' });

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
    if (!clients.size) memoryEventClients.delete(userKey);
  });
});

app.delete('/api/memory/messages/:id', async (req, res) => {
  try {
    const deleted = await memory.deleteMessage({ req, id: req.params.id });
    if (!deleted) return res.status(404).json({ ok: false, error: 'Chat memory item not found' });
    publishMemoryChanged({ req, type: 'messages-deleted', count: 1 });
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
    publishMemoryChanged({ req, type: 'factoids-deleted', count: 1 });
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
    publishMemoryChanged({ req, type: 'wiped', count: (deleted.messages || 0) + (deleted.summaries || 0) + (deleted.factoids || 0) });
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

app.get('/api/admin/bob-chat-stage', admin.requireAdmin, async (req, res) => {
  try {
    const data = await renderBobStageDefinition({
      req,
      stage: String(req.query?.stage || 'router').trim() === 'response' ? 'response' : 'router',
      prompt: req.query?.prompt || ''
    });
    res.json({ ok: true, data });
  } catch (err) {
    logger.error('bob chat stage load error', getErrorText(err));
    res.status(err.statusCode || 500).json({ ok: false, error: err.statusCode ? err.message : 'Could not load Bob stage definition' });
  }
});

app.post('/api/admin/bob-chat-stage', admin.requireAdmin, async (req, res) => {
  try {
    const stage = String(req.body?.stage || 'router').trim() === 'response' ? 'response' : 'router';
    let saved = null;
    if (req.body?.persist) {
      saved = saveBobStageDefinition(stage, {
        inputTemplate: req.body?.inputTemplate,
        outputTemplate: req.body?.outputTemplate,
        instructions: req.body?.instructions,
        skillDescription: req.body?.skillDescription
      });
    }
    const data = await renderBobStageDefinition({
      req,
      stage,
      prompt: req.body?.prompt || '',
      inputTemplate: req.body?.persist ? saved.inputTemplate : req.body?.inputTemplate,
      outputTemplate: req.body?.persist ? saved.outputTemplate : req.body?.outputTemplate,
      skillDescription: req.body?.persist ? saved.skillDescription : req.body?.skillDescription,
      inputOnly: !req.body?.persist && req.body?.render === 'input'
    });
    res.json({ ok: true, data: { ...data, persisted: Boolean(req.body?.persist) } });
  } catch (err) {
    logger.error('bob chat stage render error', getErrorText(err));
    res.status(err.statusCode || 500).json({ ok: false, error: err.statusCode ? err.message : 'Could not render Bob stage definition' });
  }
});

app.get('/api/admin/bob-chat-skill', admin.requireAdmin, async (req, res) => {
  try {
    const data = await renderBobSkillDefinition({
      req,
      skill: normalizeBobSkillName(req.query?.skill),
      prompt: req.query?.prompt || ''
    });
    res.json({ ok: true, data });
  } catch (err) {
    logger.error('bob chat skill load error', getErrorText(err));
    res.status(err.statusCode || 500).json({ ok: false, error: err.statusCode ? err.message : 'Could not load Bob skill definition' });
  }
});

app.post('/api/admin/bob-chat-skill', admin.requireAdmin, async (req, res) => {
  try {
    const skill = normalizeBobSkillName(req.body?.skill);
    let saved = null;
    if (req.body?.persist) {
      saved = saveBobSkillDefinition(skill, {
        inputTemplate: req.body?.inputTemplate,
        outputTemplate: req.body?.outputTemplate,
        instructions: req.body?.instructions,
        skillDescription: req.body?.skillDescription
      });
    }
    const data = await renderBobSkillDefinition({
      req,
      skill,
      prompt: req.body?.prompt || '',
      inputTemplate: req.body?.persist ? saved.inputTemplate : req.body?.inputTemplate,
      outputTemplate: req.body?.persist ? saved.outputTemplate : req.body?.outputTemplate,
      skillDescription: req.body?.persist ? saved.skillDescription : req.body?.skillDescription,
      inputOnly: !req.body?.persist && req.body?.render === 'input'
    });
    res.json({ ok: true, data: { ...data, persisted: Boolean(req.body?.persist) } });
  } catch (err) {
    logger.error('bob chat skill render error', getErrorText(err));
    res.status(err.statusCode || 500).json({ ok: false, error: err.statusCode ? err.message : 'Could not render Bob skill definition' });
  }
});

app.post('/api/admin/bob-chat-test', admin.requireAdmin, applyAiRules, async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ ok: false, error: 'prompt required' });

    const data = await runBobTurn({
      req,
      prompt,
      requestedModel: req.body?.model || DEFAULT_MODEL,
      parameters: req.body?.parameters || {},
      modelRules: defaultBobModelRules(req.body?.modelRules || {}),
      includeDiagnostics: false,
      persist: true,
      deferEmotion: true
    });

    res.json({ ok: true, data });
  } catch (err) {
    const error = getErrorText(err);
    logger.error('bob chat test error', error);
    res.status(err?.response?.status || 500).json({ ok: false, error });
  }
});

app.post('/api/admin/bob-chat-test/stream', admin.requireAdmin, applyAiRules, async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ ok: false, error: 'prompt required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders && res.flushHeaders();
  res.write('retry: 2000\n\n');

  const sendEvent = (event, data) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let resultSent = false;
  const sendFinalResult = data => {
    if (resultSent || res.writableEnded || res.destroyed) return;
    resultSent = true;
    sendEvent('test-result', { ok: true, data });
    sendEvent('done', '[DONE]');
    res.end();
  };

  try {
    sendEvent('llm-live-status', { status: 'running', updatedAt: new Date().toISOString() });
    const data = await runBobTurn({
      req,
      prompt,
      requestedModel: req.body?.model || DEFAULT_MODEL,
      parameters: req.body?.parameters || {},
      modelRules: defaultBobModelRules(req.body?.modelRules || {}),
      includeDiagnostics: false,
      persist: true,
      deferEmotion: true,
      onResultReady: sendFinalResult,
      onLiveOutput: chunk => {
        if (chunk?.speech) sendEvent('llm-live-speech', chunk);
        else sendEvent('llm-live-output', chunk);
      }
    });
    sendFinalResult(data);
  } catch (err) {
    const error = getErrorText(err);
    logger.error('bob chat streaming test error', error);
    if (!resultSent && !res.writableEnded && !res.destroyed) {
      sendEvent('error', { ok: false, error });
      res.end();
    }
  }
});

// Non-streaming API proxy (awaits full response)
app.post('/api/chat', applyAiRules, async (req, res) => {
  try {
    const { model, prompt, parameters } = req.body;
    const originalPrompt = req.ai?.originalPrompt || prompt || '';
    const data = await runBobTurn({
      req,
      prompt: originalPrompt,
      requestedModel: model || DEFAULT_MODEL,
      parameters: parameters || {},
      modelRules: defaultBobModelRules(),
      includeDiagnostics: false,
      persist: true
    });

    res.json({
      ok: true,
      data
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
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders && res.flushHeaders();

    let streamedResponseText = '';
    const sendDefaultChunk = chunk => {
      if (!chunk) return;
      res.write(`data: ${JSON.stringify({ response: chunk })}\n\n`);
    };
    const data = await runBobTurn({
      req,
      prompt: originalPrompt,
      requestedModel: model,
      modelRules: defaultBobModelRules(),
      includeDiagnostics: false,
      persist: true,
      deferEmotion: true,
      onLiveOutput: ({ accumulated = '', responseText = '', responseDelta = '', speech = '' } = {}) => {
        if (speech) return;
        if (responseDelta) {
          streamedResponseText = responseText || `${streamedResponseText}${responseDelta}`;
          sendDefaultChunk(responseDelta);
          return;
        }
        const fallbackResponseText = extractStreamingResponseText(accumulated);
        if (!fallbackResponseText) return;
        const nextChunk = fallbackResponseText.slice(streamedResponseText.length);
        streamedResponseText = fallbackResponseText;
        sendDefaultChunk(nextChunk);
      }
    });
    const debugEntries = traceToSkillDebug(data.llm || []);
    res.write(`event: skills\ndata: ${JSON.stringify({ skills: data.skills || [data.skill].filter(Boolean) })}\n\n`);
    if (isAdminRequest(req)) {
      res.write(`event: ollama-debug\ndata: ${JSON.stringify({ skillDebug: debugEntries })}\n\n`);
    }
    res.write(`event: bob-response\ndata: ${JSON.stringify({
      response: data.response,
      metadata: {
        ...(data.metadata || {}),
        router: data.route,
        ...skillDebugMetadata(req, debugEntries)
      },
      skill: data.skill,
      skills: data.skills,
      inputContract: data.inputContract,
      outputContract: data.outputContract,
      query: data.query,
      sources: data.sources
    })}\n\n`);
    if (data.deferredEmotion) {
      const emotionContract = await classifyBobEmotion(data.deferredEmotion);
      const emotionMetadata = {
        emotion: emotionContract.emotion,
        emotionSkill: {
          reason: emotionContract.reason,
          contractValid: emotionContract.contractValid,
          deferred: false
        }
      };
      if (isAdminRequest(req)) {
        res.write(`event: ollama-debug\ndata: ${JSON.stringify({
          skillDebug: [
            skillDebugEntry({ skill: 'bob-emotion', type: 'input', value: emotionContract.input }),
            skillDebugEntry({ skill: 'bob-emotion', type: 'output', value: emotionContract.output })
          ]
        })}\n\n`);
      }
      res.write(`event: bob-emotion\ndata: ${JSON.stringify({ metadata: emotionMetadata })}\n\n`);
    }
    res.write('event: done\ndata: [DONE]\n\n');
    res.end();
  } catch (err) {
    const error = getErrorText(err);
    logger.error('stream setup error', error);
    sendSseError(res, err);
  }
});

// Ollama management: list models (HTTP proxy if available, fallback to `ollama list`)
app.get('/api/ollama/models', async (req, res) => {
  try {
    const models = await getInstalledOllamaModels();
    return res.json({ ok: true, data: models });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Pull/install model jobs. Multiple model downloads can run at the same time.
app.get('/api/ollama/pulls', admin.requireAdmin, (req, res) => {
  const jobs = [...ollamaPullJobs.values()]
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .map(serializeOllamaPullJob);
  res.json({ ok: true, data: jobs });
});

app.post('/api/ollama/pull', admin.requireAdmin, (req, res) => {
  const model = String(req.body.model || '').trim();
  if (!model) return res.status(400).json({ ok: false, error: 'model required' });
  const { job, reused } = startOllamaPullJob(model);
  publishOllamaModelStatus(reused ? 'pull-reused' : 'pull-started');
  res.status(reused ? 200 : 202).json({
    ok: true,
    data: serializeOllamaPullJob(job),
    reused
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
      publishOllamaModelStatus('remove-finished');
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
        publishOllamaModelStatus('remove-finished');
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
  const [version, tags, running] = await Promise.all([
    requestOllamaApi('get', '/api/version'),
    requestOllamaApi('get', '/api/tags'),
    requestOllamaApi('get', '/api/ps')
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

app.get('/api/ollama/model-status/stream', admin.requireAdmin, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders && res.flushHeaders();

  ollamaModelStatusClients.add(res);
  res.write('retry: 2000\n\n');
  try {
    const snapshot = await buildOllamaModelStatusSnapshot('connected');
    sendOllamaModelStatusEvent(res, snapshot);
    scheduleOllamaModelStatusExpiration(snapshot);
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ ok: false, error: getErrorText(err) })}\n\n`);
  }

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    ollamaModelStatusClients.delete(res);
    if (!ollamaModelStatusClients.size && ollamaModelStatusExpireTimer) {
      clearTimeout(ollamaModelStatusExpireTimer);
      ollamaModelStatusExpireTimer = null;
    }
    if (!ollamaModelStatusClients.size && ollamaModelStatusSettledTimer) {
      clearTimeout(ollamaModelStatusSettledTimer);
      ollamaModelStatusSettledTimer = null;
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

  const finishActivity = beginOllamaModelActivity(model, 'manual-load');
  try {
    logger.info(`Loading model ${model} with keep_alive ${keepAlive}`);
    const resp = await axios.post(`${OLLAMA_URL}/api/generate`, {
      model,
      prompt: '',
      keep_alive: keepAlive,
      stream: false
    }, { timeout: 120000 });
    publishOllamaModelStatus('load-finished');
    res.json({ ok: true, data: resp.data });
  } catch (err) {
    const error = getErrorText(err);
    logger.error(`ollama load ${model} failed`, error);
    res.status(err?.response?.status || 500).json({ ok: false, error });
  } finally {
    finishActivity();
  }
});

app.post('/api/ollama/unload', admin.requireAdmin, async (req, res) => {
  const model = req.body.model;
  if (!model) return res.status(400).json({ ok: false, error: 'model required' });

  const finishActivity = beginOllamaModelActivity(model, 'manual-unload');
  try {
    logger.info(`Unloading model ${model}`);
    const resp = await axios.post(`${OLLAMA_URL}/api/generate`, {
      model,
      prompt: '',
      keep_alive: 0,
      stream: false
    }, { timeout: 30000 });
    publishOllamaModelStatus('unload-finished');
    res.json({ ok: true, data: resp.data });
  } catch (err) {
    const error = getErrorText(err);
    logger.error(`ollama unload ${model} failed`, error);
    res.status(err?.response?.status || 500).json({ ok: false, error });
  } finally {
    finishActivity();
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
