const fs = require('fs');
const crypto = require('crypto');
const { WebSocket, WebSocketServer } = require('ws');

const DEFAULT_SAMPLE_RATE = 16000;
const SOCKET_TOKEN_TTL_MS = 60 * 1000;
const RECOGNIZER_DIAGNOSTIC_INTERVAL_MS = 1000;
const RECOGNIZER_PROCESS_WARN_MS = 50;
const RECOGNIZER_INPUT_GAP_WARN_MS = 250;

function loadVosk(logger) {
  try {
    return require('vosk');
  } catch (err) {
    logger?.warn?.(`Vosk STT unavailable: ${err?.message || err}`);
    return null;
  }
}

function safeJsonParse(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (err) {
    return {};
  }
}

function createSttService({ logger, security, modelPath = process.env.VOSK_MODEL_PATH, sampleRate = DEFAULT_SAMPLE_RATE } = {}) {
  const vosk = loadVosk(logger);
  let model = null;
  let modelError = '';
  const socketTokens = new Map();

  function pruneSocketTokens() {
    const now = Date.now();
    for (const [token, entry] of socketTokens.entries()) {
      if (!entry || entry.expiresAt <= now) socketTokens.delete(token);
    }
  }

  function createSocketToken(user = {}) {
    pruneSocketTokens();
    const token = crypto.randomUUID();
    socketTokens.set(token, {
      user,
      expiresAt: Date.now() + SOCKET_TOKEN_TTL_MS
    });
    return token;
  }

  function consumeSocketToken(token) {
    pruneSocketTokens();
    if (!token) return null;
    const entry = socketTokens.get(token);
    socketTokens.delete(token);
    if (!entry || entry.expiresAt <= Date.now()) return null;
    return entry.user || {};
  }

  function status() {
    if (!vosk) {
      return {
        ok: false,
        provider: 'vosk',
        state: 'missing',
        sampleRate,
        error: 'The vosk package is not installed or could not be loaded.'
      };
    }
    if (!modelPath) {
      return {
        ok: false,
        provider: 'vosk',
        state: 'unconfigured',
        sampleRate,
        error: 'VOSK_MODEL_PATH is not configured.'
      };
    }
    if (!fs.existsSync(modelPath)) {
      return {
        ok: false,
        provider: 'vosk',
        state: 'model-missing',
        sampleRate,
        modelPath,
        error: `Vosk model path was not found: ${modelPath}`
      };
    }
    if (modelError) {
      return {
        ok: false,
        provider: 'vosk',
        state: 'error',
        sampleRate,
        modelPath,
        error: modelError
      };
    }
    return {
      ok: true,
      provider: 'vosk',
      state: model ? 'ready' : 'configured',
      sampleRate,
      modelPath
    };
  }

  function getModel() {
    if (model) return model;
    const current = status();
    if (!current.ok && current.state !== 'configured') {
      throw new Error(current.error || 'STT is not configured.');
    }
    try {
      vosk.setLogLevel?.(-1);
      model = new vosk.Model(modelPath);
      modelError = '';
      logger?.info?.(`Loaded Vosk STT model from ${modelPath}`);
      return model;
    } catch (err) {
      modelError = err?.message || String(err);
      throw err;
    }
  }

  function send(ws, payload) {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  }

  function sendRecognizerResult(ws, recognizer, eventType = 'final') {
    const result = safeJsonParse(recognizer.result());
    const text = String(result.text || '').trim();
    send(ws, { type: eventType, text, result });
    return text;
  }

  function createRecognizerStats() {
    return {
      startedAt: Date.now(),
      binaryMessages: 0,
      bytes: 0,
      lastBinaryAt: 0,
      maxInputGapMs: 0,
      maxProcessMs: 0,
      partials: 0,
      finals: 0,
      emptyFinals: 0,
      acceptedWaveforms: 0,
      flushes: 0,
      lastPartialAt: 0,
      lastFinalAt: 0,
      lastDiagnosticAt: 0
    };
  }

  function maybeSendRecognizerDiagnostic(ws, stats, force = false) {
    const now = Date.now();
    const pressure = stats.maxInputGapMs > RECOGNIZER_INPUT_GAP_WARN_MS
      || stats.maxProcessMs > RECOGNIZER_PROCESS_WARN_MS;
    if (!force && !pressure && now - stats.lastDiagnosticAt < RECOGNIZER_DIAGNOSTIC_INTERVAL_MS) return;
    stats.lastDiagnosticAt = now;
    send(ws, {
      type: 'diagnostic',
      area: 'stt-recognizer',
      pressure,
      binaryMessages: stats.binaryMessages,
      bytes: stats.bytes,
      maxInputGapMs: stats.maxInputGapMs,
      maxProcessMs: stats.maxProcessMs,
      partials: stats.partials,
      finals: stats.finals,
      emptyFinals: stats.emptyFinals,
      acceptedWaveforms: stats.acceptedWaveforms,
      flushes: stats.flushes,
      lastPartialMs: stats.lastPartialAt ? now - stats.lastPartialAt : null,
      lastFinalMs: stats.lastFinalAt ? now - stats.lastFinalAt : null,
      uptimeMs: now - stats.startedAt
    });
    stats.maxInputGapMs = 0;
    stats.maxProcessMs = 0;
  }

  async function handleConnection(ws, req) {
    const url = new URL(req.url || '/', 'http://localhost');
    const tokenUser = consumeSocketToken(url.searchParams.get('token'));
    if (!tokenUser) {
      const auth = await security.authenticateWebSocketRequest(req);
      if (!auth.ok) {
        send(ws, { type: 'error', error: auth.error || 'Authentication required' });
        ws.close(1008, auth.error || 'Authentication required');
        return;
      }
    }

    let recognizer = null;
    const recognizerStats = createRecognizerStats();
    try {
      recognizer = new vosk.Recognizer({ model: getModel(), sampleRate });
    } catch (err) {
      const current = status();
      send(ws, { type: 'unavailable', ...current, error: current.error || err?.message || 'STT unavailable' });
      ws.close(1011, 'STT unavailable');
      return;
    }

    send(ws, { type: 'ready', provider: 'vosk', sampleRate });
    ws.on('message', (data, isBinary) => {
      if (!recognizer) return;
      if (!isBinary) {
        const msg = safeJsonParse(data);
        if (msg.type === 'stop') ws.close(1000, 'client stopped');
        if (msg.type === 'flush') {
          recognizerStats.flushes += 1;
          const text = sendRecognizerResult(ws, recognizer, 'final');
          if (text) {
            recognizerStats.finals += 1;
            recognizerStats.lastFinalAt = Date.now();
          } else {
            recognizerStats.emptyFinals += 1;
          }
          maybeSendRecognizerDiagnostic(ws, recognizerStats, true);
        }
        return;
      }

      try {
        const now = Date.now();
        const inputGapMs = recognizerStats.lastBinaryAt ? now - recognizerStats.lastBinaryAt : 0;
        recognizerStats.lastBinaryAt = now;
        recognizerStats.binaryMessages += 1;
        recognizerStats.bytes += data?.byteLength || data?.length || 0;
        recognizerStats.maxInputGapMs = Math.max(recognizerStats.maxInputGapMs, inputGapMs);
        const processStartedAt = Date.now();
        const accepted = recognizer.acceptWaveform(data);
        const processMs = Date.now() - processStartedAt;
        recognizerStats.maxProcessMs = Math.max(recognizerStats.maxProcessMs, processMs);
        if (accepted) {
          recognizerStats.acceptedWaveforms += 1;
          const text = sendRecognizerResult(ws, recognizer, 'final');
          if (text) {
            recognizerStats.finals += 1;
            recognizerStats.lastFinalAt = Date.now();
          } else {
            recognizerStats.emptyFinals += 1;
          }
        } else {
          const partial = safeJsonParse(recognizer.partialResult());
          const text = String(partial.partial || '').trim();
          if (text) {
            recognizerStats.partials += 1;
            recognizerStats.lastPartialAt = Date.now();
            send(ws, { type: 'partial', text, result: partial });
          }
        }
        maybeSendRecognizerDiagnostic(ws, recognizerStats);
      } catch (err) {
        send(ws, { type: 'error', error: err?.message || 'STT processing failed' });
      }
    });

    ws.on('close', () => {
      if (!recognizer) return;
      try {
        const finalResult = safeJsonParse(recognizer.finalResult());
        const text = String(finalResult.text || '').trim();
        if (text && ws.readyState === ws.OPEN) send(ws, { type: 'final', text, result: finalResult });
      } catch (err) {}
      try {
        recognizer.free?.();
      } catch (err) {}
      recognizer = null;
    });
  }

  function attach(server) {
    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname !== '/api/stt/stream') return;
      wss.handleUpgrade(req, socket, head, ws => {
        wss.emit('connection', ws, req);
      });
    });
    wss.on('connection', handleConnection);
    return wss;
  }

  return { attach, status, createSocketToken };
}

module.exports = { createSttService, DEFAULT_SAMPLE_RATE };
