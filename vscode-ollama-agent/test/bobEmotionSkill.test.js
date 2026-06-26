const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildBobEmotionPrompt,
  heuristicBobEmotion,
  parseBobEmotionContract
} = require('../server/bobEmotionSkill');

test('buildBobEmotionPrompt keeps emotion classification in its own small contract', () => {
  const prompt = buildBobEmotionPrompt({
    prompt: 'Can you debug this install issue?',
    response: 'I will check the config.',
    recentMessages: [{ role: 'user', content: 'The server is broken' }]
  });

  assert.match(prompt, /Task: classify Bob emotion for this exchange only/);
  assert.match(prompt, /"emotion":"idle","reason":""/);
  assert.doesNotMatch(prompt, /short reason/);
  assert.match(prompt, /Allowed emotion: idle\|listening\|thinking/);
  assert.match(prompt, /Do not answer the user/);
  assert.match(prompt, /<current_user_message>/);
  assert.match(prompt, /Can you debug this install issue/);
  assert.match(prompt, /<bob_response>/);
  assert.doesNotMatch(prompt, /Task-oriented concentration/);
  assert.doesNotMatch(prompt, /Emotion API descriptions/);
});

test('parseBobEmotionContract normalizes valid and invalid emotion contracts', () => {
  assert.deepEqual(parseBobEmotionContract('{"emotion":"happy","reason":"Greeting"}'), {
    emotion: 'happy',
    reason: 'Greeting',
    contractValid: true
  });
  assert.deepEqual(parseBobEmotionContract('{"emotion":"idle","reason":"short reason"}'), {
    emotion: 'idle',
    reason: '',
    contractValid: false
  });

  assert.deepEqual(parseBobEmotionContract('not json', 'focused'), {
    emotion: 'focused',
    reason: '',
    contractValid: false
  });
});

test('heuristicBobEmotion provides stable fallback classifications', () => {
  assert.equal(heuristicBobEmotion({ prompt: 'Hello' }), 'happy');
  assert.equal(heuristicBobEmotion({ prompt: 'Can you debug the install script?' }), 'focused');
  assert.equal(heuristicBobEmotion({ prompt: 'Why is this broken?' }), 'concerned');
  assert.equal(heuristicBobEmotion({ prompt: 'What should we build next?' }), 'curious');
  assert.equal(heuristicBobEmotion({ prompt: 'anything', failed: true }), 'error');
});
