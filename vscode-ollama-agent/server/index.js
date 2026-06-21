require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const gtts = require('google-tts-api');
const { exec, spawn } = require('child_process');
const Logger = require('./logger');
const { getAvailableModels, formatModelRef } = require('./ollamaModels');
const { createSecurityMiddleware } = require('./security');
const { createMemoryStore } = require('./memory');
const { createAdminStore } = require('./admin');
const { createActivityMonitor } = require('./activity');
const { createSecurityEventStore } = require('./securityEvents');
const { createYahooStore } = require('./yahoo');
const { createUserChatStore } = require('./userChat');
const { shouldSearchWeb, extractSearchQuery, searchWeb, buildWebSummaryPrompt } = require('./webSearch');
const { getTtsProvider, getSupportedTtsProviders, resolveTtsProvider, buildPiperEnv, splitTextForTts, synthesizePiperSpeech } = require('./tts');

const app = express();

const PORT = process.env.PORT || 3000;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama2';
const MEMORY_SUMMARY_INTERVALS = {
  short: Number(process.env.MEMORY_SHORT_SUMMARY_INTERVAL || 6),
  medium: Number(process.env.MEMORY_MEDIUM_SUMMARY_INTERVAL || 20),
  long: Number(process.env.MEMORY_LONG_SUMMARY_INTERVAL || 60)
};
// Support custom OLLAMA_BIN path (useful on Windows where ollama may not be on PATH)
const OLLAMA_BIN = process.env.OLLAMA_BIN || 'ollama';
const DEPLOYMENT_ENV = process.env.DEPLOYMENT_ENV || process.env.NODE_ENV || 'development';
const TTS_PROVIDER = getTtsProvider();

// instantiate logger early so top-level functions (loadRules, routes) can use it without causing a TDZ
const logger = new Logger({ bufferSize: 2000 });
const securityEvents = createSecurityEventStore(logger);
const security = createSecurityMiddleware(logger, securityEvents);
const memory = createMemoryStore(logger);
const admin = createAdminStore(logger, securityEvents);
const activity = createActivityMonitor(logger);
const yahoo = createYahooStore(logger);
const userChat = createUserChatStore(logger);

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

function buildTtsOptions(lang) {
  return {
    lang,
    slow: false,
    host: 'https://translate.google.com',
  };
}

function synthesizeLocalSpeech(text, options = {}) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('Local speech fallback is only implemented for Windows'));
      return;
    }

    const outPath = path.join(os.tmpdir(), `ollama-agent-tts-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`);
    const textB64 = Buffer.from(text, 'utf8').toString('base64');
    const command = [
      'Add-Type -AssemblyName System.Speech;',
      '$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:TTS_TEXT_B64));',
      '$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
      'if ($env:TTS_WINDOWS_VOICE) { $speaker.SelectVoice($env:TTS_WINDOWS_VOICE); }',
      '$speaker.Rate = 0;',
      '$speaker.Volume = 100;',
      '$speaker.SetOutputToWaveFile($env:TTS_OUT);',
      '$speaker.Speak($text);',
      '$speaker.Dispose();'
    ].join(' ');

    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true,
      env: { ...process.env, TTS_TEXT_B64: textB64, TTS_OUT: outPath, TTS_WINDOWS_VOICE: options.voice || '' }
    });

    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `PowerShell speech exited with ${code}`));
        return;
      }

      fs.readFile(outPath, (err, audio) => {
        fs.unlink(outPath, () => {});
        if (err) reject(err);
        else resolve(audio);
      });
    });
  });
}

function listWindowsSpeechVoices() {
  return new Promise(resolve => {
    if (process.platform !== 'win32') {
      resolve([]);
      return;
    }

    const command = [
      'Add-Type -AssemblyName System.Speech;',
      '$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
      '$speaker.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name };',
      '$speaker.Dispose();'
    ].join(' ');

    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true
    });

    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.on('error', () => resolve([]));
    child.on('close', code => {
      if (code !== 0) {
        resolve([]);
        return;
      }
      resolve(stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean));
    });
  });
}

async function synthesizeConfiguredSpeech(text, lang, provider = TTS_PROVIDER, options = {}) {
  if (provider === 'piper') {
    return synthesizePiperSpeech(text, buildPiperEnv(options.piper));
  }

  if (provider === 'windows') {
    return {
      audio: await synthesizeLocalSpeech(text, options.windows),
      contentType: 'audio/wav',
      provider: 'windows'
    };
  }

  return synthesizeGoogleSpeech(text, lang);
}

async function synthesizeGoogleSpeech(text, lang) {
  const base64 = await gtts.getAudioBase64(text, buildTtsOptions(lang));
  return {
    audio: Buffer.from(base64, 'base64'),
    contentType: 'audio/mpeg',
    provider: 'google'
  };
}

// TTS endpoint: returns same-origin audio chunks generated through the configured provider.
app.get('/api/tts', async (req, res) => {
  const text = req.query.text || '';
  const lang = req.query.lang || 'en';
  const provider = resolveTtsProvider(req.query.provider, TTS_PROVIDER);
  const speaker = req.query.speaker || '';
  const voice = req.query.voice || '';
  const lengthScale = req.query.lengthScale || '';
  const noiseScale = req.query.noiseScale || '';
  const noiseW = req.query.noiseW || '';
  if (!text) return res.status(400).json({ ok: false, error: 'text required' });
  try {
    const chunks = splitTextForTts(text, provider === 'piper' ? 350 : 200);
    const optionParams = new URLSearchParams({
      lang,
      provider,
      speaker,
      voice,
      lengthScale,
      noiseScale,
      noiseW
    });
    const urls = chunks.map(chunk => `/api/tts/audio?${optionParams.toString()}&text=${encodeURIComponent(chunk)}`);

    res.json({ ok: true, provider, lang, urls, url: urls[0] });
  } catch (err) {
    logger.error('tts error', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get('/api/tts/status', async (req, res) => {
  const windowsVoices = await listWindowsSpeechVoices();
  res.json({
    ok: true,
    data: {
      provider: TTS_PROVIDER,
      providers: getSupportedTtsProviders(),
      defaultLang: process.env.TTS_LANG || 'en',
      defaults: {
        piperSpeaker: process.env.TTS_PIPER_SPEAKER || process.env.PIPER_SPEAKER || '',
        piperLengthScale: process.env.TTS_PIPER_LENGTH_SCALE || '',
        piperNoiseScale: process.env.TTS_PIPER_NOISE_SCALE || '',
        piperNoiseW: process.env.TTS_PIPER_NOISE_W || '',
        windowsVoice: process.env.TTS_WINDOWS_VOICE || ''
      },
      windowsVoices,
      piperConfigured: Boolean(process.env.TTS_PIPER_MODEL || process.env.PIPER_MODEL)
    }
  });
});

app.get('/api/tts/audio', async (req, res) => {
  const text = req.query.text || '';
  const lang = req.query.lang || 'en';
  const provider = resolveTtsProvider(req.query.provider, TTS_PROVIDER);
  const options = {
    piper: {
      speaker: req.query.speaker,
      lengthScale: req.query.lengthScale,
      noiseScale: req.query.noiseScale,
      noiseW: req.query.noiseW
    },
    windows: {
      voice: req.query.voice || process.env.TTS_WINDOWS_VOICE || ''
    }
  };
  if (!text) return res.status(400).json({ ok: false, error: 'text required' });

  try {
    let result;

    try {
      result = await synthesizeConfiguredSpeech(text, lang, provider, options);
    } catch (err) {
      logger.warn(`${provider} tts failed`, err?.message || err);
      if (provider === 'piper') {
        try {
          result = await synthesizeGoogleSpeech(text, lang);
        } catch (googleErr) {
          logger.warn('google-tts-api audio failed, using local speech fallback', googleErr?.message || googleErr);
        }
      }

      if (!result) {
        logger.warn('using local speech fallback');
        result = {
          audio: await synthesizeLocalSpeech(text, options.windows),
          contentType: 'audio/wav',
          provider: 'windows'
        };
      }
    }

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
  req.ai = {
    originalPrompt: prompt,
    systemInstructions: [...prep, ...append]
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

function buildMemorySummaryPrompt(scope, transcript) {
  const instructions = {
    short: 'Create a concise short-term memory summary of the latest conversation. Capture immediate goals, current task state, preferences stated today, and unresolved next steps. Ignore greetings, small talk, and assistant mistakes unless they created an unresolved user-facing issue. Keep it under 120 words.',
    medium: 'Create a medium-term memory summary across the recent conversation history. Capture recurring preferences, active projects, decisions, constraints, and useful context. Ignore greetings, small talk, and assistant mistakes unless they reveal a durable user preference or active problem. Keep it under 250 words.',
    long: 'Create a long-term memory summary suitable for durable personalization. Capture stable user preferences, enduring projects, identity/context facts the user intentionally revealed, and durable operating principles. Avoid transient details, greetings, and assistant mistakes. Keep it under 400 words.'
  };

  return [
    'You are Bob memory summarization skill.',
    instructions[scope] || instructions.short,
    'Only summarize information supported by the transcript. Do not invent facts.',
    'Write in third person about the user and Bob.',
    'Return only the summary text. Do not quote or reproduce the transcript. Do not write a preamble like "Based on the transcript". Do not include markdown tables.',
    '',
    '<conversation_transcript>',
    transcript || '(No conversation messages yet.)',
    '</conversation_transcript>'
  ].join('\n');
}

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

async function generateOllamaText(model, prompt, options = {}) {
  const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
    model,
    prompt,
    stream: false,
    options
  }, {
    responseType: 'json',
    headers: { 'Content-Type': 'application/json' },
    timeout: 120000
  });

  return String(response.data?.response || '').trim();
}

async function runWebSearchSkill({ req, model, prompt }) {
  const query = extractSearchQuery(prompt);
  const results = await searchWeb(query);
  const summaryPrompt = buildWebSummaryPrompt(prompt, query, results);
  const summary = await generateOllamaText(model, summaryPrompt, { temperature: 0.2 });
  const fallback = results.length
    ? [
        `I searched the web for "${query}" and found these sources:`,
        '',
        ...results.map((item, index) => `${index + 1}. ${item.title} - ${item.url}${item.snippet ? `\n   ${item.snippet}` : ''}`)
      ].join('\n')
    : `I searched the web for "${query}", but I could not find usable results.`;

  return {
    query,
    results,
    response: summary || fallback
  };
}

const memorySummaryJobs = new Set();
const memoryFactoidJobs = new Set();

function transcriptFromMessages(messages) {
  return messages
    .map(row => `${row.role === 'assistant' ? 'Bob' : row.role === 'system' ? 'System' : 'User'}: ${row.content}`)
    .join('\n\n');
}

async function refreshMemorySummary({ req, model, scope, conversationId = 'default' }) {
  const scopeConfig = memory.summaryScopes[scope];
  if (!scopeConfig) throw new Error('Invalid memory scope');

  const messages = await memory.getMessages({ req, limit: scopeConfig.limit, conversationId });
  const summaryText = await generateOllamaText(model, buildMemorySummaryPrompt(scope, transcriptFromMessages(messages)), { temperature: 0.2 });
  return memory.saveSummary({
    req,
    scope,
    summary: summaryText || 'No durable memory has been formed yet.',
    sourceMessageCount: messages.length,
    model
  });
}

async function updateMemorySummariesAfterTurn({ req, model, conversationId = 'default' }) {
  try {
    const [summaries, messageCount] = await Promise.all([
      memory.getSummaries({ req }),
      memory.getMessageCount({ req, conversationId })
    ]);

    const dueScopes = Object.keys(memory.summaryScopes).filter(scope => {
      const interval = Math.max(1, MEMORY_SUMMARY_INTERVALS[scope] || 1);
      const sourceCount = Number(summaries[scope]?.sourceMessageCount || 0);
      return messageCount > 0 && messageCount - sourceCount >= interval;
    });

    for (const scope of dueScopes) {
      const jobKey = `${memory.userKey(req)}:${conversationId}:${scope}`;
      if (memorySummaryJobs.has(jobKey)) continue;

      memorySummaryJobs.add(jobKey);
      refreshMemorySummary({ req, model, scope, conversationId })
        .then(summary => logger.info(`Memory ${scope} summary refreshed from ${summary.sourceMessageCount} messages`))
        .catch(err => logger.warn(`Memory ${scope} summary refresh failed`, getErrorText(err)))
        .finally(() => memorySummaryJobs.delete(jobKey));
    }
  } catch (err) {
    logger.warn('Memory summary scheduler failed', getErrorText(err));
  }
}

function parseFactoidExtraction(text) {
  if (!text) return [];
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed.factoids) ? parsed.factoids : [];
  } catch (err) {
    return [];
  }
}

async function updateMemoryFactoidsAfterTurn({ req, model, conversationId = 'default', sourceMessageId = null }) {
  const jobKey = `${memory.userKey(req)}:${conversationId}:factoids`;
  if (memoryFactoidJobs.has(jobKey)) return;

  memoryFactoidJobs.add(jobKey);
  try {
    const messages = await memory.getMessages({ req, limit: 16, conversationId });
    const text = await generateOllamaText(model, buildFactoidExtractionPrompt(transcriptFromMessages(messages)), { temperature: 0.1 });
    const saved = await memory.saveFactoids({
      req,
      model,
      sourceMessageId,
      factoids: parseFactoidExtraction(text)
    });
    if (saved.length > 0) logger.info(`Memory factoids refreshed: ${saved.length} saved`);
  } catch (err) {
    logger.warn('Memory factoid refresh failed', getErrorText(err));
  } finally {
    memoryFactoidJobs.delete(jobKey);
  }
}

function updateMemoryAfterTurn({ req, model, conversationId = 'default', sourceMessageId = null }) {
  updateMemorySummariesAfterTurn({ req, model, conversationId });
  updateMemoryFactoidsAfterTurn({ req, model, conversationId, sourceMessageId });
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
  const scope = req.body?.scope || 'short';
  const scopeConfig = memory.summaryScopes[scope];
  if (!scopeConfig) return res.status(400).json({ ok: false, error: 'Invalid memory scope' });

  try {
    const model = req.body?.model || DEFAULT_MODEL;
    const summary = await refreshMemorySummary({ req, model, scope, conversationId: req.body?.conversationId || 'default' });
    res.json({ ok: true, data: summary });
  } catch (err) {
    const error = getErrorText(err);
    logger.error(`memory summarize ${scope} failed`, error);
    res.status(err?.response?.status || 500).json({ ok: false, error });
  }
});
app.get('/api/admin/bootstrap/status', admin.bootstrapStatus);
app.post('/api/admin/bootstrap', admin.bootstrapSelf);
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
        metadata: { skill: 'web-search', query: search.query, results: search.results }
      });
      updateMemoryAfterTurn({ req, model: chatModel });
      return res.json({
        ok: true,
        data: {
          response: search.response,
          done: true,
          skill: 'web-search',
          query: search.query,
          sources: search.results
        }
      });
    }

    const [history, summaries, factoids] = await Promise.all([
      memory.getRecent({ req }),
      memory.getSummaries({ req }),
      memory.getFactoids({ req, limit: 50 })
    ]);
    const promptWithMemory = memory.buildPrompt(originalPrompt, history, summaries, factoids, {
      systemInstructions: req.ai?.systemInstructions || []
    });
    const payload = Object.assign({ model: chatModel, prompt: promptWithMemory }, parameters || {});

    const resp = await axios.post(`${OLLAMA_URL}/api/generate`, payload, {
      responseType: 'json',
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000
    });

    await memory.addMessage({ req, role: 'user', model: chatModel, content: originalPrompt });
    const assistantMessage = await memory.addMessage({ req, role: 'assistant', model: chatModel, content: resp.data?.response || JSON.stringify(resp.data) });
    updateMemoryAfterTurn({ req, model: chatModel, sourceMessageId: assistantMessage?.id });
    res.json({ ok: true, data: resp.data });
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
        metadata: { skill: 'web-search', query: search.query, results: search.results }
      });
      updateMemoryAfterTurn({ req, model });

      res.write(`data: ${JSON.stringify({
        response: search.response,
        done: true,
        skill: 'web-search',
        query: search.query,
        sources: search.results
      })}\n\n`);
      res.write('event: done\ndata: [DONE]\n\n');
      return res.end();
    }

    const [history, summaries, factoids] = await Promise.all([
      memory.getRecent({ req }),
      memory.getSummaries({ req }),
      memory.getFactoids({ req, limit: 50 })
    ]);
    const payload = {
      model,
      prompt: memory.buildPrompt(originalPrompt, history, summaries, factoids, {
        systemInstructions: req.ai?.systemInstructions || []
      })
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

    const stream = resp.data;
    let assistantResponse = '';

    stream.on('data', (chunk) => {
      try {
        const text = chunk.toString();
        text.split(/\r?\n/).forEach((line) => {
          if (!line) return;
          try {
            const parsed = JSON.parse(line);
            if (typeof parsed.response === 'string') assistantResponse += parsed.response;
          } catch (parseErr) {}
          res.write(`data: ${line}\n\n`);
        });
      } catch (e) { res.write(`data: ${chunk}\n\n`); }
    });

    stream.on('end', async () => {
      const assistantMessage = await memory.addMessage({ req, role: 'assistant', model, content: assistantResponse });
      updateMemoryAfterTurn({ req, model, sourceMessageId: assistantMessage?.id });
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
