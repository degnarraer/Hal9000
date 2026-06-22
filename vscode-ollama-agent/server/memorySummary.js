const SUMMARY_INSTRUCTIONS = {
  short: {
    focus: 'latest conversation',
    content: 'immediate goals, current task state, preferences stated today, and unresolved next steps',
    limit: '120 words',
    defaultMaxWords: 120,
    bullets: '3-5'
  },
  medium: {
    focus: 'recent conversation history',
    content: 'recurring preferences, active projects, decisions, constraints, and useful context',
    limit: '250 words',
    defaultMaxWords: 250,
    bullets: '4-7'
  },
  long: {
    focus: 'durable personalization',
    content: 'stable user preferences, enduring projects, identity/context facts the user intentionally revealed, and durable operating principles',
    limit: '400 words',
    defaultMaxWords: 400,
    bullets: '5-9'
  }
};

function buildMemorySummaryPrompt(scope, transcript) {
  const instruction = SUMMARY_INSTRUCTIONS[scope] || SUMMARY_INSTRUCTIONS.short;

  return [
    'You are Bob memory summarization skill.',
    `Create a ${scope || 'short'}-term memory list for ${instruction.focus}.`,
    `Capture only useful memories: ${instruction.content}.`,
    `Return ${instruction.bullets} prioritized markdown bullets, most important first.`,
    `Each bullet must be a concise third-person memory about the user, Bob, the active project, or an unresolved next step. Keep the whole response under ${instruction.limit}.`,
    'Do not write chat logs, speaker turns, numbered transcript recaps, greetings, small talk, or assistant/user dialogue.',
    'Do not write a preamble like "Based on the transcript".',
    'Do not quote or reproduce the transcript. Do not include markdown tables.',
    'Only include information supported by the transcript. Do not invent facts.',
    'If no useful memory is supported, return exactly "- No durable memory has been formed yet."',
    '',
    '<conversation_transcript>',
    transcript || '(No conversation messages yet.)',
    '</conversation_transcript>'
  ].join('\n');
}

function buildMemoryMergePrompt(scope, { existingSummary = '', incomingMemory = '', incomingLabel = 'new memory', maxWords } = {}) {
  const instruction = SUMMARY_INSTRUCTIONS[scope] || SUMMARY_INSTRUCTIONS.short;
  const wordLimit = Math.max(40, Number(maxWords) || instruction.defaultMaxWords || 120);

  return [
    'You are Bob memory merge skill.',
    `Merge ${incomingLabel} into Bob's ${scope || 'short'}-term memory only when it improves future conversations.`,
    `Memory purpose: ${instruction.content}.`,
    `Return ${instruction.bullets} prioritized markdown bullets, most important first, under ${wordLimit} words total.`,
    'Preserve high-value existing memory. Do not replace it with newer but less important information.',
    'Drop stale, duplicated, low-value, or unsupported details.',
    'If the incoming memory is less important than the existing memory, return the existing memory unchanged.',
    'Do not invent facts. Do not write a preamble. Do not include markdown tables.',
    'If no useful memory is supported, return exactly "- No durable memory has been formed yet."',
    '',
    '<existing_memory>',
    existingSummary || '- No durable memory has been formed yet.',
    '</existing_memory>',
    '',
    '<incoming_memory>',
    incomingMemory || '- No durable memory has been formed yet.',
    '</incoming_memory>'
  ].join('\n');
}

module.exports = {
  SUMMARY_INSTRUCTIONS,
  buildMemoryMergePrompt,
  buildMemorySummaryPrompt
};
