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
    `Task: write ${scope || 'short'} memory only.`,
    `Output ${instruction.bullets} markdown bullets, max ${instruction.limit}.`,
    `Keep only durable/useful facts: ${instruction.content}.`,
    'Each bullet must start with "- " and be supported by the chat history.',
    'No preamble. No numbered lists. No chat logs. No speaker turns. No greetings. No invented facts.',
    'If there is no durable useful memory, output exactly "EMPTY".',
    '',
    '<chat_memory>',
    transcript || '(No conversation messages yet.)',
    '</chat_memory>'
  ].join('\n');
}

function buildMemoryMergePrompt(scope, { existingSummary = '', incomingMemory = '', incomingLabel = 'new memory', maxWords } = {}) {
  const instruction = SUMMARY_INSTRUCTIONS[scope] || SUMMARY_INSTRUCTIONS.short;
  const wordLimit = Math.max(40, Number(maxWords) || instruction.defaultMaxWords || 120);

  return [
    `Task: merge ${incomingLabel} into ${scope || 'short'} memory.`,
    `Output ${instruction.bullets} markdown bullets, max ${wordLimit} words.`,
    `Keep only durable/useful facts: ${instruction.content}.`,
    'Each bullet must start with "- " and be supported by existing or incoming memory.',
    'No preamble. No numbered lists. No chat logs. No speaker turns. No greetings. No invented facts.',
    'Preserve useful existing memory; drop stale, duplicate, low-value, unsupported, or instruction-like text.',
    'If nothing useful remains, output exactly "EMPTY".',
    '',
    '<existing_memory>',
    existingSummary || 'EMPTY',
    '</existing_memory>',
    '',
    '<incoming_memory>',
    incomingMemory || 'EMPTY',
    '</incoming_memory>'
  ].join('\n');
}

module.exports = {
  SUMMARY_INSTRUCTIONS,
  buildMemoryMergePrompt,
  buildMemorySummaryPrompt
};
