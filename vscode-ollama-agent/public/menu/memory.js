// Extracted from menu.js. Loaded after public/menu.js.
function initMemory() {
  byId('refreshMemory')?.addEventListener('click', fetchMemoryManager);
  byId('memoryRequirements')?.addEventListener('click', () => window.__menu?.load?.('memoryRequirements'));
  byId('wipeMemory')?.addEventListener('click', wipeMemory);
  fetchMemoryManager();
  startMemoryAutoRefresh();
}

function initMemoryRequirements() {
  byId('backToMemory')?.addEventListener('click', () => window.__menu?.load?.('memory'));
}

async function fetchMemoryManager({ silent = false } = {}) {
  const status = byId('memoryStatus');
  if (status && !silent) status.textContent = 'Loading live memory...';

  try {
    const response = await fetchWithAuthRedirect('/api/memory/manager?limit=100', { cache: 'no-store' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Memory manager unavailable');
    renderMemoryManager(json.data || {});
    if (status) status.textContent = `Live memory updated ${formatTime(new Date().toISOString())}.`;
  } catch (err) {
    if (status) status.textContent = 'Memory error: ' + err.message;
  }
}

function renderMemoryManager(data) {
  renderMemoryFactoids(data.factoids || []);
  renderMemoryMessages(data.messages || []);
}

function renderMemoryMessages(messages) {
  const target = byId('memoryMessages');
  if (!target) return;
  if (!messages.length) {
    target.innerHTML = '<div class="empty">No chat memory recorded yet</div>';
    return;
  }

  target.innerHTML = messages.map(message => `
    <div class="memory-message-row ${escapeHtml(message.role || 'user')}">
      <span class="memory-message-role">${escapeHtml(message.role || 'message')}</span>
      <span class="memory-message-model">${escapeHtml(message.model || 'no model')}</span>
      <time class="memory-message-time" datetime="${escapeHtml(memoryMessageDateTime(message) || '')}">${escapeHtml(formatTime(memoryMessageDateTime(message)))}</time>
      <span class="memory-message-emotion">${escapeHtml(memoryMessageEmotionLabel(message))}</span>
      <span class="memory-message-content" title="${escapeHtml(message.content || '')}">${escapeHtml(message.content || '')}</span>
      <button class="memory-delete-btn" type="button" data-delete-memory-message="${escapeHtml(message.id)}" aria-label="Delete chat memory item" title="Delete chat memory item">
        <i data-lucide="trash-2"></i>
      </button>
    </div>
  `).join('');
  target.querySelectorAll('[data-delete-memory-message]').forEach(button => {
    button.addEventListener('click', () => deleteMemoryItem('messages', button.dataset.deleteMemoryMessage));
  });
  window.__icons?.render?.(target);
}

function memoryMessageDateTime(message = {}) {
  return message.dateTime || message.created_at || message.createdAt || message.timestamp || '';
}

function memoryMessageEmotionLabel(message = {}) {
  const role = message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user';
  if (role === 'assistant') {
    return `assistantEmotion: ${message.assistantEmotion || message.emotion || message.metadata?.emotion || 'neutral'} (${formatEmotionIntensity(message.assistantEmotionIntensity ?? message.metadata?.assistantEmotionIntensity ?? message.metadata?.emotionIntensity)})`;
  }
  if (role === 'user') {
    return `detectedUserEmotion: ${message.detectedUserEmotion || message.metadata?.detectedUserEmotion || message.metadata?.emotion || 'neutral'} (${formatEmotionIntensity(message.detectedUserEmotionIntensity ?? message.metadata?.detectedUserEmotionIntensity ?? message.metadata?.emotionIntensity)})`;
  }
  return 'emotion: neutral (0.00)';
}

function formatEmotionIntensity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0.00';
  return Math.max(0, Math.min(1, number)).toFixed(2);
}

function renderMemoryFactoids(factoids) {
  const target = byId('memoryFactoids');
  if (!target) return;
  if (!factoids.length) {
    target.innerHTML = '<div class="empty">EMPTY</div>';
    return;
  }

  target.innerHTML = factoids.map(factoid => `
    <div class="memory-factoid-row">
      <div class="memory-row-header">
        <strong>${escapeHtml(factoid.category || 'general')}</strong>
        <button class="memory-delete-btn" type="button" data-delete-memory-factoid="${escapeHtml(factoid.id)}" aria-label="Delete factoid" title="Delete factoid">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
      <p>${escapeHtml(factoid.fact || '')}</p>
      <small>${escapeHtml(factoid.model || 'no model')} - confidence ${Math.round(Number(factoid.confidence || 0) * 100)}% - updated ${escapeHtml(formatTime(factoid.updatedAt || factoid.updated_at))}</small>
    </div>
  `).join('');
  target.querySelectorAll('[data-delete-memory-factoid]').forEach(button => {
    button.addEventListener('click', () => deleteMemoryItem('factoids', button.dataset.deleteMemoryFactoid));
  });
  window.__icons?.render?.(target);
}

async function deleteMemoryItem(kind, id) {
  if (!id) return;
  const status = byId('memoryStatus');
  const label = kind === 'factoids' ? 'factoid' : 'chat memory item';
  const confirmed = await window.__dialog.confirm({
    title: 'Delete Memory',
    message: `Delete this ${label}?`,
    confirmText: 'Delete',
    danger: true
  });
  if (!confirmed) return;
  if (status) status.textContent = `Deleting ${label}...`;

  try {
    const response = await fetchWithAuthRedirect(`/api/memory/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || `Could not delete ${label}`);
    await fetchMemoryManager({ silent: true });
  } catch (err) {
    if (status) status.textContent = `Memory delete error: ${err.message}`;
  }
}

function confirmMemoryWipe() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'hal-dialog-overlay';
    overlay.innerHTML = `
      <div class="hal-dialog memory-wipe-dialog" role="dialog" aria-modal="true" aria-labelledby="memoryWipeTitle">
        <div class="hal-dialog-header">
          <span class="hal-dialog-mark danger"><i data-lucide="triangle-alert"></i></span>
          <h2 id="memoryWipeTitle">Wipe Memory</h2>
        </div>
        <p>This permanently deletes Bob's saved chat messages, memory summaries, and user factoids for your account. This cannot be undone.</p>
        <label class="memory-wipe-confirm">
          <span>Type WIPE to confirm</span>
          <input id="memoryWipeConfirmInput" autocomplete="off" spellcheck="false" />
        </label>
        <div class="hal-dialog-actions">
          <button class="hal-dialog-secondary" type="button" data-dialog-cancel>Cancel</button>
          <button class="hal-dialog-primary danger" type="button" data-dialog-confirm disabled>Wipe Memory</button>
        </div>
      </div>
    `;

    const input = overlay.querySelector('#memoryWipeConfirmInput');
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
    window.__icons?.render?.(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    input.focus();
  });
}

async function wipeMemory() {
  const button = byId('wipeMemory');
  const status = byId('memoryStatus');
  const confirmed = await confirmMemoryWipe();
  if (!confirmed) return;

  button?.setAttribute('disabled', 'disabled');
  if (status) status.textContent = 'Wiping memory...';

  try {
    const response = await fetchWithAuthRedirect('/api/memory', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'WIPE' })
    });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Could not wipe memory');
    const deleted = json.data || {};
    if (status) {
      status.textContent = `Memory wiped: ${deleted.messages || 0} messages, ${deleted.summaries || 0} summaries, ${deleted.factoids || 0} factoids deleted.`;
    }
    await fetchMemoryManager({ silent: true });
    window.dispatchEvent(new CustomEvent('hal:memory-changed'));
  } catch (err) {
    if (status) status.textContent = `Memory wipe error: ${err.message}`;
  } finally {
    button?.removeAttribute('disabled');
  }
}

function startMemoryAutoRefresh() {
  stopMemoryAutoRefresh();
  memoryTimer = setInterval(() => {
    if (currentRoute === 'memory') fetchMemoryManager({ silent: true });
  }, 3000);
}

function stopMemoryAutoRefresh() {
  if (!memoryTimer) return;
  clearInterval(memoryTimer);
  memoryTimer = null;
}

