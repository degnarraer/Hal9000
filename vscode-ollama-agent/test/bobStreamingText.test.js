const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cleanSpeakableText,
  createStreamingResponseSentenceEmitter,
  extractStreamingResponseText
} = require('../server/bobStreamingText');

test('extractStreamingResponseText reads partial response JSON while it streams', () => {
  assert.equal(
    extractStreamingResponseText('{"response":"Hello Rob. How can'),
    'Hello Rob. How can'
  );
  assert.equal(
    extractStreamingResponseText('{"output":{"response":"Nested response."}}'),
    'Nested response.'
  );
});

test('cleanSpeakableText removes non-printing stream characters', () => {
  assert.equal(
    cleanSpeakableText('Hello,\n\tRob.\u0000 How\r\nare you?'),
    'Hello, Rob. How are you?'
  );
});

test('streaming response sentence emitter emits completed sentences before final JSON completes', () => {
  const emitter = createStreamingResponseSentenceEmitter();

  assert.deepEqual(emitter.push('{"response":"Hello Rob').sentences, []);
  assert.deepEqual(emitter.push('{"response":"Hello Rob. How are').sentences, ['Hello Rob.']);
  assert.deepEqual(emitter.push('{"response":"Hello Rob. How are you?","metadata":').sentences, ['How are you?']);
});

test('streaming response sentence emitter flushes the final partial sentence', () => {
  const emitter = createStreamingResponseSentenceEmitter();

  assert.deepEqual(emitter.push('{"response":"No punctuation yet').sentences, []);
  assert.deepEqual(emitter.flush().sentences, ['No punctuation yet']);
});
