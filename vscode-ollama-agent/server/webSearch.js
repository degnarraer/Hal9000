const axios = require('axios');

const DEFAULT_SEARCH_URL = 'https://duckduckgo.com/html/';
const SEARCH_TRIGGER_RE = /\b(search|look\s+up|web\s+search|internet|online|latest|current|today|news)\b/i;

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
  const sourceLines = results.map((item, index) => [
    `[${index + 1}] ${item.title}`,
    `URL: ${item.url}`,
    `Snippet: ${item.snippet || '(No snippet provided.)'}`
  ].join('\n')).join('\n\n');

  return [
    'You are Bob using a web search skill.',
    'Summarize the search results for the user in a concise, helpful answer.',
    'Use only the sources below. If the sources are thin or conflicting, say so.',
    'Include a short "Sources" section with numbered links.',
    '',
    `User request: ${userPrompt}`,
    `Search query: ${query}`,
    '',
    '<search_results>',
    sourceLines || '(No results found.)',
    '</search_results>'
  ].join('\n');
}

module.exports = {
  shouldSearchWeb,
  extractSearchQuery,
  parseDuckDuckGoResults,
  searchWeb,
  buildWebSummaryPrompt
};
