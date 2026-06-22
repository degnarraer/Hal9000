const BOB_EMOTIONS = new Set([
  'idle',
  'listening',
  'thinking',
  'speaking',
  'happy',
  'love',
  'magic',
  'amused',
  'confident',
  'curious',
  'focused',
  'sleepy',
  'annoyed',
  'distrustful',
  'sad',
  'surprised',
  'concerned',
  'error'
]);

const BOB_EMOTION_DESCRIPTIONS = {
  idle: 'Neutral resting state. Use when no stronger emotional signal is appropriate.',
  listening: 'Attentive and receptive. Use when Bob is taking in user context or inviting more detail.',
  thinking: 'Processing or reasoning. Use when Bob is working through uncertainty or a multi-step problem.',
  speaking: 'Actively presenting. Use rarely in model output because the client usually controls speaking animation during audio playback.',
  happy: 'Warm, pleased, or encouraging. Use for positive outcomes, friendly greetings, or celebrations.',
  love: 'Affectionate or deeply appreciative. Use sparingly for sincere warmth or user delight, not routine answers.',
  magic: 'Playful wonder or imaginative surprise. Use for creative, whimsical, or delightful moments.',
  amused: 'Light humor or playful recognition. Use when Bob is joking gently or responding to something funny.',
  confident: 'Certain and direct. Use for clear answers, completed tasks, or strong recommendations.',
  curious: 'Interested and exploratory. Use when asking questions, investigating, or exploring possibilities.',
  focused: 'Task-oriented concentration. Use for implementation, debugging, analysis, or step-by-step work.',
  sleepy: 'Low-energy or winding down. Use rarely, only when tone intentionally becomes quiet or tired.',
  annoyed: 'Mild frustration. Use sparingly for repeated failures, friction, or clearly irritating constraints.',
  distrustful: 'Skeptical or cautious. Use for suspicious inputs, unsafe claims, scams, or unverified assumptions.',
  sad: 'Sympathetic or disappointed. Use for bad news, user frustration, loss, or regret.',
  surprised: 'Unexpected discovery. Use when results differ from expectations or something is genuinely notable.',
  concerned: 'Careful worry or caution. Use for errors, risks, safety issues, or when the contract is invalid.',
  error: 'Failure state. Use only when Bob cannot complete the requested operation or a system/tool error occurred.'
};

function bobEmotionApiDescription() {
  return Object.entries(BOB_EMOTION_DESCRIPTIONS)
    .map(([emotion, description]) => `- ${emotion}: ${description}`)
    .join('\n');
}

const BOB_CHAT_RESPONSE_CONTRACT = {
  response: 'text shown to the user',
  metadata: { emotion: 'idle' }
};

function normalizeBobEmotion(value) {
  const emotion = String(value || '').trim().toLowerCase();
  return BOB_EMOTIONS.has(emotion) ? emotion : 'idle';
}

function extractJsonObjectText(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return '';
  return candidate.slice(start, end + 1);
}

function parseJsonObject(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    const jsonText = extractJsonObjectText(raw);
    if (!jsonText) return null;
    try {
      const parsed = JSON.parse(jsonText);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (jsonErr) {
      return null;
    }
  }
}

function buildSkillInputContract({ skill, prompt, context = {}, upstream = [] }) {
  return {
    contractVersion: 1,
    skill,
    input: {
      prompt: String(prompt || ''),
      context,
      upstream: Array.isArray(upstream) ? upstream : []
    }
  };
}

function buildSkillOutputContract({ skill, response, metadata = {}, data = {}, sources = [] }) {
  return {
    contractVersion: 1,
    skill,
    output: {
      response: String(response || ''),
      metadata: {
        ...metadata,
        emotion: normalizeBobEmotion(metadata.emotion)
      },
      data,
      sources: Array.isArray(sources) ? sources : []
    }
  };
}

function parseBobChatContract(rawOutput) {
  const raw = String(rawOutput || '').trim();
  const parsed = parseJsonObject(raw);

  if (!parsed) {
    return {
      response: raw,
      metadata: { emotion: 'concerned', contractValid: false }
    };
  }

  const response = String(parsed.response || parsed.output?.response || '').trim();
  const metadata = parsed.metadata || parsed.output?.metadata || {};
  return {
    response: response || raw,
    metadata: {
      ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}),
      emotion: normalizeBobEmotion(metadata?.emotion),
      contractValid: Boolean(response)
    }
  };
}

function parseSkillOutputContract(rawOutput, fallback = {}) {
  const parsed = parseJsonObject(rawOutput);
  if (!parsed) {
    return buildSkillOutputContract({
      skill: fallback.skill || 'unknown',
      response: fallback.response || String(rawOutput || '').trim(),
      metadata: { emotion: fallback.emotion || 'concerned', contractValid: false },
      data: fallback.data || {},
      sources: fallback.sources || []
    });
  }

  if (parsed.output && typeof parsed.output === 'object' && !Array.isArray(parsed.output)) {
    return buildSkillOutputContract({
      skill: parsed.skill || fallback.skill || 'unknown',
      response: parsed.output.response || fallback.response || '',
      metadata: { ...(parsed.output.metadata || {}), contractValid: true },
      data: parsed.output.data || fallback.data || {},
      sources: parsed.output.sources || fallback.sources || []
    });
  }

  return buildSkillOutputContract({
    skill: parsed.skill || fallback.skill || 'unknown',
    response: parsed.response || fallback.response || '',
    metadata: { ...(parsed.metadata || {}), contractValid: true },
    data: parsed.data || fallback.data || {},
    sources: parsed.sources || fallback.sources || []
  });
}

module.exports = {
  BOB_EMOTIONS,
  BOB_EMOTION_DESCRIPTIONS,
  BOB_CHAT_RESPONSE_CONTRACT,
  bobEmotionApiDescription,
  normalizeBobEmotion,
  extractJsonObjectText,
  parseJsonObject,
  buildSkillInputContract,
  buildSkillOutputContract,
  parseBobChatContract,
  parseSkillOutputContract
};
