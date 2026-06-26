const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldSearchWeb,
  extractSearchQuery,
  parseDuckDuckGoResults,
  buildWebFallbackResponse,
  hasUnsupportedWebClaims,
  isSearchDumpResponse,
  buildWebSummaryPrompt
} = require('../server/webSearch');

test('web search trigger detects explicit and freshness-oriented requests', () => {
  assert.equal(shouldSearchWeb('search the internet for ollama news'), true);
  assert.equal(shouldSearchWeb('what is the latest Keycloak release?'), true);
  assert.equal(shouldSearchWeb('write a haiku about servers'), false);
});

test('extractSearchQuery removes common command phrasing', () => {
  assert.equal(
    extractSearchQuery('Please search the internet for latest Ollama web search support and summarize'),
    'latest Ollama web search support'
  );
  assert.equal(extractSearchQuery('look up bighal duckdns'), 'bighal duckdns');
});

test('parseDuckDuckGoResults extracts titles urls and snippets', () => {
  const html = `
    <div class="result results_links">
      <a rel="nofollow" class="result__a" href="/l/?kh=-1&amp;uddg=https%3A%2F%2Fexample.com%2Fone">Example &amp; One</a>
      <a class="result__snippet">First <b>snippet</b> text.</a>
    </div>
    <div class="result results_links">
      <a class="result__a" href="https://example.org/two">Example Two</a>
      <div class="result__snippet">Second snippet.</div>
    </div>
  `;

  assert.deepEqual(parseDuckDuckGoResults(html, 2), [
    { title: 'Example & One', url: 'https://example.com/one', snippet: 'First snippet text.' },
    { title: 'Example Two', url: 'https://example.org/two', snippet: 'Second snippet.' }
  ]);
});

test('buildWebSummaryPrompt includes source links for ollama summarization', () => {
  const prompt = buildWebSummaryPrompt('search for Bob', 'Bob', [
    { title: 'Bob', url: 'https://example.com', snippet: 'A personal assistant.' }
  ]);

  assert.match(prompt, /using only the provided web search results/);
  assert.match(prompt, /Input contract/);
  assert.match(prompt, /"contractVersion":1/);
  assert.match(prompt, /"skill":"web-search"/);
  assert.match(prompt, /"output":\{"response":"text shown to the user"/);
  assert.match(prompt, /"factoids":\[/);
  assert.match(prompt, /durable user facts explicitly supported by the user prompt/);
  assert.match(prompt, /not a numbered search-results dump/);
  assert.match(prompt, /ONLY use facts literally present/);
  assert.match(prompt, /data\.query must be exactly "Bob"/);
  assert.match(prompt, /never use placeholder source title/);
  assert.match(prompt, /https:\/\/example\.com/);
});

test('web fallback response synthesizes snippets instead of dumping sources', () => {
  const response = buildWebFallbackResponse('springfield illinois', [
    { title: 'Springfield, Illinois - Wikipedia', url: 'https://example.com/wiki', snippet: 'Springfield is the capital city of Illinois and the county seat of Sangamon County.' },
    { title: 'Visit Springfield Illinois', url: 'https://example.com/visit', snippet: 'Springfield has breweries and tourism attractions.' }
  ]);

  assert.match(response, /capital city of Illinois/);
  assert.match(response, /Visit Springfield Illinois/);
  assert.equal(isSearchDumpResponse("The search results for 'x' are as follows: 1) Official site, URL: https://example.com"), true);
  assert.equal(isSearchDumpResponse(response), false);
});

test('web claim check catches unsupported names and years', () => {
  const results = [
    { title: 'Springfield, Illinois - Wikipedia', url: 'https://example.com/wiki', snippet: 'Springfield is the capital city of Illinois and the county seat of Sangamon County. Its population was 114,394 at the 2020 United States census.' }
  ];

  assert.equal(
    hasUnsupportedWebClaims('Springfield is the capital city of Illinois and had population 114,394 in 2020.', results),
    false
  );
  assert.equal(
    hasUnsupportedWebClaims('Springfield was founded in 1821 by John McClure and named after Springfield, Ohio.', results),
    true
  );
});
