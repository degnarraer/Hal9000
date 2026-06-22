const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '.ollama-config.json');
const DEFAULT_CONFIG = {
  keepAlive: process.env.OLLAMA_KEEP_ALIVE || '5m'
};

function cleanKeepAlive(value) {
  const text = String(value ?? '').trim();
  if (!text) return DEFAULT_CONFIG.keepAlive;
  if (text === '-1' || text === '0') return text;
  if (/^\d+(ms|s|m|h)$/i.test(text)) return text.toLowerCase();
  return DEFAULT_CONFIG.keepAlive;
}

function normalizeOllamaConfig(input = {}) {
  return {
    keepAlive: cleanKeepAlive(input.keepAlive ?? input.keep_alive)
  };
}

function createOllamaConfigStore(logger) {
  let current = load();

  function load() {
    try {
      if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return normalizeOllamaConfig({ ...DEFAULT_CONFIG, ...parsed });
    } catch (err) {
      logger?.warn?.('Ollama config load failed', err?.message || err);
      return { ...DEFAULT_CONFIG };
    }
  }

  function save(next) {
    current = normalizeOllamaConfig({ ...current, ...next });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2), 'utf8');
    return current;
  }

  return {
    current: () => ({ ...current }),
    save,
    normalize: normalizeOllamaConfig
  };
}

module.exports = {
  cleanKeepAlive,
  createOllamaConfigStore,
  normalizeOllamaConfig
};
