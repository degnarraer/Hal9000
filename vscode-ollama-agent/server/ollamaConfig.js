const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', '.ollama-config.json');
const DEFAULT_CONFIG = {
  defaultModel: process.env.OLLAMA_MODEL || '',
  keepAlive: process.env.OLLAMA_KEEP_ALIVE || '5m',
  activeKeepAlive: process.env.OLLAMA_ACTIVE_KEEP_ALIVE || '-1',
  idleUnloadDelayMs: Number(process.env.OLLAMA_IDLE_UNLOAD_DELAY_MS || 30000),
  presenceTtlMs: Number(process.env.OLLAMA_PRESENCE_TTL_MS || 45000)
};

function cleanKeepAlive(value, fallback = DEFAULT_CONFIG.keepAlive) {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  if (text === '-1' || text === '0') return text;
  if (/^\d+(ms|s|m|h)$/i.test(text)) return text.toLowerCase();
  return fallback;
}

function ollamaKeepAlivePayload(value) {
  const text = cleanKeepAlive(value);
  if (text === '-1') return -1;
  if (text === '0') return 0;
  return text;
}

function normalizeOllamaConfig(input = {}) {
  return {
    defaultModel: cleanModelName(input.defaultModel ?? input.default_model, DEFAULT_CONFIG.defaultModel),
    keepAlive: cleanKeepAlive(input.keepAlive ?? input.keep_alive, DEFAULT_CONFIG.keepAlive),
    activeKeepAlive: cleanKeepAlive(input.activeKeepAlive ?? input.active_keep_alive, DEFAULT_CONFIG.activeKeepAlive),
    idleUnloadDelayMs: cleanPositiveMs(input.idleUnloadDelayMs ?? input.idle_unload_delay_ms, DEFAULT_CONFIG.idleUnloadDelayMs),
    presenceTtlMs: cleanPositiveMs(input.presenceTtlMs ?? input.presence_ttl_ms, DEFAULT_CONFIG.presenceTtlMs)
  };
}

function cleanModelName(value, fallback = DEFAULT_CONFIG.defaultModel) {
  const text = String(value ?? '').trim();
  if (text.toUpperCase() === 'AUTO') return fallback;
  return text || fallback;
}

function cleanPositiveMs(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1000) return fallback;
  return Math.round(number);
}

function createOllamaConfigStore(logger, options = {}) {
  const configPath = options.configPath || process.env.OLLAMA_CONFIG_PATH || DEFAULT_CONFIG_PATH;
  let current = load();

  function load() {
    try {
      if (!fs.existsSync(configPath)) return { ...DEFAULT_CONFIG };
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return normalizeOllamaConfig({ ...DEFAULT_CONFIG, ...parsed });
    } catch (err) {
      logger?.warn?.('Ollama config load failed', err?.message || err);
      return { ...DEFAULT_CONFIG };
    }
  }

  function save(next) {
    current = normalizeOllamaConfig({ ...current, ...next });
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    return current;
  }

  return {
    current: () => ({ ...current }),
    save,
    normalize: normalizeOllamaConfig,
    configPath
  };
}

module.exports = {
  cleanKeepAlive,
  createOllamaConfigStore,
  normalizeOllamaConfig,
  ollamaKeepAlivePayload
};
