const test = require('node:test');
const assert = require('node:assert/strict');
const { filterSupportedFactoids, parseFactoidExtraction, splitClaims } = require('../server/memoryFactoids');

test('parseFactoidExtraction reads the JSON object from model output', () => {
  const parsed = parseFactoidExtraction('Sure:\n{"factoids":[{"factKey":"name","category":"identity","fact":"The user is named Rob.","confidence":0.7}]}');

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].factKey, 'name');
});

test('filterSupportedFactoids keeps explicitly supported first-message identity facts', () => {
  const messages = [{ role: 'user', content: 'Hi, my name is Rob' }];
  const filtered = filterSupportedFactoids([
    { factKey: 'user-name', category: 'identity', fact: 'The user is named Rob.', confidence: 0.7 }
  ], messages);

  assert.equal(filtered.length, 1);
});

test('filterSupportedFactoids drops hallucinated profile details from a greeting', () => {
  const messages = [{ role: 'user', content: 'Hi, my name is Rob' }];
  const filtered = filterSupportedFactoids([
    {
      factKey: 'profile',
      category: 'identity|environment|workflow|constraint|general',
      fact: 'The user is named Rob and works in a quiet office with a large monitor. He prefers deep focus and often faces deadline constraints.',
      confidence: 0.7
    }
  ], messages);

  assert.deepEqual(filtered, []);
});

test('splitClaims separates multi-claim factoids for evidence checking', () => {
  assert.deepEqual(
    splitClaims('The user is named Rob and works in a quiet office. He prefers deep focus.'),
    ['is named Rob', 'works in a quiet office', 'He prefers deep focus']
  );
});
