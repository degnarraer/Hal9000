const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS_PATH = path.join(__dirname, '..', '.mic-settings.json');
const PROVIDERS = new Set(['pipeline', 'auto', 'server', 'browser']);
const DEFAULT_SETTINGS = {
  transcriptionProvider: process.env.MIC_TRANSCRIPTION_PROVIDER || 'pipeline'
};

function cleanProvider(value, fallback = DEFAULT_SETTINGS.transcriptionProvider) {
  const text = String(value || '').trim().toLowerCase();
  if (PROVIDERS.has(text)) return text;
  return PROVIDERS.has(fallback) ? fallback : 'pipeline';
}

function normalizeMicSettings(input = {}) {
  return {
    transcriptionProvider: cleanProvider(input.transcriptionProvider ?? input.provider)
  };
}

function createMicSettingsStore(logger, options = {}) {
  const settingsPath = options.settingsPath || process.env.MIC_SETTINGS_PATH || DEFAULT_SETTINGS_PATH;
  let current = load();

  function load() {
    try {
      if (!fs.existsSync(settingsPath)) return normalizeMicSettings(DEFAULT_SETTINGS);
      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return normalizeMicSettings({ ...DEFAULT_SETTINGS, ...parsed });
    } catch (err) {
      logger?.warn?.('Mic settings load failed', err?.message || err);
      return normalizeMicSettings(DEFAULT_SETTINGS);
    }
  }

  function save(next) {
    current = normalizeMicSettings({ ...current, ...next });
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    return { ...current };
  }

  return {
    current: () => ({ ...current }),
    save,
    normalize: normalizeMicSettings,
    settingsPath
  };
}

module.exports = {
  createMicSettingsStore,
  normalizeMicSettings
};
