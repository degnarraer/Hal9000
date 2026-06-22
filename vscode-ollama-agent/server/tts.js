const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_TTS_PROVIDER = 'piper';
const SUPPORTED_TTS_PROVIDERS = new Set(['piper']);

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
    hasModel: Boolean(model),
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

function runCommandWithText({ bin, args, text, outPath, timeoutMs = 60000 }) {
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

      fs.readFile(outPath, (err, audio) => {
        fs.unlink(outPath, () => {});
        if (err) reject(err);
        else resolve(audio);
      });
    });

    child.stdin.end(`${text}\n`);
  });
}

async function synthesizePiperSpeech(text, env = process.env) {
  const outPath = tempAudioPath('wav');
  const bin = env.TTS_PIPER_BIN || env.PIPER_BIN || 'piper';
  const args = piperArgsForOutput(outPath, env);
  const audio = await runCommandWithText({
    bin,
    args,
    text,
    outPath,
    timeoutMs: Number(env.TTS_TIMEOUT_MS || 60000)
  });

  return { audio, contentType: 'audio/wav', provider: 'piper' };
}

module.exports = {
  getTtsProvider,
  getSupportedTtsProviders,
  getPiperConfigDetails,
  getPiperRuntimeStatus,
  resolveTtsProvider,
  buildPiperEnv,
  piperArgsForOutput,
  splitTextForTts,
  synthesizePiperSpeech
};
