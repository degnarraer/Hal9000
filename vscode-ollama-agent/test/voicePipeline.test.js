const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { createVadState, createVoicePipeline, isLikelyInternalSttTranscript, normalizeStageOptions, normalizeSttProvider, pcm16Levels, sanitizePipelineTranscript } = require('../server/voicePipeline');
const { pcm16ToWav } = require('../server/fasterWhisper');

test('voice pipeline computes PCM power for VAD', () => {
  const input = Buffer.alloc(4);
  input.writeInt16LE(16384, 0);
  input.writeInt16LE(-16384, 2);
  const levels = pcm16Levels(input);

  assert.equal(levels.sampleCount, 2);
  assert.equal(Number(levels.peak.toFixed(2)), 0.5);
  assert.equal(Number(levels.rms.toFixed(2)), 0.5);
});

test('voice pipeline exposes Pipecat-style status and token flow', () => {
  const pipeline = createVoicePipeline({
    logger: null,
    security: { authenticateWebSocketRequest: async () => ({ ok: true, user: {} }) },
    modelPath: '',
    ttsProvider: () => 'kokoro'
  });
  const status = pipeline.status();

  assert.equal(status.provider, 'pipecat-node');
  assert.equal(status.stt, 'faster-whisper');
  assert.equal(status.tts, 'kokoro');
  assert.equal(status.sampleRate, 16000);
  assert.equal(typeof status.vad.startThreshold, 'number');
  assert.equal(typeof pipeline.createSocketToken({ name: 'Rob' }), 'string');
  assert.deepEqual(createVadState(1000).speaking, false);
  assert.equal(normalizeSttProvider('vosk'), 'vosk');
  assert.equal(normalizeSttProvider('bad'), 'faster-whisper');
  assert.deepEqual(normalizeStageOptions({ stt: false, tts: 0 }), { vad: true, stt: false, llm: true, tts: false });
});

test('Faster-Whisper helper writes PCM16 WAV payloads', () => {
  const pcm = Buffer.alloc(4);
  pcm.writeInt16LE(1000, 0);
  pcm.writeInt16LE(-1000, 2);
  const wav = pcm16ToWav(pcm, 16000);

  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.toString('ascii', 36, 40), 'data');
  assert.equal(wav.readUInt32LE(40), pcm.length);
});

test('voice pipeline filters internal STT status hallucinations', () => {
  assert.equal(isLikelyInternalSttTranscript('STT'), true);
  assert.equal(isLikelyInternalSttTranscript('STT transcribing'), true);
  assert.equal(isLikelyInternalSttTranscript('complete STT'), true);
  assert.equal(sanitizePipelineTranscript(' STT complete. '), '');
  assert.equal(sanitizePipelineTranscript('what is the STT provider'), 'what is the STT provider');
});

test('server wires the voice pipeline endpoints and websocket transport', () => {
  const server = fs.readFileSync('server/index.js', 'utf8');
  const pipelineSource = fs.readFileSync('server/voicePipeline.js', 'utf8');
  const transportWorker = fs.readFileSync('public/audio/pipecat-transport-worker.js', 'utf8');
  const whisperScript = fs.readFileSync('server/faster_whisper_transcribe.py', 'utf8');

  assert.match(server, /const \{ createVoicePipeline \} = require\('\.\/voicePipeline'\)/);
  assert.match(server, /const voicePipeline = createVoicePipeline\(/);
  assert.match(server, /app\.get\('\/api\/voice\/pipeline\/status'/);
  assert.match(server, /app\.post\('\/api\/voice\/pipeline\/token'/);
  assert.match(server, /voicePipeline\.attach\(server\)/);
  assert.match(pipelineSource, /provider: 'pipecat-node'/);
  assert.match(pipelineSource, /createFasterWhisperTranscriber/);
  assert.match(pipelineSource, /sttProvider = process\.env\.VOICE_PIPELINE_STT_PROVIDER/);
  assert.match(pipelineSource, /selectedSttProvider === 'faster-whisper'/);
  assert.match(pipelineSource, /fasterWhisper\.transcribePcm/);
  assert.match(pipelineSource, /type: 'stt-start'/);
  assert.match(pipelineSource, /type: 'stt-complete'/);
  assert.match(pipelineSource, /const DEFAULT_STAGE_OPTIONS = \{/);
  assert.match(pipelineSource, /function normalizeStageOptions\(options = \{\}\)/);
  assert.match(pipelineSource, /msg\.type === 'configure'/);
  assert.match(pipelineSource, /type: 'stage-options'/);
  assert.match(pipelineSource, /type: 'stage-skipped'/);
  assert.match(pipelineSource, /if \(!stageOptions\.vad\)/);
  assert.match(pipelineSource, /if \(!stageOptions\.stt\)/);
  assert.match(pipelineSource, /if \(!stageOptions\.llm\)/);
  assert.match(pipelineSource, /if \(responseText && !stageOptions\.tts\)/);
  assert.match(pipelineSource, /type: 'vad-start'/);
  assert.match(pipelineSource, /type: 'vad-end'/);
  assert.match(pipelineSource, /type: 'transcript'/);
  assert.match(pipelineSource, /type: 'llm-start'/);
  assert.match(pipelineSource, /type: 'assistant-text'/);
  assert.match(pipelineSource, /type: 'tts-start'/);
  assert.match(pipelineSource, /type: 'audio'/);
  assert.match(pipelineSource, /area: 'voice-pipeline'/);
  assert.match(pipelineSource, /sanitizePipelineTranscript\(result\.text\)/);
  assert.match(whisperScript, /vad_filter=not args\.no_vad_filter/);
  assert.match(transportWorker, /pipecat-transport/);
  assert.match(transportWorker, /\/api\/voice\/pipeline/);
  assert.match(transportWorker, /pipelineOptions = message\.pipelineOptions/);
  assert.match(transportWorker, /type: 'configure', options: pipelineOptions/);
});
