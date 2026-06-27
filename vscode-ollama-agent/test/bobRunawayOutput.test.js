const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');

test('Bob response generation has a bounded JSON output budget', () => {
  assert.match(source, /const BOB_RESPONSE_OPTIONS = Object\.freeze\(\{ temperature: 0\.2, num_predict: 220 \}\)/);
  assert.match(source, /options: withDefaultOllamaOptions\(parameters\.options, BOB_RESPONSE_OPTIONS\)/);
});

test('Bob falls back when Ollama stops because output hit length limit', () => {
  assert.match(source, /hitLengthLimit = String\(generateSummary\?\.doneReason \|\| ''\)\.toLowerCase\(\) === 'length'/);
  assert.match(source, /model-hit-output-limit/);
  assert.match(source, /oversized-model-output/);
});
