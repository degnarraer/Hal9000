const fs = require('fs');
const crypto = require('crypto');
const { WebSocket, WebSocketServer } = require('ws');
const { createFasterWhisperTranscriber } = require('./fasterWhisper');

const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_VAD_START_THRESHOLD = 0.012;
const DEFAULT_VAD_END_THRESHOLD = 0.006;
const DEFAULT_VAD_END_SILENCE_MS = 850;
const SOCKET_TOKEN_TTL_MS = 60 * 1000;
const STT_PROVIDERS = new Set(['faster-whisper', 'vosk']);
const DEFAULT_STAGE_OPTIONS = {
  vad: true,
  stt: true,
  llm: true,
  tts: true
};

function loadVosk(logger) {
  try {
    return require('vosk');
  } catch (err) {
    logger?.warn?.(`Voice pipeline STT unavailable: ${err?.message || err}`);
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

function normalizeSttProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  return STT_PROVIDERS.has(provider) ? provider : 'faster-whisper';
}

function normalizeStageOptions(options = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_STAGE_OPTIONS).map(([key, defaultValue]) => [
      key,
      options[key] === undefined ? defaultValue : Boolean(options[key])
    ])
  );
}

function normalizeTranscriptText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function isLikelyInternalSttTranscript(text) {
  const clean = normalizeTranscriptText(text)
    .toLowerCase()
    .replace(/[.?!,:;()[\]{}"'`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return false;

  const statusWords = new Set([
    'idle',
    'ready',
    'processing',
    'transcribing',
    'transcription',
    'complete',
    'completed',
    'partial',
    'final',
    'disabled',
    'unavailable',
    'stalled',
    'good',
    'started',
    'start'
  ]);
  if (clean === 'stt' || clean === 's t t') return true;
  if (clean.startsWith('stt ') && statusWords.has(clean.slice(4))) return true;
  if (clean.endsWith(' stt') && statusWords.has(clean.slice(0, -4))) return true;
  return false;
}

function sanitizePipelineTranscript(text) {
  const clean = normalizeTranscriptText(text);
  return isLikelyInternalSttTranscript(clean) ? '' : clean;
}

function pcm16Levels(data) {
  const input = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
  const sampleCount = Math.floor(input.length / 2);
  if (!sampleCount) return { rms: 0, peak: 0, sampleCount: 0 };

  let sumSquares = 0;
  let peak = 0;
  for (let offset = 0; offset + 1 < input.length; offset += 2) {
    const sample = input.readInt16LE(offset) / 32768;
    const abs = Math.abs(sample);
    sumSquares += sample * sample;
    if (abs > peak) peak = abs;
  }
  return {
    rms: Math.sqrt(sumSquares / sampleCount),
    peak,
    sampleCount
  };
}

function createVadState(now = Date.now()) {
  return {
    speaking: false,
    startedAt: 0,
    lastSpeechAt: 0,
    lastChunkAt: 0,
    chunks: 0,
    turnChunks: 0,
    maxGapMs: 0,
    maxRms: 0,
    maxPeak: 0,
    lastDiagnosticAt: now
  };
}

function createVoicePipeline({
  logger,
  security,
  modelPath = process.env.VOSK_MODEL_PATH,
  sampleRate = DEFAULT_SAMPLE_RATE,
  runTurn,
  defaultModel,
  synthesizeSpeech,
  ttsProvider = () => 'kokoro',
  sttProvider = process.env.VOICE_PIPELINE_STT_PROVIDER || process.env.STT_PROVIDER || 'faster-whisper',
  vad = {}
} = {}) {
  const selectedSttProvider = normalizeSttProvider(sttProvider);
  const vosk = loadVosk(logger);
  const fasterWhisper = createFasterWhisperTranscriber({ logger, sampleRate });
  let model = null;
  let modelError = '';
  const socketTokens = new Map();
  const vadConfig = {
    startThreshold: Number(vad.startThreshold || process.env.VOICE_VAD_START_THRESHOLD || DEFAULT_VAD_START_THRESHOLD),
    endThreshold: Number(vad.endThreshold || process.env.VOICE_VAD_END_THRESHOLD || DEFAULT_VAD_END_THRESHOLD),
    endSilenceMs: Number(vad.endSilenceMs || process.env.VOICE_VAD_END_SILENCE_MS || DEFAULT_VAD_END_SILENCE_MS)
  };

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
    if (selectedSttProvider === 'faster-whisper') {
      const whisperStatus = fasterWhisper.status();
      return {
        ...whisperStatus,
        provider: 'pipecat-node',
        stt: 'faster-whisper',
        tts: ttsProvider(),
        sampleRate,
        vad: vadConfig
      };
    }

    if (!vosk) {
      return {
        ok: false,
        provider: 'pipecat-node',
        stt: 'vosk',
        tts: ttsProvider(),
        state: 'missing',
        sampleRate,
        vad: vadConfig,
        error: 'The vosk package is not installed or could not be loaded.'
      };
    }
    if (!modelPath) {
      return {
        ok: false,
        provider: 'pipecat-node',
        stt: 'vosk',
        tts: ttsProvider(),
        state: 'unconfigured',
        sampleRate,
        vad: vadConfig,
        error: 'VOSK_MODEL_PATH is not configured.'
      };
    }
    if (!fs.existsSync(modelPath)) {
      return {
        ok: false,
        provider: 'pipecat-node',
        stt: 'vosk',
        tts: ttsProvider(),
        state: 'model-missing',
        sampleRate,
        modelPath,
        vad: vadConfig,
        error: `Vosk model path was not found: ${modelPath}`
      };
    }
    if (modelError) {
      return {
        ok: false,
        provider: 'pipecat-node',
        stt: 'vosk',
        tts: ttsProvider(),
        state: 'error',
        sampleRate,
        modelPath,
        vad: vadConfig,
        error: modelError
      };
    }
    return {
      ok: true,
      provider: 'pipecat-node',
      stt: 'vosk',
      tts: ttsProvider(),
      state: model ? 'ready' : 'configured',
      sampleRate,
      modelPath,
      vad: vadConfig
    };
  }

  function getModel() {
    if (model) return model;
    const current = status();
    if (!current.ok && current.state !== 'configured') {
      throw new Error(current.error || 'Voice pipeline STT is not configured.');
    }
    try {
      vosk.setLogLevel?.(-1);
      model = new vosk.Model(modelPath);
      modelError = '';
      logger?.info?.(`Loaded voice pipeline Vosk model from ${modelPath}`);
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

  function newRecognizer() {
    return new vosk.Recognizer({ model: getModel(), sampleRate });
  }

  function assertSttReady() {
    const current = status();
    if (!current.ok && current.state !== 'configured') {
      throw new Error(current.error || 'Voice pipeline STT is not configured.');
    }
  }

  function sendPipelineDiagnostic(ws, vadState, extra = {}) {
    const now = Date.now();
    send(ws, {
      type: 'diagnostic',
      area: 'voice-pipeline',
      pressure: Boolean(extra.pressure || vadState.maxGapMs > 250),
      vad: {
        speaking: vadState.speaking,
        chunks: vadState.chunks,
        turnChunks: vadState.turnChunks,
        maxGapMs: vadState.maxGapMs,
        maxRms: Number(vadState.maxRms.toFixed(6)),
        maxPeak: Number(vadState.maxPeak.toFixed(6))
      },
      ...extra
    });
    vadState.lastDiagnosticAt = now;
    vadState.maxGapMs = 0;
    vadState.maxRms = 0;
    vadState.maxPeak = 0;
  }

  async function finishTurn({ ws, req, user, recognizer, text, reason, sttResult, stageOptions = DEFAULT_STAGE_OPTIONS }) {
    const transcript = sanitizePipelineTranscript(text);
    if (!transcript) {
      send(ws, { type: 'turn-empty', reason });
      return;
    }

    send(ws, { type: 'transcript', text: transcript, final: true, reason, stt: selectedSttProvider, result: sttResult || null });
    if (!stageOptions.llm) {
      send(ws, { type: 'stage-skipped', stage: 'llm', reason: 'disabled', text: transcript });
      return;
    }
    if (typeof runTurn !== 'function' || typeof defaultModel !== 'function') return;

    try {
      send(ws, { type: 'llm-start', text: transcript });
      const voiceReq = Object.create(req || {});
      voiceReq.user = user || req?.user || {};
      voiceReq.ai = { ...(req?.ai || {}), originalPrompt: transcript };
      const model = await defaultModel();
      const result = await runTurn({
        req: voiceReq,
        prompt: transcript,
        requestedModel: model,
        includeDiagnostics: false,
        persist: true,
        deferEmotion: true
      });
      const responseText = String(result?.response || '').trim();
      send(ws, { type: 'assistant-text', text: responseText, metadata: result?.metadata || {} });

      if (responseText && !stageOptions.tts) {
        send(ws, { type: 'stage-skipped', stage: 'tts', reason: 'disabled', text: responseText });
      } else if (responseText && typeof synthesizeSpeech === 'function') {
        send(ws, { type: 'tts-start', provider: ttsProvider(), text: responseText });
        const speech = await synthesizeSpeech(responseText, 'en', ttsProvider(), {});
        const audio = Buffer.isBuffer(speech.audio) ? speech.audio : Buffer.from(speech.audio || []);
        send(ws, {
          type: 'audio',
          provider: speech.provider || ttsProvider(),
          contentType: speech.contentType || 'audio/wav',
          audioBase64: audio.toString('base64'),
          text: responseText
        });
      }
      send(ws, { type: 'turn-complete', text: transcript });
    } catch (err) {
      send(ws, { type: 'error', stage: 'pipeline-turn', error: err?.message || 'Voice pipeline turn failed' });
      logger?.error?.('voice pipeline turn failed', err?.message || err);
    } finally {
      try { recognizer?.free?.(); } catch (err) {}
    }
  }

  async function handleConnection(ws, req) {
    const url = new URL(req.url || '/', 'http://localhost');
    let user = consumeSocketToken(url.searchParams.get('token'));
    if (!user) {
      const auth = await security.authenticateWebSocketRequest(req);
      if (!auth.ok) {
        send(ws, { type: 'error', error: auth.error || 'Authentication required' });
        ws.close(1008, auth.error || 'Authentication required');
        return;
      }
      user = auth.user;
    }

    let recognizer = null;
    let turnAudioChunks = [];
    let stageOptions = normalizeStageOptions();
    let vadState = createVadState();
    let sttTurnQueue = Promise.resolve();
    try {
      if (selectedSttProvider === 'vosk') recognizer = newRecognizer();
      else assertSttReady();
    } catch (err) {
      const current = status();
      send(ws, { type: 'unavailable', ...current, error: current.error || err?.message || 'Voice pipeline unavailable' });
      ws.close(1011, 'Voice pipeline unavailable');
      return;
    }

    send(ws, { type: 'ready', provider: 'pipecat-node', stt: selectedSttProvider, sampleRate, vad: vadConfig });
    function takeTurnForTranscription() {
      const chunks = turnAudioChunks;
      const finishedRecognizer = recognizer;
      turnAudioChunks = [];
      vadState = createVadState();
      if (selectedSttProvider === 'vosk') recognizer = newRecognizer();
      return { chunks, finishedRecognizer };
    }

    function reportPipelineError(err, stage = 'voice-pipeline') {
      const message = err?.message || 'Voice pipeline failed';
      send(ws, { type: 'error', stage, error: message });
      logger?.error?.(`${stage} failed`, err?.stack || err);
    }

    function enqueueTurnForProcessing({ chunks, finishedRecognizer, reason, stageOptionsSnapshot }) {
      sttTurnQueue = sttTurnQueue
        .catch(() => {})
        .then(async () => {
          try {
            const result = await transcribeTurn({ ws, recognizer: finishedRecognizer, chunks, reason });
            const text = String(result.text || '').trim();
            await finishTurn({
              ws,
              req,
              user,
              recognizer: finishedRecognizer,
              text,
              reason,
              sttResult: result.result,
              stageOptions: stageOptionsSnapshot
            });
          } catch (err) {
            try { finishedRecognizer?.free?.(); } catch (freeErr) {}
            reportPipelineError(err, 'stt');
          }
        });
    }

    ws.on('message', (data, isBinary) => {
      try {
      if (!isBinary) {
        const msg = safeJsonParse(data);
        if (msg.type === 'configure') {
          stageOptions = normalizeStageOptions(msg.options || {});
          send(ws, { type: 'stage-options', options: stageOptions });
        }
        if (msg.type === 'stop') ws.close(1000, 'client stopped');
        if (msg.type === 'flush') {
          if (!stageOptions.stt) {
            send(ws, { type: 'stage-skipped', stage: 'stt', reason: 'disabled', bytes: Buffer.concat(turnAudioChunks).length });
            turnAudioChunks = [];
            vadState = createVadState();
            return;
          }
          const { chunks, finishedRecognizer } = takeTurnForTranscription();
          enqueueTurnForProcessing({
            chunks,
            finishedRecognizer,
            reason: 'client-flush',
            stageOptionsSnapshot: { ...stageOptions }
          });
        }
        return;
      }

      const now = Date.now();
      const levels = pcm16Levels(data);
      const gapMs = vadState.lastChunkAt ? now - vadState.lastChunkAt : 0;
      vadState.lastChunkAt = now;
      vadState.chunks += 1;
      vadState.maxGapMs = Math.max(vadState.maxGapMs, gapMs);
      vadState.maxRms = Math.max(vadState.maxRms, levels.rms);
      vadState.maxPeak = Math.max(vadState.maxPeak, levels.peak);

      if (!stageOptions.vad) {
        if (now - vadState.lastDiagnosticAt >= 1000 || gapMs > 250) {
          sendPipelineDiagnostic(ws, vadState, {
            level: Number(levels.rms.toFixed(6)),
            peak: Number(levels.peak.toFixed(6)),
            stage: 'vad',
            disabled: true
          });
        }
        return;
      }

      if (!vadState.speaking && levels.rms >= vadConfig.startThreshold) {
        vadState.speaking = true;
        vadState.startedAt = now;
        vadState.lastSpeechAt = now;
        vadState.turnChunks = 0;
        send(ws, { type: 'vad-start', rms: levels.rms, peak: levels.peak });
      }

      if (vadState.speaking) {
        vadState.turnChunks += 1;
        turnAudioChunks.push(Buffer.from(data));
        if (stageOptions.stt && selectedSttProvider === 'vosk' && recognizer) {
          recognizer.acceptWaveform(data);
          const partial = safeJsonParse(recognizer.partialResult());
          const partialText = String(partial.partial || '').trim();
          if (partialText) send(ws, { type: 'transcript', text: partialText, final: false, stt: selectedSttProvider });
        }

        if (levels.rms >= vadConfig.endThreshold) {
          vadState.lastSpeechAt = now;
        } else if (now - vadState.lastSpeechAt >= vadConfig.endSilenceMs) {
          send(ws, { type: 'vad-end', silenceMs: now - vadState.lastSpeechAt, chunks: vadState.turnChunks });
          if (!stageOptions.stt) {
            send(ws, { type: 'stage-skipped', stage: 'stt', reason: 'disabled', bytes: Buffer.concat(turnAudioChunks).length });
            turnAudioChunks = [];
            vadState = createVadState();
            return;
          }
          const { chunks, finishedRecognizer } = takeTurnForTranscription();
          enqueueTurnForProcessing({
            chunks,
            finishedRecognizer,
            reason: 'vad-end',
            stageOptionsSnapshot: { ...stageOptions }
          });
        }
      }

      if (now - vadState.lastDiagnosticAt >= 1000 || gapMs > 250) {
        sendPipelineDiagnostic(ws, vadState, { level: Number(levels.rms.toFixed(6)), peak: Number(levels.peak.toFixed(6)) });
      }
      } catch (err) {
        reportPipelineError(err);
      }
    });

    ws.on('close', () => {
      try { recognizer?.free?.(); } catch (err) {}
      recognizer = null;
    });
  }

  async function transcribeTurn({ ws, recognizer, chunks, reason }) {
    if (selectedSttProvider === 'vosk') {
      const result = safeJsonParse(recognizer?.result?.());
      return { text: sanitizePipelineTranscript(result.text), result };
    }

    const audio = Buffer.concat(chunks || []);
    send(ws, { type: 'stt-start', provider: selectedSttProvider, reason, bytes: audio.length });
    const startedAt = Date.now();
    const result = await fasterWhisper.transcribePcm(audio);
    send(ws, {
      type: 'stt-complete',
      provider: selectedSttProvider,
      durationMs: Date.now() - startedAt,
      text: result.text || ''
    });
    return { text: sanitizePipelineTranscript(result.text), result };
  }

  function attach(server) {
    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname !== '/api/voice/pipeline') return;
      wss.handleUpgrade(req, socket, head, ws => {
        wss.emit('connection', ws, req);
      });
    });
    wss.on('connection', handleConnection);
    return wss;
  }

  return { attach, status, createSocketToken, vadConfig };
}

module.exports = {
  createVoicePipeline,
  pcm16Levels,
  createVadState,
  normalizeSttProvider,
  normalizeStageOptions,
  sanitizePipelineTranscript,
  isLikelyInternalSttTranscript
};
