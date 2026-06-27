const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_TTS_PROVIDER = 'kokoro';
const SUPPORTED_TTS_PROVIDERS = new Set(['piper', 'kokoro']);

function getTtsProvider(env = process.env) {
  const provider = String(env.TTS_PROVIDER || DEFAULT_TTS_PROVIDER).trim().toLowerCase();
  return SUPPORTED_TTS_PROVIDERS.has(provider) ? provider : DEFAULT_TTS_PROVIDER;
}

function getSupportedTtsProviders() {
  return Array.from(SUPPORTED_TTS_PROVIDERS);
}

function resolveTtsProvider(value, fallback = getTtsProvider()) {
  const provider = String(value || fallback || DEFAULT_TTS_PROVIDER).trim().toLowerCase();
  return SUPPORTED_TTS_PROVIDERS.has(provider) ? provider : fallback;
}

function tempAudioPath(extension = 'wav') {
  const safeExtension = String(extension || 'wav').replace(/[^a-z0-9]/gi, '') || 'wav';
  return path.join(os.tmpdir(), `ollama-agent-tts-${Date.now()}-${Math.random().toString(16).slice(2)}.${safeExtension}`);
}

function splitTextForTts(text, maxLength = 200) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxLength) return [clean];

  const chunks = [];
  let remaining = clean;

  while (remaining.length > maxLength) {
    const sentenceEnd = Math.max(
      remaining.lastIndexOf('. ', maxLength),
      remaining.lastIndexOf('! ', maxLength),
      remaining.lastIndexOf('? ', maxLength)
    );
    const wordEnd = remaining.lastIndexOf(' ', maxLength);
    const cut = sentenceEnd > 0 ? sentenceEnd + 1 : wordEnd > 0 ? wordEnd : maxLength;

    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

function piperArgsForOutput(outPath, env = process.env) {
  const model = env.TTS_PIPER_MODEL || env.PIPER_MODEL;
  if (!model) throw new Error('TTS_PIPER_MODEL is required for text-to-speech');

  const args = ['--model', model, '--output_file', outPath];
  const config = env.TTS_PIPER_CONFIG || env.PIPER_CONFIG;
  const speaker = env.TTS_PIPER_SPEAKER || env.PIPER_SPEAKER;

  if (config) args.push('--config', config);
  if (speaker) args.push('--speaker', speaker);
  if (env.TTS_PIPER_LENGTH_SCALE) args.push('--length_scale', env.TTS_PIPER_LENGTH_SCALE);
  if (env.TTS_PIPER_NOISE_SCALE) args.push('--noise_scale', env.TTS_PIPER_NOISE_SCALE);
  if (env.TTS_PIPER_NOISE_W) args.push('--noise_w', env.TTS_PIPER_NOISE_W);

  return args;
}

function splitCommandArgs(value = '') {
  return String(value || '')
    .match(/"[^"]*"|'[^']*'|\S+/g)
    ?.map(part => part.replace(/^['"]|['"]$/g, '')) || [];
}

function kokoroArgsForOutput(outPath, env = process.env) {
  const configured = splitCommandArgs(env.TTS_KOKORO_ARGS || '');
  const args = configured.length ? configured : ['--output', outPath];
  return args.map(arg => String(arg)
    .replaceAll('{out}', outPath)
    .replaceAll('{output}', outPath)
    .replaceAll('{voice}', env.TTS_KOKORO_VOICE || '')
    .replaceAll('{lang}', env.TTS_LANG || 'en'));
}

function getKokoroRuntimeStatus(env = process.env) {
  const bin = env.TTS_KOKORO_BIN || env.KOKORO_BIN || 'kokoro';
  return {
    provider: 'kokoro',
    bin,
    args: kokoroArgsForOutput('{out}', env),
    voice: env.TTS_KOKORO_VOICE || '',
    hasBin: Boolean(bin),
    binExists: Boolean(bin && fs.existsSync(bin))
  };
}

function getPiperConfigPath(env = process.env) {
  const explicitConfig = env.TTS_PIPER_CONFIG || env.PIPER_CONFIG;
  if (explicitConfig) return explicitConfig;

  const model = env.TTS_PIPER_MODEL || env.PIPER_MODEL;
  return model ? `${model}.json` : '';
}

function getPiperRuntimeStatus(env = process.env) {
  const model = env.TTS_PIPER_MODEL || env.PIPER_MODEL || '';
  const config = getPiperConfigPath(env);
  const bin = env.TTS_PIPER_BIN || env.PIPER_BIN || 'piper';
  return {
    provider: 'piper',
    bin,
    model,
    config,
    hasBin: Boolean(bin),
    binExists: Boolean(bin && fs.existsSync(bin)),
    hasModel: Boolean(model),
    modelExists: Boolean(model && fs.existsSync(model)),
    hasConfig: Boolean(config),
    configLoaded: Boolean(config && fs.existsSync(config))
  };
}

function readPiperConfig(env = process.env) {
  const configPath = getPiperConfigPath(env);
  if (!configPath || !fs.existsSync(configPath)) return null;
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function piperSpeakerOptionsFromConfig(config) {
  const speakerIdMap = config?.speaker_id_map;
  if (speakerIdMap && typeof speakerIdMap === 'object') {
    return Object.entries(speakerIdMap)
      .map(([label, value]) => ({ label, value: String(value) }))
      .sort((a, b) => Number(a.value) - Number(b.value) || a.label.localeCompare(b.label));
  }

  const count = Number(config?.num_speakers || config?.audio?.num_speakers || 0);
  if (!Number.isFinite(count) || count <= 1) return [];
  return Array.from({ length: count }, (_, index) => ({ label: `Speaker ${index}`, value: String(index) }));
}

function getPiperConfigDetails(env = process.env) {
  try {
    const configPath = getPiperConfigPath(env);
    const config = readPiperConfig(env);
    return {
      path: configPath,
      loaded: Boolean(config),
      speakers: piperSpeakerOptionsFromConfig(config),
      lengthScale: ['0.75', '0.85', '0.9', '1', '1.05', '1.1', '1.2', '1.35'],
      noiseScale: ['0.35', '0.45', '0.55', '0.667', '0.75', '0.85', '1'],
      noiseW: ['0.4', '0.6', '0.8', '1', '1.2']
    };
  } catch (err) {
    return {
      path: getPiperConfigPath(env),
      loaded: false,
      error: err?.message || String(err),
      speakers: [],
      lengthScale: ['0.75', '0.85', '0.9', '1', '1.05', '1.1', '1.2', '1.35'],
      noiseScale: ['0.35', '0.45', '0.55', '0.667', '0.75', '0.85', '1'],
      noiseW: ['0.4', '0.6', '0.8', '1', '1.2']
    };
  }
}

function buildPiperEnv(overrides = {}, env = process.env) {
  const merged = { ...env };
  if (overrides.speaker !== undefined && overrides.speaker !== '') merged.TTS_PIPER_SPEAKER = String(overrides.speaker);
  if (overrides.lengthScale !== undefined && overrides.lengthScale !== '') merged.TTS_PIPER_LENGTH_SCALE = String(overrides.lengthScale);
  if (overrides.noiseScale !== undefined && overrides.noiseScale !== '') merged.TTS_PIPER_NOISE_SCALE = String(overrides.noiseScale);
  if (overrides.noiseW !== undefined && overrides.noiseW !== '') merged.TTS_PIPER_NOISE_W = String(overrides.noiseW);
  return merged;
}

function runCommandWithText({ bin, args, text, outPath, timeoutMs = 60000, keepFile = false }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe']
    });

    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new Error(`${bin} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (code !== 0) {
        reject(new Error(stderr.trim() || `${bin} exited with ${code}`));
        return;
      }

      if (keepFile) {
        resolve(outPath);
        return;
      }

      fs.readFile(outPath, (err, audio) => {
        fs.unlink(outPath, () => {});
        if (err) reject(err);
        else resolve(audio);
      });
    });

    child.stdin.end(`${text}\n`);
  });
}

function runPiperToFile({ text, outPath, env = process.env, keepFile = false }) {
  const bin = env.TTS_PIPER_BIN || env.PIPER_BIN || 'piper';
  const args = piperArgsForOutput(outPath, env);
  return runCommandWithText({
    bin,
    args,
    text,
    outPath,
    timeoutMs: Number(env.TTS_TIMEOUT_MS || 60000),
    keepFile
  });
}

async function synthesizePiperSpeech(text, env = process.env) {
  const outPath = tempAudioPath('wav');
  const audio = await runPiperToFile({ text, outPath, env });

  return { audio, contentType: 'audio/wav', provider: 'piper' };
}

async function synthesizePiperSpeechFile(text, env = process.env) {
  const outPath = tempAudioPath('wav');
  await runPiperToFile({ text, outPath, env, keepFile: true });
  return { path: outPath, contentType: 'audio/wav', provider: 'piper' };
}

function runKokoroToFile({ text, outPath, env = process.env, keepFile = false }) {
  const bin = env.TTS_KOKORO_BIN || env.KOKORO_BIN || 'kokoro';
  const args = kokoroArgsForOutput(outPath, env);
  return runCommandWithText({
    bin,
    args,
    text,
    outPath,
    timeoutMs: Number(env.TTS_TIMEOUT_MS || env.TTS_KOKORO_TIMEOUT_MS || 60000),
    keepFile
  });
}

async function synthesizeKokoroSpeech(text, env = process.env) {
  const outPath = tempAudioPath('wav');
  const audio = await runKokoroToFile({ text, outPath, env });
  return { audio, contentType: 'audio/wav', provider: 'kokoro' };
}

async function synthesizeKokoroSpeechFile(text, env = process.env) {
  const outPath = tempAudioPath('wav');
  await runKokoroToFile({ text, outPath, env, keepFile: true });
  return { path: outPath, contentType: 'audio/wav', provider: 'kokoro' };
}

function getRhubarbRuntimeStatus(env = process.env) {
  const bin = env.TTS_RHUBARB_BIN || env.RHUBARB_BIN || '';
  return {
    provider: 'rhubarb',
    bin,
    configured: Boolean(bin),
    binExists: Boolean(bin && fs.existsSync(bin))
  };
}

function normalizeRhubarbCue(cue = {}) {
  const value = String(cue.value || '').trim().toUpperCase();
  const start = Number(cue.start);
  const end = Number(cue.end);
  if (!/^[A-HX]$/.test(value) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return {
    start: Math.max(0, start),
    end: Math.max(0, end),
    value: value === 'X' ? 'H' : value
  };
}

function parseRhubarbVisemes(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  const cues = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.mouthCues)
      ? parsed.mouthCues
      : [];
  return cues.map(normalizeRhubarbCue).filter(Boolean);
}

function generateRhubarbVisemes(audioPath, env = process.env) {
  const bin = env.TTS_RHUBARB_BIN || env.RHUBARB_BIN;
  if (!bin) {
    const err = new Error('Rhubarb is not configured. Set TTS_RHUBARB_BIN or RHUBARB_BIN.');
    err.code = 'RHUBARB_NOT_CONFIGURED';
    throw err;
  }

  const outPath = tempAudioPath('json');
  const timeoutMs = Number(env.TTS_RHUBARB_TIMEOUT_MS || 30000);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-f', 'json', '-o', outPath, audioPath], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      child.kill();
      fs.unlink(outPath, () => {});
      reject(new Error(`${bin} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fs.unlink(outPath, () => {});
      reject(err);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        fs.unlink(outPath, () => {});
        reject(new Error(stderr.trim() || `${bin} exited with ${code}`));
        return;
      }

      fs.readFile(outPath, 'utf8', (err, json) => {
        fs.unlink(outPath, () => {});
        if (err) reject(err);
        else {
          try {
            resolve(parseRhubarbVisemes(json));
          } catch (parseErr) {
            reject(parseErr);
          }
        }
      });
    });
  });
}

module.exports = {
  getTtsProvider,
  getSupportedTtsProviders,
  getPiperConfigDetails,
  getPiperRuntimeStatus,
  getKokoroRuntimeStatus,
  getRhubarbRuntimeStatus,
  resolveTtsProvider,
  buildPiperEnv,
  generateRhubarbVisemes,
  parseRhubarbVisemes,
  piperArgsForOutput,
  kokoroArgsForOutput,
  splitTextForTts,
  synthesizePiperSpeech,
  synthesizePiperSpeechFile,
  synthesizeKokoroSpeech,
  synthesizeKokoroSpeechFile
};
