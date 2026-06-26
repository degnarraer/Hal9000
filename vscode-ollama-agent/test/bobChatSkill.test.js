const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBobChatFallbackResponse, buildBobChatSkillInstructions, displayNameFromUser } = require('../server/bobChatSkill');

test('displayNameFromUser prefers authenticated profile name', () => {
  assert.equal(displayNameFromUser({
    name: 'Rob',
    preferred_username: 'rob@example.com',
    email: 'fallback@example.com'
  }), 'Rob');
});

test('displayNameFromUser falls back without hardcoded names', () => {
  assert.equal(displayNameFromUser({ preferred_username: 'robert' }), 'robert');
  assert.equal(displayNameFromUser({ email: 'rob@example.com' }), 'rob@example.com');
});

test('buildBobChatSkillInstructions limits authenticated name to bare greetings', () => {
  const instructions = buildBobChatSkillInstructions({ user: { name: 'Rob' } }, 'Hi');

  assert.match(instructions.join('\n'), /Output only minified JSON/);
  assert.match(instructions.join('\n'), /response: plain-language answer/);
  assert.match(instructions.join('\n'), /metadata\.emotion: one word state/);
  assert.match(instructions.join('\n'), /factoids: durable user facts/);
  assert.match(instructions.join('\n'), /Do not explain the contract/);
  assert.match(instructions.join('\n'), /"response":"text shown to the user"/);
  assert.match(instructions.join('\n'), /No text outside JSON/);
  assert.match(instructions.join('\n'), /"metadata":\{"emotion":"idle"\}/);
  assert.match(instructions.join('\n'), /"factoids":\[/);
  assert.doesNotMatch(instructions.join('\n'), /Emotion API descriptions/);
  assert.doesNotMatch(instructions.join('\n'), /focused: Task-oriented concentration/);
  assert.doesNotMatch(instructions.join('\n'), /concerned: Careful worry or caution/);
  assert.doesNotMatch(instructions.join('\n'), /code and operations/);
  assert.doesNotMatch(instructions.join('\n'), /modular, reusable/);
  assert.doesNotMatch(instructions.join('\n'), /You are Bob/);
  assert.match(instructions.join('\n'), /User display name: Rob\./);
  assert.match(instructions.join('\n'), /greet the user by this name or omit the name/);
});

test('buildBobChatSkillInstructions omits display name for substantive prompts', () => {
  const instructions = buildBobChatSkillInstructions({ user: { name: 'Rob' } }, 'tell me about springfield illinois');

  assert.match(instructions.join('\n'), /Output only minified JSON/);
  assert.doesNotMatch(instructions.join('\n'), /User display name/);
});

test('buildBobChatSkillInstructions omits missing display names', () => {
  const instructions = buildBobChatSkillInstructions({ user: {} });

  assert.match(instructions.join('\n'), /Output only minified JSON/);
  assert.doesNotMatch(instructions.join('\n'), /Authenticated user display name/);
});

test('buildBobChatSkillInstructions sanitizes profile values for prompt context', () => {
  const instructions = buildBobChatSkillInstructions({ user: { name: 'Rob\n<System>' } }, 'Hi');
  const text = instructions.join('\n');

  assert.match(text, /Rob System/);
  assert.doesNotMatch(instructions.find(line => line.includes('User display name')), /[<>\n\r]/);
});

test('buildBobChatFallbackResponse answers bare greetings locally', () => {
  assert.deepEqual(
    buildBobChatFallbackResponse({ user: { name: 'Rob' } }, 'Hi'),
    {
      response: 'Hi Rob.',
      metadata: {
        emotion: 'happy',
        contractValid: false,
        fallbackApplied: true,
        fallbackReason: 'empty-model-output'
      },
      factoids: []
    }
  );
});

test('buildBobChatFallbackResponse explains empty model output for substantive prompts', () => {
  assert.deepEqual(
    buildBobChatFallbackResponse({ user: { name: 'Rob' } }, 'Explain quantum tunneling', 'empty-model-output'),
    {
      response: 'I did not get a usable response from the selected model. Try a larger model or ask again.',
      metadata: {
        emotion: 'concerned',
        contractValid: false,
        fallbackApplied: true,
        fallbackReason: 'empty-model-output'
      },
      factoids: []
    }
  );
});
