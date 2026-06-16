// ollamaModels.js - Fetch available models from Ollama's official library
const axios = require('axios');

// Official Ollama models library URL
const OLLAMA_LIBRARY_URL = 'https://ollama.ai/api/tags';
const OLLAMA_MODELS_GITHUB = 'https://raw.githubusercontent.com/ollama/ollama/main/docs/api.md';

// Fallback curated list of popular models
const FALLBACK_MODELS = [
  {
    name: 'llama2',
    description: 'A general purpose large language model',
    tags: ['7b', '13b', '70b'],
    url: 'https://ollama.ai/library/llama2'
  },
  {
    name: 'llama2-uncensored',
    description: 'Uncensored Llama 2 model',
    tags: ['7b', '13b'],
    url: 'https://ollama.ai/library/llama2-uncensored'
  },
  {
    name: 'mistral',
    description: 'A high-quality small model',
    tags: ['7b'],
    url: 'https://ollama.ai/library/mistral'
  },
  {
    name: 'neural-chat',
    description: 'A fine-tuned model for chat',
    tags: ['7b'],
    url: 'https://ollama.ai/library/neural-chat'
  },
  {
    name: 'codellama',
    description: 'Code-focused Llama 2 variant',
    tags: ['7b', '13b', '34b'],
    url: 'https://ollama.ai/library/codellama'
  },
  {
    name: 'alpaca',
    description: 'A fine-tuned variant of Llama 7B',
    tags: ['7b'],
    url: 'https://ollama.ai/library/alpaca'
  },
  {
    name: 'dolphin-mixtral',
    description: 'Dolphin fine-tuned Mixtral',
    tags: ['8x7b'],
    url: 'https://ollama.ai/library/dolphin-mixtral'
  },
  {
    name: 'orca-mini',
    description: 'Small, fast model',
    tags: ['3b', '7b', '13b'],
    url: 'https://ollama.ai/library/orca-mini'
  }
];

/**
 * Fetch available models from Ollama's official library
 * Falls back to curated list if official API is unavailable
 */
async function getAvailableModels(logger) {
  try {
    logger?.info('Fetching available models from Ollama library...');
    
    // Try the official Ollama API first
    try {
      const resp = await axios.get(OLLAMA_LIBRARY_URL, { timeout: 5000 });
      if (resp.data && Array.isArray(resp.data)) {
        logger?.info(`Fetched ${resp.data.length} models from official Ollama library`);
        return resp.data;
      }
    } catch (e) {
      logger?.warn('Official Ollama API unavailable, using fallback list', e?.message);
    }

    // Fallback to curated list
    logger?.info('Using fallback curated model list');
    return FALLBACK_MODELS;
  } catch (err) {
    logger?.error('Failed to fetch available models', err?.message || err);
    return FALLBACK_MODELS;
  }
}

/**
 * Parse model name and tag (e.g., "llama2:7b" -> {name: "llama2", tag: "7b"})
 */
function parseModelRef(ref) {
  const [name, tag] = ref.split(':');
  return { name: name?.trim(), tag: tag?.trim() || 'latest' };
}

/**
 * Format model reference (e.g., {name: "llama2", tag: "7b"} -> "llama2:7b")
 */
function formatModelRef(name, tag = 'latest') {
  return tag && tag !== 'latest' ? `${name}:${tag}` : name;
}

module.exports = {
  getAvailableModels,
  parseModelRef,
  formatModelRef,
  FALLBACK_MODELS
};
