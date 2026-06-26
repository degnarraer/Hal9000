// ollamaModels.js - Fetch available models from Ollama's official library
const axios = require('axios');

// Official Ollama model catalog URL
const OLLAMA_SEARCH_URL = 'https://ollama.com/search';

// Fallback curated list of popular models. Keep this useful when the official
// library page is unreachable or its markup changes.
const FALLBACK_MODELS = [
  {
    name: 'llama3.2',
    description: "Meta's compact Llama 3.2 models for everyday local chat",
    tags: ['1b', '3b'],
    url: 'https://ollama.com/library/llama3.2'
  },
  {
    name: 'llama3.1',
    description: 'Meta Llama 3.1 instruction models',
    tags: ['8b', '70b', '405b'],
    url: 'https://ollama.com/library/llama3.1'
  },
  {
    name: 'llama3',
    description: 'Meta Llama 3 instruction models',
    tags: ['8b', '70b'],
    url: 'https://ollama.com/library/llama3'
  },
  {
    name: 'llama3.3',
    description: 'Meta Llama 3.3 70B instruction model',
    tags: ['70b'],
    url: 'https://ollama.com/library/llama3.3'
  },
  {
    name: 'llama2',
    description: 'A general purpose large language model',
    tags: ['7b', '13b', '70b'],
    url: 'https://ollama.com/library/llama2'
  },
  {
    name: 'llama2-uncensored',
    description: 'Uncensored Llama 2 model',
    tags: ['7b', '70b'],
    url: 'https://ollama.com/library/llama2-uncensored'
  },
  {
    name: 'deepseek-r1',
    description: 'DeepSeek-R1 family of open reasoning models',
    tags: ['1.5b', '7b', '8b', '14b', '32b', '70b', '671b'],
    url: 'https://ollama.com/library/deepseek-r1'
  },
  {
    name: 'qwen3',
    description: 'Qwen3 dense and mixture-of-experts models',
    tags: ['0.6b', '1.7b', '4b', '8b', '14b', '30b', '32b', '235b'],
    url: 'https://ollama.com/library/qwen3'
  },
  {
    name: 'qwen3.5',
    description: 'Qwen3.5 multimodal models for coding, reasoning, and agentic workflows',
    tags: ['0.8b', '2b', '4b', '9b', '27b', '35b', '122b'],
    url: 'https://ollama.com/library/qwen3.5'
  },
  {
    name: 'qwen2.5',
    description: 'Qwen2.5 multilingual models with long context support',
    tags: ['0.5b', '1.5b', '3b', '7b', '14b', '32b', '72b'],
    url: 'https://ollama.com/library/qwen2.5'
  },
  {
    name: 'qwen2.5-coder',
    description: 'Code-specific Qwen models for generation and reasoning',
    tags: ['0.5b', '1.5b', '3b', '7b', '14b', '32b'],
    url: 'https://ollama.com/library/qwen2.5-coder'
  },
  {
    name: 'gemma3',
    description: 'Google Gemma 3 models',
    tags: ['270m', '1b', '4b', '12b', '27b'],
    url: 'https://ollama.com/library/gemma3'
  },
  {
    name: 'gemma2',
    description: 'Google Gemma 2 models',
    tags: ['2b', '9b', '27b'],
    url: 'https://ollama.com/library/gemma2'
  },
  {
    name: 'phi4',
    description: 'Microsoft Phi-4 model',
    tags: ['14b'],
    url: 'https://ollama.com/library/phi4'
  },
  {
    name: 'phi3',
    description: 'Microsoft Phi-3 lightweight models',
    tags: ['3.8b', '14b'],
    url: 'https://ollama.com/library/phi3'
  },
  {
    name: 'mistral',
    description: 'The 7B model released by Mistral AI',
    tags: ['7b'],
    url: 'https://ollama.com/library/mistral'
  },
  {
    name: 'mistral-nemo',
    description: 'A 12B long-context model from Mistral AI and NVIDIA',
    tags: ['12b'],
    url: 'https://ollama.com/library/mistral-nemo'
  },
  {
    name: 'mixtral',
    description: 'Mixture-of-experts models from Mistral AI',
    tags: ['8x7b', '8x22b'],
    url: 'https://ollama.com/library/mixtral'
  },
  {
    name: 'neural-chat',
    description: 'A fine-tuned model for chat',
    tags: ['7b'],
    url: 'https://ollama.com/library/neural-chat'
  },
  {
    name: 'codellama',
    description: 'Code-focused Llama model family',
    tags: ['7b', '13b', '34b', '70b'],
    url: 'https://ollama.com/library/codellama'
  },
  {
    name: 'deepseek-coder',
    description: 'DeepSeek code models',
    tags: ['1.3b', '6.7b', '33b'],
    url: 'https://ollama.com/library/deepseek-coder'
  },
  {
    name: 'starcoder2',
    description: 'Open code models from the BigCode project',
    tags: ['3b', '7b', '15b'],
    url: 'https://ollama.com/library/starcoder2'
  },
  {
    name: 'llava',
    description: 'Vision-language model for image understanding',
    tags: ['7b', '13b', '34b'],
    url: 'https://ollama.com/library/llava'
  },
  {
    name: 'llama3.2-vision',
    description: 'Meta Llama 3.2 vision models',
    tags: ['11b', '90b'],
    url: 'https://ollama.com/library/llama3.2-vision'
  },
  {
    name: 'nomic-embed-text',
    description: 'Text embedding model with a large context window',
    tags: ['latest'],
    url: 'https://ollama.com/library/nomic-embed-text'
  },
  {
    name: 'mxbai-embed-large',
    description: 'Large text embedding model from mixedbread.ai',
    tags: ['latest'],
    url: 'https://ollama.com/library/mxbai-embed-large'
  },
  {
    name: 'dolphin-mixtral',
    description: 'Dolphin fine-tuned Mixtral',
    tags: ['8x7b', '8x22b'],
    url: 'https://ollama.com/library/dolphin-mixtral'
  },
  {
    name: 'orca-mini',
    description: 'Small, fast model',
    tags: ['3b', '7b', '13b', '70b'],
    url: 'https://ollama.com/library/orca-mini'
  }
];

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeModel(model) {
  if (!model) return null;
  const name = String(model.name || model.model || '').trim();
  if (!name) return null;

  const tags = Array.isArray(model.tags)
    ? model.tags
    : Array.isArray(model.sizes)
      ? model.sizes
      : [];

  return {
    name,
    description: String(model.description || model.summary || model.source || '').trim(),
    tags: unique(tags.map(tag => String(tag || '').trim().toLowerCase())).length
      ? unique(tags.map(tag => String(tag || '').trim().toLowerCase()))
      : ['latest'],
    url: model.url || `https://ollama.com/library/${name}`
  };
}

function sortModels(models) {
  const preferredOrder = new Map(FALLBACK_MODELS.map((model, index) => [model.name, index]));
  return models.slice().sort((a, b) => {
    const aOrder = preferredOrder.has(a.name) ? preferredOrder.get(a.name) : Number.MAX_SAFE_INTEGER;
    const bOrder = preferredOrder.has(b.name) ? preferredOrder.get(b.name) : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.name.localeCompare(b.name);
  });
}

function normalizeModels(models) {
  const byName = new Map();
  (models || []).forEach((model) => {
    const normalized = normalizeModel(model);
    if (!normalized) return;
    const existing = byName.get(normalized.name);
    byName.set(normalized.name, existing ? {
      ...existing,
      description: existing.description || normalized.description,
      tags: unique([...existing.tags, ...normalized.tags]),
      url: existing.url || normalized.url
    } : normalized);
  });
  return sortModels([...byName.values()]);
}

function parseLibraryModels(html) {
  const text = String(html || '');
  const models = [];
  const itemPattern = /<a\b[^>]*href=["']\/library\/([^"'/?#]+)["'][\s\S]*?<\/a>/gi;
  const sizePattern = /\b(?:\d+(?:\.\d+)?[bBmM]|e\d+b|\d+x\d+b|latest)\b/g;
  let match;

  while ((match = itemPattern.exec(text))) {
    const name = decodeURIComponent(match[1]).trim();
    const itemHtml = match[0].replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
    const itemText = decodeHtml(itemHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    const withoutName = itemText.replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '').trim();
    const description = withoutName
      .split(/\s+(?:tools|thinking|vision|embedding|cloud|audio)\b/i)[0]
      .split(/\s+\d+(?:\.\d+)?[bBmM]\b/)[0]
      .trim();
    const tags = unique((itemText.match(sizePattern) || []).map(tag => tag.toLowerCase()));

    models.push({
      name,
      description,
      tags,
      url: `https://ollama.com/library/${name}`
    });
  }

  return normalizeModels(models);
}

/**
 * Fetch available models from Ollama's official library
 * Falls back to curated list if official API is unavailable
 */
async function getAvailableModels(logger) {
  try {
    logger?.info('Fetching available models from Ollama catalog...');

    // The official search catalog is an HTML page, so normalize parsed results into
    // the same shape the UI expects from the local fallback list.
    try {
      const resp = await axios.get(OLLAMA_SEARCH_URL, { timeout: 5000, responseType: 'text' });
      const htmlModels = parseLibraryModels(resp.data);
      if (htmlModels.length > 0) {
        logger?.info(`Fetched ${htmlModels.length} models from official Ollama catalog`);
        return htmlModels;
      }
    } catch (e) {
      logger?.warn('Official Ollama catalog unavailable, using fallback list', e?.message);
    }

    // Fallback to curated list
    logger?.info('Using fallback curated model list');
    return normalizeModels(FALLBACK_MODELS);
  } catch (err) {
    logger?.error('Failed to fetch available models', err?.message || err);
    return normalizeModels(FALLBACK_MODELS);
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
  parseLibraryModels,
  normalizeModels,
  FALLBACK_MODELS
};
