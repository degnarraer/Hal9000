const { BOB_CHAT_RESPONSE_CONTRACT } = require('./bobSkillContracts');

function cleanInstructionValue(value) {
  return String(value || '')
    .replace(/[\r\n<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function displayNameFromUser(user = {}) {
  const name = cleanInstructionValue(user.name || user.given_name || user.preferred_username || user.email);
  if (!name || name === 'Signed in user') return '';
  return name;
}

function isBareGreeting(value = '') {
  return /^(hi|hello|hey|howdy|yo|sup|good morning|good afternoon|good evening)[!.\s]*$/i.test(String(value || '').trim());
}

function buildBobChatSkillInstructions(req, prompt = '') {
  const displayName = displayNameFromUser(req?.user || {});
  const contractJson = JSON.stringify(BOB_CHAT_RESPONSE_CONTRACT);
  const instructions = [
    `Output only minified JSON: ${contractJson}.`,
    'response: plain-language answer to the current user message only.',
    'metadata.emotion: one word state for this answer; use idle unless a stronger state is obvious.',
    'factoids: durable user facts explicitly supported by the current user message; use [] when no new durable fact appears.',
    'Each factoid must use factKey, category, fact, and confidence. Do not infer sensitive facts or facts not stated by the user.',
    'No markdown fences. No text outside JSON. Do not explain the contract.'
  ];
  if (!displayName || !isBareGreeting(prompt)) return instructions;

  return [
    ...instructions,
    `User display name: ${displayName}. For bare greetings, greet the user by this name or omit the name.`
  ];
}

function buildBobChatFallbackResponse(req, prompt = '', reason = 'empty-model-output') {
  const displayName = displayNameFromUser(req?.user || {});
  const greeting = displayName ? `Hi ${displayName}.` : 'Hi.';
  const response = isBareGreeting(prompt)
    ? greeting
    : 'I did not get a usable response from the selected model. Try a larger model or ask again.';

  return {
    response,
    metadata: {
      emotion: isBareGreeting(prompt) ? 'happy' : 'concerned',
      contractValid: false,
      fallbackApplied: true,
      fallbackReason: reason
    },
    factoids: []
  };
}

module.exports = {
  buildBobChatFallbackResponse,
  buildBobChatSkillInstructions,
  displayNameFromUser,
  isBareGreeting
};
