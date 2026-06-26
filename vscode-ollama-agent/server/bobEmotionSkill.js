const { BOB_EMOTIONS, normalizeBobEmotion, parseJsonObject } = require('./bobSkillContracts');

const EMOTION_CONTRACT = {
  emotion: 'idle',
  reason: ''
};

function buildBobEmotionPrompt({ prompt, recentMessages = [], response = '' } = {}) {
  const transcript = (recentMessages || [])
    .slice(-6)
    .map(row => `${row.role === 'assistant' ? 'Bob' : 'User'}: ${row.content || ''}`)
    .join('\n');

  return [
    'Task: classify Bob emotion for this exchange only.',
    `Output: minified JSON exactly ${JSON.stringify(EMOTION_CONTRACT)}.`,
    `Allowed emotion: ${Array.from(BOB_EMOTIONS).join('|')}.`,
    'Priority: error=system failure; concerned=user frustration/risk; focused=implementation/debugging/analysis; curious=open question; happy=greeting/positive; idle=neutral.',
    'Do not answer the user. Do not add text outside JSON.',
    '',
    '<recent_transcript>',
    transcript || '(none)',
    '</recent_transcript>',
    '<current_user_message>',
    String(prompt || ''),
    '</current_user_message>',
    '<bob_response>',
    String(response || ''),
    '</bob_response>'
  ].join('\n');
}

function parseBobEmotionContract(rawOutput, fallback = 'idle') {
  const parsed = parseJsonObject(rawOutput);
  if (!parsed) return { emotion: normalizeBobEmotion(fallback), reason: '', contractValid: false };
  const hasPlaceholderReason = isPlaceholderReason(parsed.reason);
  const reason = cleanReason(parsed.reason);
  return {
    emotion: normalizeBobEmotion(parsed.emotion || fallback),
    reason,
    contractValid: Boolean(parsed.emotion) && !hasPlaceholderReason
  };
}

function cleanReason(value) {
  const reason = String(value || '').trim();
  return reason.toLowerCase() === 'short reason' ? '' : reason;
}

function isPlaceholderReason(value) {
  return String(value || '').trim().toLowerCase() === 'short reason';
}

function heuristicBobEmotion({ prompt = '', response = '', failed = false } = {}) {
  if (failed) return 'error';
  const text = `${prompt}\n${response}`.toLowerCase();
  if (/^(hi|hello|hey|howdy)\b/.test(String(prompt || '').trim().toLowerCase())) return 'happy';
  if (/\b(error|failed|failing|broken|issue|problem|why|wtf|shit)\b/.test(text)) return 'concerned';
  if (/\b(how|what|why|should|could|discuss|brainstorm)\b/.test(String(prompt || '').toLowerCase())) return 'curious';
  if (/\b(fix|implement|debug|code|deploy|install|configure|test)\b/.test(text)) return 'focused';
  return 'idle';
}

module.exports = {
  buildBobEmotionPrompt,
  cleanReason,
  heuristicBobEmotion,
  isPlaceholderReason,
  parseBobEmotionContract
};
