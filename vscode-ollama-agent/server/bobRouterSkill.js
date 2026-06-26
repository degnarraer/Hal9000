const { parseJsonObject } = require('./bobSkillContracts');
const { isBareGreeting } = require('./bobChatSkill');
const { extractSearchQuery, shouldSearchWeb } = require('./webSearch');

const AUTO_MODEL_VALUE = 'AUTO';

const ROUTER_CONTRACT = {
  skill: 'bob-chat',
  query: '',
  reason: '',
  parameters: {},
  factoids: []
};

const MODEL_ROUTER_CONTRACT = {
  model: '',
  reason: ''
};

const BOB_ROUTER_SKILLS = [
  {
    id: 'bob-chat',
    description: 'General conversation, greetings, personal memory, opinions, reasoning, writing, clarification, and stable general explanations that do not need factual lookup.',
    enabled: true
  },
  {
    id: 'web-search',
    description: 'Factual summaries of real-world places, people, companies, products, events, versions, prices, laws, news, or anything that benefits from source-backed/current information.',
    enabled: true
  }
];

const DEFAULT_MODEL_RULES = {
  routerMinSizeB: 3,
  fallbackMinSizeB: 2,
  minByTask: {
    greeting: 0.8,
    chat: 2,
    writing: 2,
    reasoning: 4,
    code: 9,
    webSearch: 9,
    longContext: 9,
    veryLongContext: 27
  }
};

function buildBobRouterEnvelope({ prompt = '', request = {} } = {}) {
  return {
    version: '1.0',
    request: {
      id: request.id || '550e8400-e29b-41d4-a716-446655440000',
      timestamp: request.timestamp || '2026-06-25T18:30:00Z',
      sessionId: request.sessionId || 'session-12345',
      userId: request.userId || 'user-001'
    },
    input: {
      text: String(prompt || ''),
      attachments: [],
      language: 'en',
      source: 'web'
    },
    emotion: {
      current: 'neutral',
      confidence: 0,
      sentiment: 'neutral',
      detected: []
    },
    user: {
      name: null,
      factoids: []
    },
    memory: {
      conversationSummary: null,
      recentMessages: [],
      workingMemory: {
        currentTopic: null,
        goal: null
      }
    },
    skills: {
      available: BOB_ROUTER_SKILLS,
      selected: {
        skill: null,
        reason: null,
        parameters: {}
      }
    },
    output: {
      text: null,
      confidence: null,
      actions: [],
      toolCalls: [],
      citations: []
    }
  };
}

function buildBobRouterPrompt({ prompt, request, envelope, outputContract = ROUTER_CONTRACT, skillDescription = '' } = {}) {
  const requestEnvelope = envelope || buildBobRouterEnvelope({ prompt, request });
  const guidance = String(skillDescription || '').trim();
  return [
    'You are Bob Router. Choose the next skill for this request envelope.',
    `Return JSON only: ${JSON.stringify(outputContract || ROUTER_CONTRACT)}.`,
    guidance || [
      'Use only enabled skills from request.skills.available.',
      'If the user asks "tell me about" a real-world named place/entity, choose web-search.',
      'If unsure whether facts may be stale or hallucinated, choose web-search.'
    ].join('\n'),
    'Do not answer the user. First character must be { and last character must be }.',
    '<router_request>',
    JSON.stringify(requestEnvelope, null, 2),
    '</router_request>'
  ].join('\n');
}

function parseBobRouterContract(rawOutput, prompt = '') {
  const parsed = parseJsonObject(rawOutput);
  if (!parsed) return heuristicBobRoute(prompt, false);
  const skill = parsed.skill === 'web-search' ? 'web-search' : 'bob-chat';
  const hasPlaceholderReason = isPlaceholderReason(parsed.reason);
  const reason = cleanReason(parsed.reason) || defaultRouteReason(skill);
  const factoids = normalizeRouterFactoids(parsed.factoids);
  return {
    skill,
    query: skill === 'web-search' ? String(parsed.query || extractSearchQuery(prompt)).trim() : '',
    reason,
    parameters: parsed.parameters && typeof parsed.parameters === 'object' && !Array.isArray(parsed.parameters)
      ? parsed.parameters
      : {},
    factoids,
    contractValid: Boolean(parsed.skill) && !hasPlaceholderReason && Array.isArray(parsed.factoids)
  };
}

function normalizeRouterFactoids(group) {
  const merged = [];
  const seen = new Set();
  if (!Array.isArray(group)) return merged;
  for (const item of group) {
    const fact = String(item?.fact || item?.value || '').trim();
    if (!fact) continue;
    const factoid = {
      factKey: String(item?.factKey || item?.key || fact.toLowerCase().replace(/[^a-z0-9]+/g, '-')).trim().slice(0, 120),
      category: String(item?.category || 'general').trim().slice(0, 80) || 'general',
      fact: fact.slice(0, 1000),
      confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0))
    };
    const key = factoid.factKey || factoid.fact.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(factoid);
  }
  return merged;
}

function defaultRouteReason(skill) {
  return skill === 'web-search'
    ? 'The question needs source-backed or current factual information.'
    : 'The question can be answered without external research.';
}

function cleanReason(value) {
  const reason = String(value || '').trim();
  return reason.toLowerCase() === 'short reason' ? '' : reason;
}

function isPlaceholderReason(value) {
  return String(value || '').trim().toLowerCase() === 'short reason';
}

function heuristicBobRoute(prompt = '', contractValid = true) {
  const useSearch = shouldSearchWeb(prompt);
  return {
    skill: useSearch ? 'web-search' : 'bob-chat',
    query: useSearch ? extractSearchQuery(prompt) : '',
    reason: useSearch ? 'Keyword heuristic matched web search intent.' : 'No web search intent detected.',
    parameters: {},
    factoids: [],
    contractValid
  };
}

function isAutoModel(value = '') {
  return String(value || '').trim().toUpperCase() === AUTO_MODEL_VALUE;
}

function normalizeInstalledModelName(item) {
  if (typeof item === 'string') return item;
  return item?.name || item?.model || '';
}

function parseModelSizeB(model = '') {
  const text = String(model || '').toLowerCase();
  const tag = text.includes(':') ? text.split(':').slice(1).join(':') : 'latest';
  const size = tag.match(/(\d+(?:\.\d+)?)b/);
  if (size) return Number(size[1]);
  if (/qwen3\.5(?::latest)?$/.test(text)) return 9;
  return Number.POSITIVE_INFINITY;
}

function modelFamilyRank(model = '') {
  const text = String(model || '').toLowerCase();
  if (text.startsWith('qwen3.5')) return 0;
  if (text.startsWith('qwen3')) return 1;
  if (text.startsWith('qwen2.5')) return 2;
  return 3;
}

function sanitizeModelRules(rules = {}) {
  const cleanNumber = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  };
  const inputMinByTask = rules.minByTask || {};
  return {
    routerMinSizeB: cleanNumber(rules.routerMinSizeB, DEFAULT_MODEL_RULES.routerMinSizeB),
    fallbackMinSizeB: cleanNumber(rules.fallbackMinSizeB, DEFAULT_MODEL_RULES.fallbackMinSizeB),
    minByTask: Object.fromEntries(Object.entries(DEFAULT_MODEL_RULES.minByTask).map(([key, fallback]) => [
      key,
      cleanNumber(inputMinByTask[key], fallback)
    ]))
  };
}

function estimateRequiredModelSizeB({ prompt = '', route = {}, modelRules = DEFAULT_MODEL_RULES } = {}) {
  const rules = sanitizeModelRules(modelRules);
  const minByTask = rules.minByTask;
  const text = String(prompt || '').toLowerCase();
  if (isBareGreeting(prompt)) return minByTask.greeting;
  if (route.skill === 'web-search') return minByTask.webSearch;
  if (text.length > 3500) return minByTask.veryLongContext;
  if (text.length > 1200) return minByTask.longContext;
  if (/\b(code|debug|bug|stack trace|exception|api|regex|sql|javascript|typescript|powershell|docker|kubernetes|refactor|implement)\b/.test(text)) return minByTask.code;
  if (/\b(reason|analyze|architecture|design|compare|tradeoff|plan|math|prove|derive|explain why)\b/.test(text)) return minByTask.reasoning;
  if (/\b(write|rewrite|summarize|draft|email|note|checklist|brainstorm)\b/.test(text)) return minByTask.writing;
  return minByTask.chat;
}

function preferredInstalledModels(installedModels = []) {
  return installedModels
    .map(normalizeInstalledModelName)
    .map(model => String(model || '').trim())
    .filter(Boolean)
    .sort((a, b) => {
      const family = modelFamilyRank(a) - modelFamilyRank(b);
      if (family !== 0) return family;
      return parseModelSizeB(a) - parseModelSizeB(b);
    });
}

function selectRouterModel({ installedModels = [], defaultModel = 'llama2', minSizeB = 3 } = {}) {
  const installed = preferredInstalledModels(installedModels);
  const preferred = installed.filter(model => modelFamilyRank(model) <= 2);
  const chosen = preferred.find(model => parseModelSizeB(model) >= minSizeB)
    || preferred[preferred.length - 1]
    || installed.find(model => model === defaultModel)
    || installed[0]
    || defaultModel;

  return {
    model: chosen,
    minSizeB,
    candidates: preferred,
    reason: preferred.length
      ? `Selected the smallest installed Qwen-family router model at or above ${minSizeB}B.`
      : 'Selected the first installed router model because no Qwen-family models were installed.'
  };
}

function buildBobModelRouterPrompt({ prompt = '', route = {}, candidates = [], modelRules = DEFAULT_MODEL_RULES } = {}) {
  const rules = sanitizeModelRules(modelRules);
  return [
    `Choose the best installed model for Bob's response. Return JSON only: ${JSON.stringify(MODEL_ROUTER_CONTRACT)}.`,
    'Use the smallest model that is likely to satisfy the task and strict JSON response contract.',
    `The router itself is already running on a model at or above ${rules.routerMinSizeB}B; do not choose a model just because it is the router.`,
    'Use these tester-configured minimum sizes as policy, not hardcoded assumptions:',
    JSON.stringify(rules.minByTask),
    'Choose only one exact model from <installed_models>.',
    'Do not answer the user. First character must be { and last character must be }.',
    '<route>',
    JSON.stringify({ skill: route.skill || 'bob-chat', query: route.query || '', reason: route.reason || '' }),
    '</route>',
    '<installed_models>',
    candidates.join('\n'),
    '</installed_models>',
    '<current_user_message>',
    String(prompt || ''),
    '</current_user_message>'
  ].join('\n');
}

function parseBobModelRouterContract(rawOutput, candidates = [], fallback = {}) {
  const parsed = parseJsonObject(rawOutput);
  const candidateSet = new Set(candidates);
  const parsedModel = String(parsed?.model || '').trim();
  const targetSizeB = Number.isFinite(Number(fallback.targetSizeB)) ? Number(fallback.targetSizeB) : 0;
  const parsedSizeB = parseModelSizeB(parsedModel);
  if (parsed && candidateSet.has(parsedModel) && parsedSizeB >= targetSizeB) {
    return {
      requestedModel: AUTO_MODEL_VALUE,
      model: parsedModel,
      auto: true,
      targetSizeB,
      candidates,
      reason: String(parsed.reason || 'Model router selected this installed model.').trim(),
      contractValid: true
    };
  }

  return {
    ...fallback,
    contractValid: false,
    reason: `Model router returned an invalid choice; ${fallback.reason || 'using deterministic fallback.'}`,
    rawOutput: String(rawOutput || '')
  };
}

function selectBobModel({ requestedModel, installedModels = [], route = {}, prompt = '', defaultModel = 'llama2', minAutoSizeB = 0, modelRules = DEFAULT_MODEL_RULES } = {}) {
  const installed = installedModels
    .map(normalizeInstalledModelName)
    .map(model => String(model || '').trim())
    .filter(Boolean);

  if (!isAutoModel(requestedModel)) {
    return {
      requestedModel: requestedModel || defaultModel,
      model: requestedModel || defaultModel,
      auto: false,
      reason: 'Manual model selection.'
    };
  }

  const targetSizeB = Math.max(minAutoSizeB, estimateRequiredModelSizeB({ prompt, route, modelRules }));
  const preferred = preferredInstalledModels(installed).filter(model => modelFamilyRank(model) <= 2);
  const chosen = preferred.find(model => parseModelSizeB(model) >= targetSizeB)
    || preferred[preferred.length - 1]
    || installed.find(model => model === defaultModel)
    || installed[0]
    || defaultModel;

  return {
    requestedModel: AUTO_MODEL_VALUE,
    model: chosen,
    auto: true,
    targetSizeB,
    candidates: preferred,
    reason: preferred.length
      ? `AUTO selected the smallest installed Qwen-family model at or above ${targetSizeB}B for this prompt.`
      : 'AUTO used the first installed model because no Qwen-family models were installed.'
  };
}

module.exports = {
  AUTO_MODEL_VALUE,
  BOB_ROUTER_SKILLS,
  DEFAULT_MODEL_RULES,
  buildBobRouterEnvelope,
  buildBobModelRouterPrompt,
  buildBobRouterPrompt,
  cleanReason,
  defaultRouteReason,
  heuristicBobRoute,
  isAutoModel,
  isPlaceholderReason,
  parseBobModelRouterContract,
  parseBobRouterContract,
  parseModelSizeB,
  sanitizeModelRules,
  selectBobModel,
  selectRouterModel
};
