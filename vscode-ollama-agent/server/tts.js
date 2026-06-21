const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_TTS_PROVIDER = 'google';
const SUPPORTED_TTS_PROVIDERS = new Set(['google', 'piper']);

function getTtsProvider(env = process.env) {
  const provider = String(env.TTS_PROVIDER || DEFAULT_TTS_PROVIDER).trim().toLowerCase();
  return SUPPORTED_TTS_PROVIDERS.has(provider) ? provider : DEFAULT_TTS_PROVIDER;
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
  if (!model) throw new Error('TTS_PIPER_MODEL is required when TTS_PROVIDER=piper');

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
  piperArgsForOutput,
  splitTextForTts,
  synthesizePiperSpeech
};
