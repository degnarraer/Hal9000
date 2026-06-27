const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '.debug-settings.json');
const DEFAULT_SETTINGS = {
  showChatDebugPills: true
};

function normalizeDebugSettings(input = {}) {
  return {
    showChatDebugPills: input.showChatDebugPills !== false
  };
}

function createDebugSettingsStore(logger, options = {}) {
  const settingsPath = options.settingsPath || process.env.DEBUG_SETTINGS_PATH || CONFIG_PATH;
  let current = load();

  function load() {
    try {
      if (!fs.existsSync(settingsPath)) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return normalizeDebugSettings({ ...DEFAULT_SETTINGS, ...parsed });
    } catch (err) {
      logger?.warn?.('Debug settings load failed', err?.message || err);
      return { ...DEFAULT_SETTINGS };
    }
  }

  function save(next) {
    current = normalizeDebugSettings({ ...current, ...next });
    fs.writeFileSync(settingsPath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    return { ...current };
  }

  return {
    current: () => ({ ...current }),
    save,
    normalize: normalizeDebugSettings,
    settingsPath
  };
}

module.exports = {
  createDebugSettingsStore,
  normalizeDebugSettings
};
