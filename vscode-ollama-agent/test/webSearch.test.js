const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldSearchWeb,
  extractSearchQuery,
  parseDuckDuckGoResults,
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
  const prompt = buildWebSummaryPrompt('search for Big Hal', 'Big Hal', [
    { title: 'Big Hal', url: 'https://example.com', snippet: 'A personal assistant.' }
  ]);

  assert.match(prompt, /Use only the sources below/);
  assert.match(prompt, /https:\/\/example\.com/);
});
