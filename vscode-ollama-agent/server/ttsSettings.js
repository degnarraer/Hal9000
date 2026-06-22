const fs = require('fs');
const path = require('path');
const { getTtsProvider, resolveTtsProvider } = require('./tts');

const DEFAULT_SETTINGS_PATH = path.join(__dirname, '..', 'tts.config.json');

function clean(value) {
  const cleaned = String(value || '').trim();
  return cleaned.toLowerCase() === 'default' ? '' : cleaned;
}

function defaultsFromEnv(env = process.env) {
  return {
    provider: getTtsProvider(env),
    lang: clean(env.TTS_LANG) || 'en',
    piperSpeaker: clean(env.TTS_PIPER_SPEAKER || env.PIPER_SPEAKER),
    piperLengthScale: clean(env.TTS_PIPER_LENGTH_SCALE),
    piperNoiseScale: clean(env.TTS_PIPER_NOISE_SCALE),
    piperNoiseW: clean(env.TTS_PIPER_NOISE_W)
  };
}

function sanitizeSettings(input = {}, env = process.env) {
  const fallback = defaultsFromEnv(env);
  return {
    provider: resolveTtsProvider(clean(input.provider), fallback.provider),
    lang: clean(input.lang) || fallback.lang || 'en',
    piperSpeaker: clean(input.piperSpeaker ?? input.speaker ?? fallback.piperSpeaker),
    piperLengthScale: clean(input.piperLengthScale ?? input.lengthScale ?? fallback.piperLengthScale),
    piperNoiseScale: clean(input.piperNoiseScale ?? input.noiseScale ?? fallback.piperNoiseScale),
    piperNoiseW: clean(input.piperNoiseW ?? input.noiseW ?? fallback.piperNoiseW)
  };
}

function createTtsSettingsStore(logger, options = {}) {
  const settingsPath = options.settingsPath || process.env.TTS_CONFIG_PATH || DEFAULT_SETTINGS_PATH;
  let settings = defaultsFromEnv();

  function load() {
    try {
      if (!fs.existsSync(settingsPath)) return settings;
      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      settings = sanitizeSettings(parsed);
      return settings;
    } catch (err) {
      logger?.warn?.('TTS settings load failed', err?.message || err);
      settings = defaultsFromEnv();
      return settings;
    }
  }

  function save(nextSettings) {
    settings = sanitizeSettings(nextSettings);
    fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    return settings;
  }

  function current() {
    return settings;
  }

  load();
  return { current, load, save, settingsPath };
}

module.exports = {
  createTtsSettingsStore,
  defaultsFromEnv,
  sanitizeSettings
};
