const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const DEFAULT_MODEL = process.env.FASTER_WHISPER_MODEL || process.env.WHISPER_MODEL || 'base.en';
const DEFAULT_DEVICE = process.env.FASTER_WHISPER_DEVICE || 'cpu';
const DEFAULT_COMPUTE_TYPE = process.env.FASTER_WHISPER_COMPUTE_TYPE || 'int8';
const DEFAULT_TIMEOUT_MS = Number(process.env.FASTER_WHISPER_TIMEOUT_MS || 120000);
const DEFAULT_PYTHON = process.env.FASTER_WHISPER_PYTHON || process.env.PYTHON || 'python3';
const TRANSCRIBE_SCRIPT = path.join(__dirname, 'faster_whisper_transcribe.py');

function pcm16ToWav(pcm, sampleRate = 16000) {
  const input = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm || []);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + input.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(input.length, 40);
  return Buffer.concat([header, input]);
}

function safeJsonParse(value) {
  try {
    return JSON.parse(String(value || '{}'));
  } catch (err) {
    return {};
  }
}

function createFasterWhisperTranscriber({
  logger,
  sampleRate = 16000,
  model = DEFAULT_MODEL,
  python = DEFAULT_PYTHON,
  device = DEFAULT_DEVICE,
  computeType = DEFAULT_COMPUTE_TYPE,
  language = process.env.FASTER_WHISPER_LANGUAGE || 'en',
  downloadRoot = process.env.FASTER_WHISPER_CACHE_DIR || process.env.WHISPER_CACHE_DIR || '',
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  let availability;

  function checkAvailability() {
    if (availability) return availability;
    if (!fs.existsSync(TRANSCRIBE_SCRIPT)) {
      availability = {
        ok: false,
        state: 'script-missing',
        error: `Faster-Whisper transcribe script was not found: ${TRANSCRIBE_SCRIPT}`
      };
      return availability;
    }

    const result = spawnSync(python, [TRANSCRIBE_SCRIPT, '--check'], {
      encoding: 'utf8',
      timeout: 15000
    });
    if (result.status === 0) {
      availability = { ok: true, state: 'configured' };
      return availability;
    }

    availability = {
      ok: false,
      state: 'missing',
      error: (result.stderr || result.stdout || `Unable to load faster-whisper with ${python}`).trim()
    };
    logger?.warn?.(`Faster-Whisper unavailable: ${availability.error}`);
    return availability;
  }

  function status() {
    const current = checkAvailability();
    return {
      ok: current.ok,
      provider: 'faster-whisper',
      state: current.ok ? 'configured' : current.state,
      sampleRate,
      model,
      python,
      device,
      computeType,
      language,
      downloadRoot: downloadRoot || null,
      error: current.error
    };
  }

  async function transcribePcm(pcm) {
    const current = checkAvailability();
    if (!current.ok) throw new Error(current.error || 'Faster-Whisper is not available.');
    const input = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm || []);
    if (!input.length) return { text: '', segments: [] };

    const tempPath = path.join(os.tmpdir(), `bob-whisper-${crypto.randomUUID()}.wav`);
    await fsp.writeFile(tempPath, pcm16ToWav(input, sampleRate));

    const args = [
      TRANSCRIBE_SCRIPT,
      '--input', tempPath,
      '--model', model,
      '--device', device,
      '--compute-type', computeType
    ];
    if (language) args.push('--language', language);
    if (downloadRoot) args.push('--download-root', downloadRoot);

    try {
      const output = await new Promise((resolve, reject) => {
        const child = spawn(python, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`Faster-Whisper timed out after ${timeoutMs} ms`));
        }, timeoutMs);
        child.stdout.on('data', chunk => { stdout += chunk.toString(); });
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });
        child.on('error', err => {
          clearTimeout(timer);
          reject(err);
        });
        child.on('close', code => {
          clearTimeout(timer);
          if (code === 0) resolve(stdout);
          else reject(new Error((stderr || stdout || `Faster-Whisper exited with code ${code}`).trim()));
        });
      });
      const parsed = safeJsonParse(output);
      return {
        text: String(parsed.text || '').trim(),
        segments: Array.isArray(parsed.segments) ? parsed.segments : [],
        language: parsed.language || language || null,
        duration: parsed.duration || null
      };
    } finally {
      fsp.unlink(tempPath).catch(() => {});
    }
  }

  return { status, transcribePcm };
}

module.exports = {
  createFasterWhisperTranscriber,
  pcm16ToWav
};
