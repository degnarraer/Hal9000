const axios = require('axios');

const DEFAULT_SEARCH_URL = 'https://duckduckgo.com/html/';
const SEARCH_TRIGGER_RE = /\b(search|look\s+up|web\s+search|internet|online|latest|current|today|news)\b/i;
const USER_FACTOID_PATTERNS = [
  { regex: /\bI\s+(?:really\s+)?(?:want|need|would like)\s+(?:to\s+buy\s+|to\s+get\s+)?([^.!?\n,;]+)/gi, category: 'preference', verb: 'wants' },
  { regex: /\bI(?:'m| am)\s+looking\s+for\s+([^.!?\n,;]+)/gi, category: 'preference', verb: 'is looking for' },
  { regex: /\bI\s+(?:like|prefer)\s+([^.!?\n,;]+)/gi, category: 'preference', verb: 'prefers' }
];

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeDuckDuckGoUrl(value) {
  const raw = String(value || '').replace(/&amp;/g, '&');
  try {
    const url = new URL(raw, 'https://duckduckgo.com');
    const uddg = url.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : url.href;
  } catch (err) {
    return raw;
  }
}

function shouldSearchWeb(prompt) {
  return SEARCH_TRIGGER_RE.test(String(prompt || ''));
}

function extractSearchQuery(prompt) {
  const text = String(prompt || '').trim();
  return text
    .replace(/^(please\s+)?(search\s+the\s+(web|internet)|look\s+on\s+the\s+internet|web\s+search|look\s+up|search)\s+(for\s+)?/i, '')
    .replace(/\b(and\s+)?(summarize|summary|return\s+a\s+summary|tell\s+me\s+about)\b.*$/i, '')
    .replace(/\s+and$/i, '')
    .replace(/\s+/g, ' ')
    .trim() || text;
}

function normalizeFactKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'user-preference';
}

function cleanFactObject(value) {
  return String(value || '')
    .replace(/\b(?:please\s+)?(?:search|look\s+up|find|show|recommend|tell\s+me\s+about)\b.*$/i, '')
    .replace(/\b(?:for me|online|on the web|on the internet)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.?!,;:]+$/g, '')
    .trim();
}

function extractUserPromptFactoids(prompt) {
  const text = String(prompt || '').trim();
  const factoids = [];
  const seen = new Set();

  for (const { regex, category, verb } of USER_FACTOID_PATTERNS) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      const object = cleanFactObject(match[1]);
      if (!object || object.length < 2 || object.length > 120) continue;
      if (/^(what|why|how|when|where|who)\b/i.test(object)) continue;
      const fact = `The user ${verb} ${object}.`;
      const factKey = normalizeFactKey(`${category}-${verb}-${object}`);
      if (seen.has(factKey)) continue;
      seen.add(factKey);
      factoids.push({ factKey, category, fact, confidence: 0.9 });
    }
  }

  return factoids;
}

function parseDuckDuckGoResults(html, limit = 5) {
  const results = [];
  const blocks = String(html || '').split(/<div class="result results_links[^"]*">/i).slice(1);

  for (const block of blocks) {
    const linkMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
    const title = stripHtml(linkMatch[2]);
    const url = decodeDuckDuckGoUrl(linkMatch[1]);
    const snippet = stripHtml(snippetMatch?.[1] || '');

    if (title && url) results.push({ title, url, snippet });
    if (results.length >= limit) break;
  }

  return results;
}

async function searchWeb(query, options = {}) {
  const searchUrl = options.searchUrl || process.env.WEB_SEARCH_URL || DEFAULT_SEARCH_URL;
  const limit = Number(options.limit || process.env.WEB_SEARCH_LIMIT || 5);
  const response = await axios.get(searchUrl, {
    params: { q: query },
    timeout: Number(options.timeout || process.env.WEB_SEARCH_TIMEOUT_MS || 12000),
    headers: {
      'User-Agent': 'BobAssistant/1.0 (+https://bobassist.duckdns.org)',
      Accept: 'text/html,application/xhtml+xml'
    }
  });

  return parseDuckDuckGoResults(response.data, limit);
}

function buildWebSummaryPrompt(userPrompt, query, results) {
  const inputContract = {
    contractVersion: 1,
    skill: 'web-search',
    input: {
      prompt: userPrompt,
      context: { query, results },
      upstream: []
    }
  };
  const sourceLines = results.map((item, index) => [
    `[${index + 1}] ${item.title}`,
    `URL: ${item.url}`,
    `Snippet: ${item.snippet || '(No snippet provided.)'}`
  ].join('\n')).join('\n\n');

  return [
    'Task: answer the user using only the provided web search results.',
    'Input contract:',
    JSON.stringify(inputContract),
    '',
    'Return minified JSON only using this output shape:',
    '{"contractVersion":1,"skill":"web-search","output":{"response":"text shown to the user","metadata":{"emotion":"focused"},"data":{"query":"search query"},"sources":[{"title":"source title","url":"https://source","snippet":"short snippet"}],"factoids":[{"factKey":"short-stable-key","category":"preference|project|identity|environment|workflow|constraint|general","fact":"The user ...","confidence":0}]}}',
    'response: write a helpful 3-5 sentence synthesis, not a numbered search-results dump.',
    'response should answer the user directly with the most useful facts from the snippets.',
    'factoids: durable user facts explicitly supported by the user prompt; use [] when no new durable fact appears.',
    'Extract user intent and preferences from the prompt even when the answer requires web sources. Example: "I want a truck" => {"factKey":"preference-wants-truck","category":"preference","fact":"The user wants a truck.","confidence":0.9}.',
    'Each factoid must use factKey, category, fact, and confidence. Do not infer sensitive facts or facts not stated by the user.',
    'ONLY use facts literally present in <search_results>. Do not add dates, names, locations, attractions, claims, or examples unless they appear in the snippets.',
    'Mention uncertainty when snippets are thin. Do not invent facts beyond the snippets.',
    `data.query must be exactly ${JSON.stringify(query)}.`,
    'sources must copy the real title,url,snippet values used from <search_results>; never use placeholder source title or https://source.',
    'Do not include markdown fences or text outside JSON.',
    '',
    '<search_results>',
    sourceLines || '(No results found.)',
    '</search_results>'
  ].join('\n');
}

function buildWebFallbackResponse(query, results = []) {
  if (!results.length) return `I searched for "${query}", but I could not find usable results.`;

  const useful = results
    .filter(item => item?.snippet)
    .slice(0, 4);
  const snippets = useful.map(item => stripHtml(item.snippet).replace(/\[[^\]]+\]/g, '').trim()).filter(Boolean);
  if (!snippets.length) {
    return `I found sources for "${query}", but the available snippets are thin. The most relevant result is ${results[0].title} (${results[0].url}).`;
  }

  const mainFacts = snippets
    .map(text => text.replace(/\s+/g, ' '))
    .filter((text, index, list) => list.findIndex(other => other.toLowerCase() === text.toLowerCase()) === index)
    .slice(0, 3);
  return [
    `${query} appears to refer to ${mainFacts[0].replace(/\s*\.$/, '')}.`,
    ...mainFacts.slice(1),
    `Useful starting points include ${results[0].title}${results[1] ? ` and ${results[1].title}` : ''}.`
  ].join(' ');
}

function isSearchDumpResponse(value) {
  const text = String(value || '').trim();
  return /search results (for|are as follows)/i.test(text) ||
    /\b1\)\s+.*URL:/i.test(text) ||
    /source title|https:\/\/source/i.test(text);
}

function hasUnsupportedWebClaims(response, results = []) {
  const text = String(response || '');
  if (!text.trim()) return false;
  const sourceText = results
    .map(item => `${item.title || ''} ${item.url || ''} ${stripHtml(item.snippet || '')}`)
    .join(' ')
    .toLowerCase();
  const normalizedSource = sourceText.replace(/[^a-z0-9]+/g, ' ');

  const properPhrases = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];
  const unsupportedProper = properPhrases
    .filter(phrase => !['Springfield Illinois', 'Central Illinois', 'United States'].includes(phrase))
    .some(phrase => !normalizedSource.includes(phrase.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()));
  if (unsupportedProper) return true;

  const years = text.match(/\b(1[6-9]\d{2}|20\d{2})\b/g) || [];
  return years.some(year => !normalizedSource.includes(year));
}

module.exports = {
  buildWebFallbackResponse,
  extractUserPromptFactoids,
  hasUnsupportedWebClaims,
  shouldSearchWeb,
  extractSearchQuery,
  isSearchDumpResponse,
  parseDuckDuckGoResults,
  searchWeb,
  buildWebSummaryPrompt
};
