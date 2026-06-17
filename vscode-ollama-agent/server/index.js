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

const app = express();

const PORT = process.env.PORT || 3000;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama2';
// Support custom OLLAMA_BIN path (useful on Windows where ollama may not be on PATH)
const OLLAMA_BIN = process.env.OLLAMA_BIN || 'ollama';
const DEPLOYMENT_ENV = process.env.DEPLOYMENT_ENV || process.env.NODE_ENV || 'development';

// instantiate logger early so top-level functions (loadRules, routes) can use it without causing a TDZ
const logger = new Logger({ bufferSize: 2000 });
const security = createSecurityMiddleware(logger);

function validateProductionConfig() {
  if (DEPLOYMENT_ENV !== 'production') return;

  const unsafeSecretValues = new Set(['change-me-before-production', 'replace-with-generated-secret']);
  const unsafeValues = [
    ['OIDC_CLIENT_SECRET', process.env.OIDC_CLIENT_SECRET],
    ['KEYCLOAK_ADMIN_PASSWORD', process.env.KEYCLOAK_ADMIN_PASSWORD],
    ['KEYCLOAK_DB_PASSWORD', process.env.KEYCLOAK_DB_PASSWORD]
  ].filter(([, value]) => !value || unsafeSecretValues.has(value));

  if (unsafeValues.length > 0) {
    throw new Error(`Production deployment has unsafe secret values: ${unsafeValues.map(([name]) => name).join(', ')}`);
  }

  if (String(process.env.SECURITY_SECURE_COOKIES || '').toLowerCase() !== 'true') {
    throw new Error('Production deployment requires SECURITY_SECURE_COOKIES=true');
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
app.post('/auth/logout', security.logout);
app.get('/api/auth/me', (req, res) => {
  const user = req.user || {};
  res.json({
    ok: true,
    data: {
      name: user.name || user.preferred_username || user.email || 'Signed in user',
      email: user.email || user.preferred_username || user.upn || '',
      subject: user.sub || ''
    }
  });
});

// Asset version for cache-busting (set once when server starts)
const ASSET_VERSION = Date.now();

// Serve static assets with no-cache headers to ensure clients always check for updates
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));
app.use('/vendor/lucide', express.static(path.join(__dirname, '..', 'node_modules', 'lucide', 'dist', 'umd')));

function buildTtsOptions(lang) {
  return {
    lang,
    slow: false,
    host: 'https://translate.google.com',
  };
}

function synthesizeLocalSpeech(text) {
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
      '$speaker.Rate = 0;',
      '$speaker.Volume = 100;',
      '$speaker.SetOutputToWaveFile($env:TTS_OUT);',
      '$speaker.Speak($text);',
      '$speaker.Dispose();'
    ].join(' ');

    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true,
      env: { ...process.env, TTS_TEXT_B64: textB64, TTS_OUT: outPath }
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

// TTS endpoint: returns same-origin audio chunks generated through google-tts-api
app.get('/api/tts', async (req, res) => {
  const text = req.query.text || '';
  const lang = req.query.lang || 'en';
  if (!text) return res.status(400).json({ ok: false, error: 'text required' });
  try {
    const options = buildTtsOptions(lang);
    const chunks = text.length > 200
      ? gtts.getAllAudioUrls(text, options).map(item => item.shortText)
      : [text];
    const urls = chunks.map(chunk => `/api/tts/audio?lang=${encodeURIComponent(lang)}&text=${encodeURIComponent(chunk)}`);

    res.json({ ok: true, urls, url: urls[0] });
  } catch (err) {
    logger.error('tts error', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get('/api/tts/audio', async (req, res) => {
  const text = req.query.text || '';
  const lang = req.query.lang || 'en';
  if (!text) return res.status(400).json({ ok: false, error: 'text required' });

  try {
    let audio;
    let contentType = 'audio/mpeg';

    try {
      const base64 = await gtts.getAudioBase64(text, buildTtsOptions(lang));
      audio = Buffer.from(base64, 'base64');
    } catch (err) {
      logger.warn('google-tts-api audio failed, using local speech fallback', err?.message || err);
      audio = await synthesizeLocalSpeech(text);
      contentType = 'audio/wav';
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(audio);
  } catch (err) {
    logger.error('tts audio error', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Serve index.html dynamically and inject a cache-busting query param for included assets
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, '..', 'public', 'index.html');
  fs.readFile(indexPath, 'utf8', (err, data) => {
    if (err) {
      logger.error('Failed to read index.html', err);
      return res.status(500).send('Internal Server Error');
    }
    // Append version query param to asset URLs so browser will reload when server restarts
    const v = ASSET_VERSION;
    const replaced = data
      .replace(/(\/app\.js)(["'])/g, `$1?v=${v}$2`)
      .replace(/(\/style\.css)(["'])/g, `$1?v=${v}$2`)
      .replace(/(\/mic\.js)(["'])/g, `$1?v=${v}$2`)
      .replace(/(\/menu\.js)(["'])/g, `$1?v=${v}$2`);

    res.setHeader('Content-Type', 'text/html');
    res.send(replaced);
  });
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

  // inject system-level prefix
  const prep = (AI_RULES.transformations && AI_RULES.transformations.prepend) || [];
  const transformedPrompt = prep.join('\n') + '\n' + prompt + '\n' + (AI_RULES.transformations && AI_RULES.transformations.append || []).join('\n');
  if (req.body) req.body.prompt = transformedPrompt;
  if (req.query) req.query.prompt = transformedPrompt;
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

// expose rules endpoints
app.get('/api/rules', (req, res) => {
  res.json({ ok: true, data: AI_RULES });
});
app.post('/api/rules', (req, res) => {
  // basic: overwrite file (in real app add auth)
  try { fs.writeFileSync(RULES_PATH, JSON.stringify(req.body, null, 2), 'utf8'); loadRules(); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Non-streaming API proxy (awaits full response)
app.post('/api/chat', applyAiRules, async (req, res) => {
  try {
    const { model, prompt, parameters } = req.body;
    const payload = Object.assign({ model: model || DEFAULT_MODEL, prompt: prompt || '' }, parameters || {});

    const resp = await axios.post(`${OLLAMA_URL}/api/generate`, payload, {
      responseType: 'json',
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000
    });

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

  const payload = { model, prompt };
  logger.info(`Streaming chat request using model ${model}`);

  try {
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

    stream.on('data', (chunk) => {
      try {
        const text = chunk.toString();
        text.split(/\r?\n/).forEach((line) => { if (!line) return; res.write(`data: ${line}\n\n`); });
      } catch (e) { res.write(`data: ${chunk}\n\n`); }
    });

    stream.on('end', () => { res.write('event: done\ndata: [DONE]\n\n'); res.end(); });
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
app.post('/api/ollama/pull', (req, res) => {
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
app.post('/api/ollama/remove', (req, res) => {
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
app.get('/api/ollama/monitor', async (req, res) => {
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
app.get('/api/ollama/available', async (req, res) => {
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
app.post('/api/control/reboot', (req, res) => {
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

app.get('/api/ollama/monitor/details', async (req, res) => {
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

app.post('/api/ollama/show', async (req, res) => {
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

app.post('/api/ollama/load', async (req, res) => {
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

app.post('/api/ollama/unload', async (req, res) => {
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

app.post('/api/control/shutdown', (req, res) => {
  logger.info('Shutdown requested via API');
  res.json({ ok: true, msg: 'Shutting down server' });
  setTimeout(() => shutdownServer(0), 100);
});

// Provide logs history
app.get('/api/logs', (req, res) => {
  res.json({ ok: true, data: logger.history(500) });
});

// SSE stream of logs
app.get('/api/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();

  const send = (entry) => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  };
  // send recent history first
  logger.history(200).forEach(send);
  logger.on('log', send);

  req.on('close', () => {
    logger.removeListener('log', send);
  });
});

// Redirect unknown routes to root (SPA fallback) — must be last!
function shutdownServer(exitCode = 0) {
  try {
    logger.info('Closing server connections');
    if (server) {
      server.close(() => {
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
