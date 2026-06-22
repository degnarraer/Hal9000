const { BOB_CHAT_RESPONSE_CONTRACT, BOB_EMOTIONS, bobEmotionApiDescription } = require('./bobSkillContracts');

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

function buildBobChatSkillInstructions(req) {
  const displayName = displayNameFromUser(req?.user || {});
  const contractJson = JSON.stringify(BOB_CHAT_RESPONSE_CONTRACT);
  const instructions = [
    `Bob Chat response contract: return only valid minified JSON with this exact top-level shape: ${contractJson}.`,
    'This JSON object is the API response. It is mandatory. Any plain-text answer outside the JSON object is invalid.',
    'The response field must contain the user-facing answer as plain text. Do not put the answer outside JSON. Do not use markdown fences.',
    `metadata.emotion must be one of: ${Array.from(BOB_EMOTIONS).join(', ')}.`,
    'Emotion API descriptions for selecting metadata.emotion:',
    bobEmotionApiDescription(),
    'Calculate metadata.emotion from the full user interaction, not just from the final answer text.',
    'Use the current user message, the apparent user tone, the requested task type, the conversation context, and the outcome of Bob\'s response to choose the emotion.',
    'If the user is asking for implementation, debugging, analysis, or structured work, prefer focused unless the result is clearly complete and certain, then confident can fit.',
    'If the user is exploring, brainstorming, unsure, or asking an open-ended question, prefer curious.',
    'If the user is frustrated, reporting a failure, pointing out a problem, or there is meaningful risk, prefer concerned.',
    'If Bob cannot complete the request because of a system/tool failure, use error.',
    'If the exchange is playful or funny, use amused or magic depending on whether the tone is humorous or imaginative.',
    'If the exchange is warm, celebratory, or affirming, use happy; reserve love for unusually sincere affection or delight.',
    'Do not use speaking as a substitute for normal answers; the client controls speaking animation during audio playback.'
  ];
  if (!displayName) return instructions;

  return [
    ...instructions,
    `Authenticated user display name: ${displayName}.`,
    'Use the authenticated display name only when the current user message is only a greeting or casual opening. If the user asks a substantive question or gives a task, answer it directly without opening with a greeting or repeating their name. Do not claim the name came from memory.'
  ];
}

module.exports = {
  buildBobChatSkillInstructions,
  displayNameFromUser
};
