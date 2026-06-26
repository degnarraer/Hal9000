const messagesEl = document.getElementById('messages');
const input = document.getElementById('input');
const send = document.getElementById('send');
const clearChat = document.getElementById('clearChat');
const modelSelect = document.getElementById('model');
const refreshModels = document.getElementById('refreshModels');
const defaultModel = 'llama2';
const selectedModelKey = 'selectedModel';
const visibleChatClearedAtKey = 'visibleChatClearedAt';
const bobMutedKey = 'bobVoiceMuted';
let currentAudio;
let unlockedSpeechAudio;
let playbackRate = Number(localStorage.getItem('playbackRate') || '1');
let bobVoiceMuted = localStorage.getItem(bobMutedKey) === 'true';
let aiAudioCtx;
let aiAnalyser;
let aiDataArray;
let aiAnimationId;
let audioUnlocked = false;
let streamingSpeechActive = false;
let streamingSpeechBuffer = '';
let streamingSpeechQueue = [];
let streamingSpeechQueueActive = false;
let streamingSpeechGeneration = 0;
let ttsUnavailableReason = '';
const ANALYZED_TTS_FOR_CHAT = true;
let chatUserIsAdmin = false;

const aiWaveform = document.getElementById('aiWaveform');
const bobContextCanvas = document.getElementById('bobContextChart');
const bobContextStatus = document.getElementById('bobContextStatus');
const playbackSpeed = document.getElementById('playbackSpeed');
const stopBobSpeech = document.getElementById('stopBobSpeech');
const bobMuteToggle = document.getElementById('bobMuteToggle');
const bobMemoryBrain = document.getElementById('bobMemoryBrain');
const playbackRateLabel = document.getElementById('playbackRateLabel');
const playbackRates = [0.75, 1, 1.25, 1.5, 1.75, 2];
const bobExpression = window.BobExpressionEngine ? new window.BobExpressionEngine('#bobFace') : null;
let bobContextChart;
let bobContextChartPromise;
let bobContextRefreshTimer;
let bobContextDebounce;
let speechPlaybackGeneration = 0;

function showDialog({ title = 'Bob', message = '', confirmText = 'OK', cancelText = '', danger = false } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'hal-dialog-overlay';
    overlay.innerHTML = `
      <div class="hal-dialog" role="dialog" aria-modal="true" aria-labelledby="halDialogTitle">
        <div class="hal-dialog-header">
          <span class="hal-dialog-mark"><i data-lucide="${danger ? 'alert-triangle' : 'message-square'}"></i></span>
          <h2 id="halDialogTitle">${escapeDialogHtml(title)}</h2>
        </div>
        <p>${escapeDialogHtml(message)}</p>
        <div class="hal-dialog-actions">
          ${cancelText ? `<button class="hal-dialog-secondary" type="button" data-dialog-cancel>${escapeDialogHtml(cancelText)}</button>` : ''}
          <button class="hal-dialog-primary${danger ? ' danger' : ''}" type="button" data-dialog-confirm>${escapeDialogHtml(confirmText)}</button>
        </div>
      </div>
    `;

    const close = value => {
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      resolve(value);
    };
    const onKeyDown = event => {
      if (event.key === 'Escape') close(false);
      if (event.key === 'Enter') close(true);
    };

    overlay.querySelector('[data-dialog-confirm]')?.addEventListener('click', () => close(true));
    overlay.querySelector('[data-dialog-cancel]')?.addEventListener('click', () => close(false));
    overlay.addEventListener('pointerdown', event => {
      if (event.target === overlay) close(false);
    });
    document.addEventListener('keydown', onKeyDown);
    document.body.appendChild(overlay);
    renderIcons(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    overlay.querySelector('[data-dialog-confirm]')?.focus();
  });
}

function escapeDialogHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function memoryValue(value) {
  const text = String(value || '').trim();
  return text || 'EMPTY';
}

function memoryDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function memoryRoleLabel(role) {
  return String(role || 'user').toUpperCase();
}

function memoryMessageEmotion(message = {}) {
  const metadata = message.metadata || {};
  const label = message.role === 'assistant'
    ? message.assistantEmotion || message.emotion || metadata.assistantEmotion || metadata.emotion
    : message.detectedUserEmotion || metadata.detectedUserEmotion || metadata.emotion;
  const intensity = message.role === 'assistant'
    ? message.assistantEmotionIntensity ?? metadata.assistantEmotionIntensity ?? metadata.emotionIntensity
    : message.detectedUserEmotionIntensity ?? metadata.detectedUserEmotionIntensity ?? metadata.emotionIntensity;
  const normalized = Number(intensity);
  return `${label || 'neutral'} (${Number.isFinite(normalized) ? normalized.toFixed(2) : '0.00'})`;
}

function memorySummaryCard(scope, summary = {}) {
  return `
    <section class="bob-memory-section bob-memory-summary ${scope}">
      <h3>${escapeDialogHtml(scope)} term memory</h3>
      <pre>${escapeDialogHtml(memoryValue(summary.summary))}</pre>
      <small>${escapeDialogHtml([
        `${Number(summary.sourceMessageCount || 0)} messages`,
        summary.model || 'no model',
        summary.updatedAt || summary.updated_at ? `updated ${memoryDate(summary.updatedAt || summary.updated_at)}` : 'updated never'
      ].join(' - '))}</small>
    </section>
  `;
}

function memoryDialogHtml(data = {}) {
  const messages = Array.isArray(data.messages) ? data.messages : [];
  const factoids = Array.isArray(data.factoids) ? data.factoids : [];
  const summaries = data.summaries || {};
  const messageRows = messages.length ? messages.map(message => `
    <div class="bob-memory-row ${escapeDialogHtml(message.role || 'user')}">
      <strong>${escapeDialogHtml(memoryRoleLabel(message.role))}</strong>
      <span>${escapeDialogHtml(message.model || 'no model')}</span>
      <time>${escapeDialogHtml(memoryDate(message.dateTime || message.created_at || message.createdAt))}</time>
      <span>${escapeDialogHtml(memoryMessageEmotion(message))}</span>
      <p>${escapeDialogHtml(message.content || '')}</p>
    </div>
  `).join('') : '<div class="bob-memory-empty">No chat memory recorded.</div>';
  const factoidRows = factoids.length ? factoids.map(factoid => `
    <div class="bob-memory-factoid">
      <strong>${escapeDialogHtml(factoid.category || 'general')}</strong>
      <p>${escapeDialogHtml(factoid.fact || '')}</p>
      <small>${escapeDialogHtml([
        factoid.model || 'no model',
        `confidence ${Math.round(Number(factoid.confidence || 0) * 100)}%`,
        factoid.updatedAt || factoid.updated_at ? `updated ${memoryDate(factoid.updatedAt || factoid.updated_at)}` : ''
      ].filter(Boolean).join(' - '))}</small>
    </div>
  `).join('') : '<div class="bob-memory-empty">No factoid memory recorded.</div>';

  return `
    <div class="bob-memory-dialog" role="dialog" aria-modal="true" aria-labelledby="bobMemoryTitle">
      <div class="bob-memory-header">
        <span class="bob-memory-mark"><i data-lucide="brain"></i></span>
        <h2 id="bobMemoryTitle">Bob Memory</h2>
        <button class="bob-memory-wipe" type="button" aria-label="Wipe Bob memory" title="Wipe Bob memory">
          <i data-lucide="database-zap"></i>
          Wipe Memory
        </button>
        <button class="bob-memory-close" type="button" aria-label="Close Bob memory"><i data-lucide="x"></i></button>
      </div>
      <div class="bob-memory-grid">
        <section class="bob-memory-section bob-memory-chat">
          <h3>Chat memory</h3>
          <div class="bob-memory-scroll">${messageRows}</div>
        </section>
        <section class="bob-memory-section bob-memory-facts">
          <h3>Factoid memory</h3>
          <div class="bob-memory-scroll">${factoidRows}</div>
        </section>
        ${memorySummaryCard('short', summaries.short)}
        ${memorySummaryCard('medium', summaries.medium)}
        ${memorySummaryCard('long', summaries.long)}
      </div>
    </div>
  `;
}

function confirmBobMemoryWipe() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'hal-dialog-overlay';
    overlay.innerHTML = `
      <div class="hal-dialog memory-wipe-dialog" role="dialog" aria-modal="true" aria-labelledby="bobMemoryWipeTitle">
        <div class="hal-dialog-header">
          <span class="hal-dialog-mark danger"><i data-lucide="triangle-alert"></i></span>
          <h2 id="bobMemoryWipeTitle">Wipe Memory</h2>
        </div>
        <p>This permanently deletes Bob's saved chat messages, memory summaries, and user factoids for your account. This cannot be undone.</p>
        <label class="memory-wipe-confirm">
          <span>Type WIPE to confirm</span>
          <input id="bobMemoryWipeConfirmInput" autocomplete="off" spellcheck="false" />
        </label>
        <div class="hal-dialog-actions">
          <button class="hal-dialog-secondary" type="button" data-dialog-cancel>Cancel</button>
          <button class="hal-dialog-primary danger" type="button" data-dialog-confirm disabled>Wipe Memory</button>
        </div>
      </div>
    `;

    const input = overlay.querySelector('#bobMemoryWipeConfirmInput');
    const confirm = overlay.querySelector('[data-dialog-confirm]');
    const close = value => {
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      resolve(value);
    };
    const onKeyDown = event => {
      if (event.key === 'Escape') close(false);
      if (event.key === 'Enter' && input.value === 'WIPE') close(true);
    };

    input.addEventListener('input', () => {
      confirm.disabled = input.value !== 'WIPE';
    });
    confirm.addEventListener('click', () => close(input.value === 'WIPE'));
    overlay.querySelector('[data-dialog-cancel]')?.addEventListener('click', () => close(false));
    overlay.addEventListener('pointerdown', event => {
      if (event.target === overlay) close(false);
    });
    document.addEventListener('keydown', onKeyDown);
    document.body.appendChild(overlay);
    renderIcons(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    input.focus();
  });
}

async function fetchBobMemoryDialogData() {
  const response = await fetch('/api/memory/manager?limit=100&factoidLimit=100', { cache: 'no-store' });
  const json = await response.json();
  if (!json.ok) throw new Error(json.error || 'Memory unavailable');
  return json.data || {};
}

function attachBobMemoryDialogEvents(overlay, close) {
  overlay.querySelector('.bob-memory-close')?.addEventListener('click', close);
  overlay.querySelector('.bob-memory-wipe')?.addEventListener('click', async () => {
    const button = overlay.querySelector('.bob-memory-wipe');
    const confirmed = await confirmBobMemoryWipe();
    if (!confirmed) return;

    button?.setAttribute('disabled', 'disabled');
    try {
      const response = await fetch('/api/memory', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'WIPE' })
      });
      const json = await response.json();
      if (!json.ok) throw new Error(json.error || 'Could not wipe memory');
      const data = await fetchBobMemoryDialogData();
      overlay.innerHTML = memoryDialogHtml(data);
      attachBobMemoryDialogEvents(overlay, close);
      renderIcons(overlay);
      window.dispatchEvent(new CustomEvent('hal:memory-changed'));
    } catch (err) {
      window.__dialog?.alert?.({
        title: 'Memory Wipe Failed',
        message: err.message,
        danger: true
      });
    } finally {
      button?.removeAttribute('disabled');
    }
  });
}

async function openBobMemoryDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'bob-memory-overlay';
  overlay.innerHTML = `
    <div class="bob-memory-dialog loading" role="dialog" aria-modal="true" aria-labelledby="bobMemoryTitle">
      <div class="bob-memory-header">
        <span class="bob-memory-mark"><i data-lucide="brain"></i></span>
        <h2 id="bobMemoryTitle">Bob Memory</h2>
        <button class="bob-memory-close" type="button" aria-label="Close Bob memory"><i data-lucide="x"></i></button>
      </div>
      <div class="bob-memory-loading">Loading memory...</div>
    </div>
  `;

  const close = () => {
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
  };
  const onKeyDown = event => {
    if (event.key === 'Escape') close();
  };
  overlay.addEventListener('pointerdown', event => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(overlay);
  renderIcons(overlay);
  attachBobMemoryDialogEvents(overlay, close);

  try {
    const data = await fetchBobMemoryDialogData();
    overlay.innerHTML = memoryDialogHtml(data);
    attachBobMemoryDialogEvents(overlay, close);
    renderIcons(overlay);
  } catch (err) {
    overlay.querySelector('.bob-memory-loading').textContent = `Memory error: ${err.message}`;
  }
}

window.__bobMemoryDialog = { open: openBobMemoryDialog };

window.__dialog = {
  alert: options => showDialog({ confirmText: 'OK', ...(typeof options === 'string' ? { message: options } : options) }),
  confirm: options => showDialog({ confirmText: 'Confirm', cancelText: 'Cancel', ...(typeof options === 'string' ? { message: options } : options) })
};

function renderIcons(root = document) {
  if (!window.lucide?.createIcons) return;
  window.lucide.createIcons({
    icons: window.lucide.icons,
    root,
    attrs: {
      width: 18,
      height: 18,
      'stroke-width': 2,
    },
  });
}

function formatSkillLabel(skill) {
  return String(skill || '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeSkills(metadata = {}) {
  const raw = Array.isArray(metadata) ? metadata : metadata.skills || metadata.skill || [];
  const skills = (Array.isArray(raw) ? raw : [raw])
    .map(skill => String(skill || '').trim())
    .filter(Boolean);
  const debugSkills = Array.isArray(metadata.skillDebug)
    ? metadata.skillDebug.map(entry => String(entry?.skill || '').trim()).filter(Boolean)
    : [];
  debugSkills.forEach(skill => skills.push(skill));
  return [...new Set(skills)];
}

function normalizeDebugKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function skillDebugEntries(metadata = {}, type = '') {
  const entries = Array.isArray(metadata.skillDebug) ? metadata.skillDebug : [];
  return entries.filter(entry => {
    if (!entry || !entry.skill || entry.value === undefined || entry.value === null) return false;
    if (!String(entry.value).trim()) return false;
    return !type || entry.type === type;
  });
}

function formatDebugValue(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function normalizeCitations(data = {}) {
  const candidates = [
    data.sources,
    data.results,
    data.metadata?.sources,
    data.metadata?.results,
    data.outputContract?.output?.sources,
    data.outputContract?.sources
  ];
  const raw = candidates.find(value => Array.isArray(value)) || [];
  return raw
    .filter(source => source && (source.url || source.title || source.snippet))
    .map(source => ({
      title: String(source.title || source.url || 'Source').trim(),
      url: String(source.url || '').trim(),
      snippet: String(source.snippet || '').trim()
    }));
}

function formatCitationsValue(sources = []) {
  return sources.map((source, index) => [
    `#${index + 1} ${source.title || 'Source'}`,
    source.url || '(no url)',
    source.snippet ? `Snippet: ${source.snippet}` : ''
  ].filter(Boolean).join('\n')).join('\n\n');
}

function combinedSkillDebugText(metadata = {}) {
  const entries = Array.isArray(metadata.skillDebug) ? metadata.skillDebug : [];
  if (entries.length > 0) {
    const grouped = new Map();
    entries.forEach(entry => {
      if (!entry?.skill || entry.value === undefined || entry.value === null || !String(entry.value).trim()) return;
      if (!grouped.has(entry.skill)) grouped.set(entry.skill, []);
      grouped.get(entry.skill).push(entry);
    });

    return [...grouped.entries()].map(([skill, skillEntries]) => {
      const input = skillEntries.find(entry => entry.type === 'input');
      const output = skillEntries.find(entry => entry.type === 'output');
      const sections = [`================ ${formatSkillLabel(skill).toUpperCase()} ================`];
      if (input) {
        sections.push(`---- ${formatSkillLabel(skill).toUpperCase()} INPUT ----`, formatDebugValue(input.value));
      }
      if (output) {
        sections.push(`---- ${formatSkillLabel(skill).toUpperCase()} OUTPUT ----`, formatDebugValue(output.value));
      }
      return sections.join('\n');
    }).filter(Boolean).join('\n\n');
  }

  const legacy = [];
  if (metadata.ollamaInput) legacy.push('================ OLLAMA ================', '---- OLLAMA INPUT ----', formatDebugValue(metadata.ollamaInput));
  if (metadata.ollamaOutput) legacy.push('---- OLLAMA OUTPUT ----', formatDebugValue(metadata.ollamaOutput));
  return legacy.join('\n');
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', 'readonly');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

function setMessageSkills(el, metadata = {}) {
  const skills = normalizeSkills(metadata);
  if (!el || skills.length === 0) return;
  el.dataset.skills = skills.join(',');
  let rail = el.querySelector('.skill-rail');
  if (!rail) {
    rail = document.createElement('div');
    rail.className = 'skill-rail';
    el.prepend(rail);
  }
  rail.innerHTML = '';
  const inputsBySkill = new Map(skillDebugEntries(metadata, 'input').map(entry => [entry.skill, entry]));
  skills.forEach(skill => {
    const inputDebug = inputsBySkill.get(skill);
    const pill = document.createElement(inputDebug && chatUserIsAdmin ? 'button' : 'span');
    pill.className = 'skill-pill';
    pill.textContent = formatSkillLabel(skill);
    if (inputDebug && chatUserIsAdmin) {
      pill.type = 'button';
      pill.dataset.debugKey = normalizeDebugKey(`${skill}-input`);
      pill.dataset.debugValue = typeof inputDebug.value === 'string' ? inputDebug.value : JSON.stringify(inputDebug.value, null, 2);
      pill.dataset.debugLabel = String(inputDebug.label || `${formatSkillLabel(skill)} input`).toUpperCase();
      pill.title = pill.dataset.debugLabel;
    }
    rail.appendChild(pill);
  });
}

function setMessageCitations(el, data = {}) {
  if (!el) return;
  const sources = normalizeCitations(data);
  let rail = el.querySelector('.citation-rail');
  if (sources.length === 0) {
    rail?.remove();
    return;
  }

  if (!rail) {
    rail = document.createElement('div');
    rail.className = 'citation-rail';
    el.appendChild(rail);
  }

  rail.innerHTML = '';
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'citation-pill';
  pill.textContent = sources.length === 1 ? 'CITATION' : `CITATIONS ${sources.length}`;
  pill.title = 'Citations used';
  pill.dataset.citationsValue = formatCitationsValue(sources);
  rail.appendChild(pill);
}

function setMessageOllamaDebug(el, metadata = {}) {
  if (!el || !chatUserIsAdmin) return;
  const skillDebug = Array.isArray(metadata.skillDebug) ? metadata.skillDebug : [];
  const entries = skillDebug.length
    ? skillDebugEntries(metadata, 'output').map(entry => [
        String(entry.label || `${formatSkillLabel(entry.skill)} ${entry.type || 'debug'}`).toUpperCase(),
        entry.value,
        `${entry.skill || 'skill'}-${entry.type || 'debug'}`
      ])
    : [
        ['OLLAMA INPUT', metadata.ollamaInput, 'ollama-input'],
        ['OLLAMA OUTPUT', metadata.ollamaOutput, 'ollama-output']
      ];
  const visibleEntries = entries.filter(([, value]) => value !== undefined && value !== null && String(value).trim());

  if (skillDebugEntries(metadata, 'input').length > 0) {
    setMessageSkills(el, metadata);
  }

  if (visibleEntries.length === 0) return;

  let rail = el.querySelector('.ollama-debug-rail');
  if (!rail) {
    rail = document.createElement('div');
    rail.className = 'ollama-debug-rail';
    el.appendChild(rail);
  }

  const nextKeys = new Set(visibleEntries.map(([label, , rawKey]) => normalizeDebugKey(rawKey || label)));
  rail.querySelectorAll('.ollama-debug-pill').forEach(pill => {
    if (!nextKeys.has(pill.dataset.debugKey)) pill.remove();
  });

  visibleEntries.forEach(([label, value, rawKey]) => {
    const key = normalizeDebugKey(rawKey || label);
    let pill = rail.querySelector(`[data-debug-key="${key}"]`);
    if (!pill) {
      pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'ollama-debug-pill';
      pill.dataset.debugKey = key;
      pill.textContent = label;
      rail.appendChild(pill);
    }
    pill.dataset.debugValue = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  });

  const combinedDebug = combinedSkillDebugText(metadata);
  if (combinedDebug) {
    let copyPill = rail.querySelector('[data-debug-key="copy-debug"]');
    if (!copyPill) {
      copyPill = document.createElement('button');
      copyPill.type = 'button';
      copyPill.className = 'ollama-debug-pill debug-copy-pill';
      copyPill.dataset.debugKey = 'copy-debug';
      copyPill.textContent = 'COPY DEBUG';
      rail.prepend(copyPill);
    }
    copyPill.dataset.copyDebug = combinedDebug;
  }
}

const supportedBobEmotions = new Set([
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

function normalizeBobEmotion(value) {
  const emotion = String(value || '').trim().toLowerCase();
  return supportedBobEmotions.has(emotion) ? emotion : '';
}

function applyBobMetadata(el, metadata = {}) {
  if (!el || !metadata || typeof metadata !== 'object') return;
  const emotion = normalizeBobEmotion(metadata.emotion);
  if (emotion) {
    el.dataset.emotion = emotion;
    bobExpression?.setEmotion(emotion);
  }
  el.classList.toggle('memory-processed', Boolean(metadata.memoryProcessed));
  if (metadata.memoryProcessed) el.title = 'This response has dropped out of Bob prompt memory.';
}

function showOllamaDebug(label, value) {
  window.__dialog.alert({
    title: label,
    message: value || '(empty)'
  });
}

function setMessageText(el, text) {
  if (!el) return;
  let body = el.querySelector('.msg-body');
  if (!body) {
    body = document.createElement('span');
    body.className = 'msg-body';
    el.appendChild(body);
  }
  body.textContent = text;
  if (el.classList.contains('bot')) el.dataset.speakText = text || '';
}

function addMessage(role, text, metadata = {}) {
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
  setMessageText(div, text);
  if (role !== 'user') {
    div.tabIndex = 0;
    div.setAttribute('role', 'button');
    div.setAttribute('aria-label', 'Replay Bob response');
    div.title = 'Replay Bob response';
    div.dataset.speakText = text || '';
    setMessageSkills(div, metadata);
    setMessageCitations(div, metadata);
    setMessageOllamaDebug(div, metadata);
    applyBobMetadata(div, metadata);
  }
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

async function loadChatAdminState() {
  try {
    const response = await fetch('/api/auth/me', { cache: 'no-store' });
    const json = await response.json();
    chatUserIsAdmin = Boolean(json.ok && json.data?.isAdmin);
  } catch (err) {
    chatUserIsAdmin = false;
  }
  document.body.classList.toggle('chat-admin', chatUserIsAdmin);
}

async function loadMemoryHistory() {
  try {
    const response = await fetch('/api/memory/history?limit=24', { cache: 'no-store' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Memory history unavailable');
    const clearedAt = Date.parse(localStorage.getItem(visibleChatClearedAtKey) || '');
    messagesEl.innerHTML = '';
    (json.data || [])
      .filter(row => !Number.isFinite(clearedAt) || Date.parse(row.created_at) > clearedAt)
      .forEach(row => {
        addMessage(row.role === 'assistant' ? 'bot' : 'user', row.content, row.metadata || {});
      });
  } catch (err) {
    console.warn('Failed to load memory history', err);
  }
}

async function clearVisibleChat() {
  if (!messagesEl.children.length) return;
  const shouldClear = await window.__dialog.confirm({
    title: 'Clear Chat',
    message: 'Clear the visible chat? Saved memory is not deleted.',
    confirmText: 'Clear',
    danger: true
  });
  if (!shouldClear) return;
  localStorage.setItem(visibleChatClearedAtKey, new Date().toISOString());
  messagesEl.innerHTML = '';
}

function shouldIgnoreBubbleReplay(target) {
  return Boolean(target?.closest?.('button,a,[data-ollama-debug]'));
}

function replayBobBubble(bubble) {
  const text = bubble?.dataset?.speakText || bubble?.querySelector?.('.msg-body')?.textContent || '';
  if (text.trim()) speakText(text);
}

async function sendMessage() {
  const prompt = input.value.trim();
  return sendPrompt(prompt);
}

function getSelectedModel() {
  return modelSelect?.value || '';
}

function normalizeModelName(item) {
  if (typeof item === 'string') return item;
  return item?.name || item?.model || '';
}

async function loadChatModels() {
  if (!modelSelect) return;

  const previousValue = localStorage.getItem(selectedModelKey) || modelSelect.value || defaultModel;
  modelSelect.disabled = true;

  try {
    const resp = await fetch('/api/ollama/models', { cache: 'no-store' });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Could not load models');

    const models = (json.data || [])
      .map(normalizeModelName)
      .filter(Boolean);

    modelSelect.innerHTML = '';

    if (models.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No models installed';
      modelSelect.appendChild(option);
      modelSelect.value = '';
      send.disabled = true;
      return;
    }

    models.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      modelSelect.appendChild(option);
    });

    modelSelect.value = models.includes(previousValue) ? previousValue : models[0];
    localStorage.setItem(selectedModelKey, modelSelect.value);
    send.disabled = false;
  } catch (err) {
    console.warn('Failed to load chat models', err);
    if (!modelSelect.options.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Models unavailable';
      modelSelect.appendChild(option);
    }
    send.disabled = true;
  } finally {
    modelSelect.disabled = false;
  }
}

function loadBobContextChartJs() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (!bobContextChartPromise) {
    bobContextChartPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/chart.js/chart.umd.min.js';
      script.onload = () => resolve(window.Chart);
      script.onerror = () => reject(new Error('Chart.js failed to load'));
      document.head.appendChild(script);
    });
  }
  return bobContextChartPromise;
}

function scheduleBobContextRefresh(delay = 250) {
  clearTimeout(bobContextDebounce);
  bobContextDebounce = setTimeout(() => refreshBobContextUsage({ silent: true }), delay);
}

async function refreshBobContextUsage({ silent = false } = {}) {
  if (!bobContextCanvas || !bobContextStatus) return;
  const model = getSelectedModel();
  if (!model) {
    updateBobContextStatus({ message: 'No model', state: 'idle' });
    return;
  }
  if (!silent) updateBobContextStatus({ message: 'Checking', state: 'idle' });

  try {
    const params = new URLSearchParams({
      model,
      prompt: input?.value || ''
    });
    const response = await fetch(`/api/memory/context?${params.toString()}`, { cache: 'no-store' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Context unavailable');
    await renderBobContextChart(json.data || {});
  } catch (err) {
    updateBobContextStatus({ message: 'CTX offline', state: 'idle' });
    console.warn('Bob context usage unavailable', err);
  }
}

async function renderBobContextChart(data) {
  if (!bobContextCanvas || !bobContextStatus) return;
  const Chart = await loadBobContextChartJs();
  const actual = Number(data.actualInputTokens);
  const estimate = Math.max(0, Number(data.estimatedInputTokens ?? data.inputTokens ?? 0));
  const hasActual = Number.isFinite(actual) && actual >= 0;
  const used = hasActual ? actual : estimate;
  const max = Math.max(1, Number(data.modelContextTokens || 1));
  const remaining = Math.max(0, max - used);
  const trigger = Math.max(0, Number(data.triggerTokens || 0));
  const percent = Math.min(100, Math.round((used / max) * 100));
  const updating = Boolean(data.updating);
  const due = Boolean(data.updateDue);
  const barColor = updating
    ? 'rgba(0,224,255,0.78)'
    : due || used >= trigger
      ? 'rgba(255,154,90,0.78)'
      : 'rgba(124,92,255,0.72)';

  updateBobContextStatus({
    message: updating
      ? 'Updating memory'
      : due
        ? `Memory due ${percent}%`
        : `${Math.round(used)}/${max} ${hasActual ? 'actual' : 'est'}`,
    state: updating ? 'updating' : due ? 'due' : 'idle'
  });

  const config = {
    type: 'bar',
    data: {
      labels: ['CTX'],
      datasets: [
        {
          label: 'Used',
          data: [used],
          backgroundColor: barColor,
          borderColor: barColor,
          borderWidth: 1,
          borderRadius: 4,
          barPercentage: 0.82,
          categoryPercentage: 1,
          stack: 'ctx'
        },
        {
          label: 'Free',
          data: [remaining],
          backgroundColor: 'rgba(255,255,255,0.055)',
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          borderRadius: 4,
          barPercentage: 0.82,
          categoryPercentage: 1,
          stack: 'ctx'
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: context => `${context.dataset.label}: ${Math.round(context.raw)} tokens`,
            afterBody: () => [
              `Estimate: ${Math.round(estimate)} tokens`,
              hasActual ? `Actual updated: ${data.actualUpdatedAt || 'latest turn'}` : 'Actual: waiting for Bob turn',
              `Trigger: ${trigger} tokens`,
              `Memory pressure: ${Math.round(Number(data.memoryPressureTokens || 0))}/${Math.round(Number(data.memoryPressureTriggerTokens || 0))}`,
              `Method: ${data.tokenMethod || 'unknown'}`
            ]
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          min: 0,
          max,
          display: false,
          grid: { display: false }
        },
        y: {
          stacked: true,
          display: false,
          grid: { display: false },
          border: { display: false }
        }
      }
    }
  };

  if (bobContextChart) {
    bobContextChart.data = config.data;
    bobContextChart.options = config.options;
    bobContextChart.update();
    return;
  }

  bobContextChart = new Chart(bobContextCanvas, config);
}

function updateBobContextStatus({ message, state }) {
  if (!bobContextStatus) return;
  const meta = bobContextStatus.closest('.bob-context-meta');
  bobContextStatus.textContent = message || 'CTX';
  meta?.classList.toggle('memory-due', state === 'due');
  meta?.classList.toggle('memory-updating', state === 'updating');
}

function renderBobContextFromMetadata(metadata = {}) {
  const ctx = metadata?.ctx;
  if (!ctx || typeof ctx !== 'object') return;
  renderBobContextChart({
    actualInputTokens: ctx.Actual,
    estimatedInputTokens: ctx.Estimated,
    inputTokens: ctx.Actual ?? ctx.Estimated,
    modelContextTokens: ctx.modelContextTokens,
    triggerTokens: ctx.triggerTokens,
    tokenMethod: ctx.tokenMethod || 'bob-response-metadata'
  });
}

function startBobContextMonitor() {
  refreshBobContextUsage();
  if (bobContextRefreshTimer) clearInterval(bobContextRefreshTimer);
  bobContextRefreshTimer = null;
}

function unlockAudio() {
  try {
    aiAudioCtx = aiAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (aiAudioCtx.state === 'suspended') aiAudioCtx.resume();
    unlockMediaPlayback();
  } catch (err) {
    console.warn('Audio unlock failed', err);
  }
}

function unlockMediaPlayback() {
  unlockedSpeechAudio = unlockedSpeechAudio || new Audio();
  unlockedSpeechAudio.muted = true;
  unlockedSpeechAudio.playsInline = true;
  if (!unlockedSpeechAudio.src) {
    unlockedSpeechAudio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';
  }

  if (audioUnlocked) return;

  unlockedSpeechAudio.play()
    .then(() => {
      unlockedSpeechAudio.pause();
      unlockedSpeechAudio.currentTime = 0;
      unlockedSpeechAudio.muted = bobVoiceMuted;
      audioUnlocked = true;
    })
    .catch(err => {
      if (err?.name !== 'AbortError') console.warn('Media playback unlock failed', err);
    });
}

function setPlaybackRate(rate) {
  playbackRate = playbackRates.includes(rate) ? rate : 1;
  localStorage.setItem('playbackRate', String(playbackRate));
  if (currentAudio) currentAudio.playbackRate = playbackRate;
  if (playbackRateLabel) playbackRateLabel.textContent = `${playbackRate}x`;

  playbackSpeed?.querySelector('[data-speed-step="-1"]')?.toggleAttribute('disabled', playbackRate === playbackRates[0]);
  playbackSpeed?.querySelector('[data-speed-step="1"]')?.toggleAttribute('disabled', playbackRate === playbackRates[playbackRates.length - 1]);
}

function stepPlaybackRate(direction) {
  const currentIndex = playbackRates.indexOf(playbackRate);
  const nextIndex = Math.min(playbackRates.length - 1, Math.max(0, currentIndex + direction));
  setPlaybackRate(playbackRates[nextIndex]);
}

function applyBobMuteState() {
  document.body.classList.toggle('bob-muted', bobVoiceMuted);
  bobMuteToggle?.setAttribute('aria-pressed', String(bobVoiceMuted));
  bobMuteToggle?.setAttribute('aria-label', bobVoiceMuted ? 'Unmute Bob voice' : 'Mute Bob voice');
  bobMuteToggle?.setAttribute('title', bobVoiceMuted ? 'Unmute Bob' : 'Mute Bob');
  if (currentAudio) currentAudio.muted = bobVoiceMuted;
  if (unlockedSpeechAudio) unlockedSpeechAudio.muted = bobVoiceMuted;
}

function toggleBobMute() {
  bobVoiceMuted = !bobVoiceMuted;
  localStorage.setItem(bobMutedKey, String(bobVoiceMuted));
  applyBobMuteState();
}

function stopSpeechPlayback() {
  speechPlaybackGeneration += 1;
  streamingSpeechGeneration += 1;
  streamingSpeechActive = false;
  streamingSpeechBuffer = '';
  streamingSpeechQueue = [];
  streamingSpeechQueueActive = false;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.removeAttribute('src');
    currentAudio.load?.();
    currentAudio = null;
  }
  if (aiAnimationId) {
    cancelAnimationFrame(aiAnimationId);
    aiAnimationId = null;
  }
  setAiVoiceActive(false);
  bobExpression?.idle();
}

function parseOllamaChunk(data) {
  try {
    const obj = JSON.parse(data);
    if (typeof obj.response === 'string') return obj.response;
    if (typeof obj.message?.content === 'string') return obj.message.content;
    if (Array.isArray(obj.output)) return obj.output.map(part => part?.content || '').join('');
    if (typeof obj === 'string') return obj;
  } catch (err) {
    return data;
  }

  return '';
}

function markTtsUnavailable(reason) {
  ttsUnavailableReason = reason || 'Text-to-speech unavailable';
  streamingSpeechQueue = [];
  streamingSpeechQueueActive = false;
  streamingSpeechActive = false;
  streamingSpeechBuffer = '';
  setAiVoiceActive(false);
}

async function fetchTtsManifest(text) {
  if (ttsUnavailableReason) throw new Error(ttsUnavailableReason);
  const params = window.__voicePreferences?.toParams
    ? window.__voicePreferences.toParams(null, text)
    : new URLSearchParams({ lang: 'en', text: text.slice(0, 4500) });
  params.set('visemes', '1');
  const response = await fetch(`/api/tts?${params.toString()}`, { cache: 'no-store' });
  const json = await response.json().catch(() => ({}));
  if (!json.ok) {
    const message = json.error || 'TTS request failed';
    if (response.status === 503) markTtsUnavailable(message);
    throw new Error(message);
  }
  return json;
}

async function speakText(text) {
  const clean = text.trim();
  if (!clean) return;

  try {
    stopSpeechPlayback();

    const j = await fetchTtsManifest(clean);
    const urls = j.items || j.urls || (j.url ? [j.url] : []);
    setAiVoiceActive(true);
    await playAudioUrls(urls, 0, speechPlaybackGeneration, clean);
    setAiVoiceActive(false);
  } catch (err) {
    if (ttsUnavailableReason) {
      speakWithBrowserVoice(clean);
    } else {
      setAiVoiceActive(false);
      console.warn('TTS error', err);
    }
  }
}

async function speakQueuedText(text, generation) {
  const clean = text.trim();
  if (!clean || generation !== streamingSpeechGeneration) return;

  try {
    const j = await fetchTtsManifest(clean);
    const urls = j.items || j.urls || (j.url ? [j.url] : []);
    setAiVoiceActive(true);
    await playAudioUrls(urls, 0, speechPlaybackGeneration, clean);
  } catch (err) {
    if (ttsUnavailableReason) {
      speakBrowserChunk(clean);
    } else {
      console.warn('Queued TTS error', err);
      setAiVoiceActive(false);
    }
  }
}

function speakWithBrowserVoice(text) {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
  window.speechSynthesis.cancel();
  speakBrowserChunk(text);
}

function speakBrowserChunk(text) {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return null;
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 4500));
  utterance.lang = 'en-US';
  utterance.rate = playbackRate;
  utterance.onstart = () => {
    setAiVoiceActive(true);
    bobExpression?.speakText?.(text, {
      durationMs: Math.max(650, text.length * 58 / Math.max(0.5, playbackRate))
    });
  };
  utterance.onend = () => {
    if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
      setAiVoiceActive(false);
      bobExpression?.idle();
    }
  };
  utterance.onerror = () => setAiVoiceActive(false);
  window.speechSynthesis.speak(utterance);
  return utterance;
}

function startStreamingSpeech() {
  if (ANALYZED_TTS_FOR_CHAT) {
    streamingSpeechGeneration += 1;
    streamingSpeechActive = true;
    streamingSpeechBuffer = '';
    streamingSpeechQueue = [];
    streamingSpeechQueueActive = false;
    bobExpression?.think();
    return true;
  }

  return false;
}

function queueStreamingSpeech(text) {
  if (!streamingSpeechActive || !text) return;

  streamingSpeechBuffer += text.replace(/\s+/g, ' ');
  if (ANALYZED_TTS_FOR_CHAT) {
    drainCompletedSentences();
    return;
  }

  const sentenceEnd = /[.!?]\s/.exec(streamingSpeechBuffer);
  const shouldSpeakLongChunk = streamingSpeechBuffer.length >= 180;
  if (!sentenceEnd && !shouldSpeakLongChunk) return;

  const chunkEnd = sentenceEnd ? sentenceEnd.index + 1 : streamingSpeechBuffer.lastIndexOf(' ', 180);
  const safeEnd = chunkEnd > 0 ? chunkEnd : streamingSpeechBuffer.length;
  const chunk = streamingSpeechBuffer.slice(0, safeEnd).trim();
  streamingSpeechBuffer = streamingSpeechBuffer.slice(safeEnd).trimStart();
}

function drainCompletedSentences() {
  while (true) {
    const match = /[.!?](?=\s|$)/.exec(streamingSpeechBuffer);
    const shouldSpeakLongChunk = !match && streamingSpeechBuffer.length >= 220;
    if (!match && !shouldSpeakLongChunk) return;

    const chunkEnd = match ? match.index + 1 : streamingSpeechBuffer.lastIndexOf(' ', 220);
    const safeEnd = chunkEnd > 0 ? chunkEnd : streamingSpeechBuffer.length;
    const chunk = streamingSpeechBuffer.slice(0, safeEnd).trim();
    streamingSpeechBuffer = streamingSpeechBuffer.slice(safeEnd).trimStart();
    if (chunk) enqueueAnalyzedSpeech(chunk);
  }
}

function enqueueAnalyzedSpeech(text) {
  streamingSpeechQueue.push({ text, generation: streamingSpeechGeneration });
  pumpAnalyzedSpeechQueue();
}

async function pumpAnalyzedSpeechQueue() {
  if (streamingSpeechQueueActive) return;
  streamingSpeechQueueActive = true;

  while (streamingSpeechQueue.length > 0) {
    const item = streamingSpeechQueue.shift();
    if (item.generation !== streamingSpeechGeneration) continue;
    await speakQueuedText(item.text, item.generation);
  }

  streamingSpeechQueueActive = false;
  if (!streamingSpeechActive && streamingSpeechQueue.length === 0) {
    setAiVoiceActive(false);
    bobExpression?.idle();
  }
}

function finishStreamingSpeech() {
  if (!streamingSpeechActive) return false;

  const finalChunk = streamingSpeechBuffer.trim();
  streamingSpeechBuffer = '';
  streamingSpeechActive = false;
  if (ANALYZED_TTS_FOR_CHAT) {
    if (finalChunk) enqueueAnalyzedSpeech(finalChunk);
    else if (!streamingSpeechQueueActive && streamingSpeechQueue.length === 0) {
      setAiVoiceActive(false);
      bobExpression?.idle();
    }
    return true;
  }
  return true;
}

function hasBrowserSpeechQueued() {
  return Boolean(window.speechSynthesis && (window.speechSynthesis.speaking || window.speechSynthesis.pending));
}

function playAudioUrls(urls, index = 0, generation = speechPlaybackGeneration, spokenText = '') {
  const item = urls[index];
  if (generation !== speechPlaybackGeneration || !item) {
    return Promise.resolve();
  }
  const url = typeof item === 'string' ? item : item.url;
  const mouthText = typeof item === 'string' ? spokenText : item.text || spokenText;
  const visemes = typeof item === 'string' ? [] : Array.isArray(item.visemes) ? item.visemes : [];

  return new Promise((resolve) => {
    currentAudio = index === 0 && unlockedSpeechAudio ? unlockedSpeechAudio : new Audio();
    currentAudio.pause();
    currentAudio.src = url;
    currentAudio.muted = bobVoiceMuted;
    currentAudio.preload = 'auto';
    currentAudio.playsInline = true;
    currentAudio.playbackRate = playbackRate;
    connectAiWaveform(currentAudio);
    bobExpression?.speakText?.(mouthText, { audio: currentAudio, visemes });
    currentAudio.onended = () => {
      bobExpression?.stopVisemeSpeech?.();
      resolve(playAudioUrls(urls, index + 1, generation, spokenText));
    };
    currentAudio.onerror = () => {
      bobExpression?.stopVisemeSpeech?.();
      resolve(playAudioUrls(urls, index + 1, generation, spokenText));
    };
    currentAudio.play().catch(async err => {
      console.warn('Audio playback was blocked or failed', err);
      try {
        if (aiAudioCtx?.state === 'suspended') await aiAudioCtx.resume();
        if (generation === speechPlaybackGeneration) await currentAudio.play();
      } catch (retryErr) {
        console.warn('Audio playback retry failed', retryErr);
        bobExpression?.stopVisemeSpeech?.();
      }
      resolve();
    });
  });
}

function connectAiWaveform(audio) {
  try {
    aiAudioCtx = aiAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (aiAudioCtx.state === 'suspended') aiAudioCtx.resume();

    const source = aiAudioCtx.createMediaElementSource(audio);
    aiAnalyser = aiAudioCtx.createAnalyser();
    aiAnalyser.fftSize = 1024;
    aiDataArray = new Uint8Array(aiAnalyser.fftSize);
    source.connect(aiAnalyser);
    aiAnalyser.connect(aiAudioCtx.destination);
    drawAiWaveform();
  } catch (err) {
    console.warn('AI waveform setup failed', err);
  }
}

function drawAiWaveform() {
  if (!aiAnalyser || !aiDataArray) return;

  const ctx = aiWaveform?.getContext('2d');
  const width = aiWaveform?.width || 320;
  const height = aiWaveform?.height || 80;
  aiAnalyser.getByteTimeDomainData(aiDataArray);

  if (ctx) {
    ctx.clearRect(0, 0, width, height);
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#b7a7ff';
  }

  const step = Math.max(1, Math.floor(aiDataArray.length / width));
  let x = 0;
  let level = 0;
  for (let i = 0; i < aiDataArray.length; i += step) {
    level += Math.abs(aiDataArray[i] - 128);
    const y = (aiDataArray[i] / 255) * height;
    if (ctx) {
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    x += 1;
  }
  if (ctx) ctx.stroke();
  bobExpression?.setMouthLevel(Math.min(1, (level / Math.max(1, x)) / 30));

  aiAnimationId = requestAnimationFrame(drawAiWaveform);
}

function setAiVoiceActive(isActive) {
  const panel = document.querySelector('.ai-voice');
  if (panel) panel.classList.toggle('active', isActive);
  if (isActive) bobExpression?.startSpeaking();

  if (!isActive && aiAnimationId) {
    cancelAnimationFrame(aiAnimationId);
    aiAnimationId = null;
  }
  if (!isActive) bobExpression?.stopSpeaking();
}

function sendPrompt(prompt) {
  if (!prompt) return;
  const model = getSelectedModel();
  if (!model) {
    addMessage('bot', 'No Bob models are installed. Open Models and install one before chatting.');
    return;
  }

  addMessage('user', prompt);
  input.value = '';
  bobExpression?.think();

  const url = `/api/stream?model=${encodeURIComponent(model)}&prompt=${encodeURIComponent(prompt)}`;

  const evt = new EventSource(url);
  const botEl = addMessage('bot', 'Thinking');
  let partial = '';
  const canSpeakStream = startStreamingSpeech();

  evt.onmessage = (e) => {
    const data = e.data;
    if (data === '[DONE]') { evt.close(); return; }
    const chunk = parseOllamaChunk(data);
    if (!chunk) return;
    partial += chunk;
    try {
      const parsed = JSON.parse(data);
      if (chunk && !botEl.dataset.skills) setMessageSkills(botEl, parsed);
      if (parsed.metadata) {
        setMessageSkills(botEl, parsed);
        setMessageCitations(botEl, parsed);
        setMessageOllamaDebug(botEl, parsed.metadata);
        applyBobMetadata(botEl, parsed.metadata);
      }
    } catch (err) {}
    setMessageText(botEl, partial);
    queueStreamingSpeech(chunk);
  };
  const handleSkillsEvent = (event) => {
    try {
      const parsed = JSON.parse(event.data || '{}');
      setMessageSkills(botEl, parsed);
    } catch (err) {}
  };
  evt.addEventListener('skill', handleSkillsEvent);
  evt.addEventListener('skills', handleSkillsEvent);
  evt.addEventListener('ollama-debug', (event) => {
    try {
      setMessageOllamaDebug(botEl, JSON.parse(event.data || '{}'));
    } catch (err) {}
  });
  evt.addEventListener('bob-response', (event) => {
    try {
      const parsed = JSON.parse(event.data || '{}');
      const response = String(parsed.response || '').trim();
      const metadata = parsed.metadata || {};
      const hadStreamedResponse = Boolean(partial);
      partial = response;
      setMessageText(botEl, response || 'Bob did not return a response.');
      setMessageSkills(botEl, parsed);
      setMessageCitations(botEl, parsed);
      setMessageOllamaDebug(botEl, metadata);
      applyBobMetadata(botEl, metadata);
      renderBobContextFromMetadata(metadata);
      if (response && !hadStreamedResponse) queueStreamingSpeech(response);
    } catch (err) {
      console.warn('Bob response contract parse failed', err);
    }
  });
  evt.addEventListener('bob-emotion', (event) => {
    try {
      const parsed = JSON.parse(event.data || '{}');
      const metadata = parsed.metadata || {};
      applyBobMetadata(botEl, metadata);
      setMessageOllamaDebug(botEl, metadata);
    } catch (err) {
      console.warn('Bob emotion update parse failed', err);
    }
  });
  evt.addEventListener('done', () => {
    evt.close();
    if (!finishStreamingSpeech() && !canSpeakStream) speakText(partial);
    if (canSpeakStream && !ANALYZED_TTS_FOR_CHAT && !hasBrowserSpeechQueued()) bobExpression?.idle();
    window.dispatchEvent(new CustomEvent('hal:memory-changed'));
  });
  evt.addEventListener('error', (event) => {
    console.error('SSE error', event);
    streamingSpeechActive = false;
    streamingSpeechBuffer = '';
    streamingSpeechQueue = [];
    streamingSpeechGeneration += 1;
    bobExpression?.setEmotion('concerned');
    if (event.data) {
      try {
        setMessageText(botEl, JSON.parse(event.data));
      } catch (err) {
        setMessageText(botEl, event.data);
      }
    } else if (!partial) {
      setMessageText(botEl, 'Bob did not return a response. Check the Monitor screen for service status.');
    }
    evt.close();
  });
}

send.addEventListener('click', () => {
  unlockAudio();
  sendMessage();
});
clearChat?.addEventListener('click', clearVisibleChat);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    unlockAudio();
    sendMessage();
  }
});
input.addEventListener('input', () => scheduleBobContextRefresh(350));

playbackSpeed?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-speed-step]');
  if (!button) return;
  stepPlaybackRate(Number(button.dataset.speedStep));
});
stopBobSpeech?.addEventListener('click', stopSpeechPlayback);
bobMuteToggle?.addEventListener('click', toggleBobMute);
bobMuteToggle?.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  toggleBobMute();
});
bobMemoryBrain?.addEventListener('click', () => openBobMemoryDialog());

modelSelect?.addEventListener('change', () => {
  localStorage.setItem(selectedModelKey, modelSelect.value);
  scheduleBobContextRefresh(50);
});

refreshModels?.addEventListener('click', loadChatModels);
messagesEl?.addEventListener('click', (event) => {
  const copyPill = event.target.closest?.('[data-copy-debug]');
  if (copyPill) {
    copyTextToClipboard(copyPill.dataset.copyDebug || '')
      .then(() => {
        const previous = copyPill.textContent;
        copyPill.textContent = 'COPIED';
        setTimeout(() => { copyPill.textContent = previous || 'COPY DEBUG'; }, 1200);
      })
      .catch(err => {
        console.warn('Debug copy failed', err);
        showOllamaDebug('Debug Copy Failed', copyPill.dataset.copyDebug || '');
      });
    return;
  }
  const citationPill = event.target.closest?.('.citation-pill');
  if (citationPill) {
    showOllamaDebug('Citations Used', citationPill.dataset.citationsValue || '');
    return;
  }
  const pill = event.target.closest?.('.ollama-debug-pill,.skill-pill[data-debug-value]');
  if (pill) {
    showOllamaDebug(pill.dataset.debugLabel || pill.textContent || 'Ollama Debug', pill.dataset.debugValue || '');
    return;
  }
  if (shouldIgnoreBubbleReplay(event.target)) return;
  const bubble = event.target.closest?.('.msg.bot');
  if (bubble) replayBobBubble(bubble);
});
messagesEl?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (shouldIgnoreBubbleReplay(event.target)) return;
  const bubble = event.target.closest?.('.msg.bot');
  if (!bubble) return;
  event.preventDefault();
  replayBobBubble(bubble);
});
window.addEventListener('hal:memory-changed', () => scheduleBobContextRefresh(300));

setPlaybackRate(playbackRate);
applyBobMuteState();
loadChatModels();
loadChatAdminState().finally(loadMemoryHistory);
startBobContextMonitor();
renderIcons();

window.__icons = { render: renderIcons };
window.__chat = { sendPrompt, speakText, unlockAudio, setPlaybackRate, loadModels: loadChatModels, loadMemoryHistory };
window.__bob = bobExpression;
