const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBobChatSkillInstructions, displayNameFromUser } = require('../server/bobChatSkill');

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

test('buildBobChatSkillInstructions limits authenticated name greetings', () => {
  const instructions = buildBobChatSkillInstructions({ user: { name: 'Rob' } });

  assert.match(instructions.join('\n'), /Bob Chat response contract/);
  assert.match(instructions.join('\n'), /"response":"text shown to the user"/);
  assert.match(instructions.join('\n'), /Any plain-text answer outside the JSON object is invalid/);
  assert.match(instructions.join('\n'), /metadata\.emotion/);
  assert.match(instructions.join('\n'), /Emotion API descriptions/);
  assert.match(instructions.join('\n'), /focused: Task-oriented concentration/);
  assert.match(instructions.join('\n'), /concerned: Careful worry or caution/);
  assert.match(instructions.join('\n'), /Calculate metadata\.emotion from the full user interaction/);
  assert.match(instructions.join('\n'), /current user message, the apparent user tone, the requested task type/);
  assert.match(instructions.join('\n'), /If the user is frustrated, reporting a failure, pointing out a problem/);
  assert.match(instructions.join('\n'), /Authenticated user display name: Rob\./);
  assert.match(instructions.join('\n'), /only when the current user message is only a greeting/);
  assert.match(instructions.join('\n'), /answer it directly without opening with a greeting or repeating their name/);
});

test('buildBobChatSkillInstructions omits missing display names', () => {
  const instructions = buildBobChatSkillInstructions({ user: {} });

  assert.match(instructions.join('\n'), /Bob Chat response contract/);
  assert.doesNotMatch(instructions.join('\n'), /Authenticated user display name/);
});

test('buildBobChatSkillInstructions sanitizes profile values for prompt context', () => {
  const instructions = buildBobChatSkillInstructions({ user: { name: 'Rob\n<System>' } });
  const text = instructions.join('\n');

  assert.match(text, /Rob System/);
  assert.doesNotMatch(instructions.find(line => line.includes('Authenticated user display name')), /[<>\n\r]/);
});
