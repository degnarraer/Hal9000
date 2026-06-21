// Extracted from menu.js. Loaded after public/menu.js.
function initMemory() {
  byId('refreshMemory')?.addEventListener('click', fetchMemoryManager);
  fetchMemoryManager();
  startMemoryAutoRefresh();
}

async function fetchMemoryManager({ silent = false } = {}) {
  const status = byId('memoryStatus');
  if (status && !silent) status.textContent = 'Loading live memory...';

  try {
    const response = await fetch('/api/memory/manager?limit=100', { cache: 'no-store' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Memory manager unavailable');
    renderMemoryManager(json.data || {});
    if (status) status.textContent = `Live memory updated ${formatTime(new Date().toISOString())}.`;
  } catch (err) {
    if (status) status.textContent = 'Memory error: ' + err.message;
  }
}

function renderMemoryManager(data) {
  renderMemorySummaries(data.summaries || {});
  renderMemoryFactoids(data.factoids || []);
  renderMemoryMessages(data.messages || []);
}

function renderMemorySummaries(summaries) {
  ['short', 'medium', 'long'].forEach(scope => {
    const summary = summaries[scope] || {};
    const text = byId(`memorySummary${capitalize(scope)}`);
    const meta = byId(`memoryMeta${capitalize(scope)}`);
    if (text) text.textContent = summary.summary || 'No summary yet. HAL will form this memory automatically as the conversation grows.';
    if (meta) {
      const updated = summary.updatedAt ? formatTime(summary.updatedAt) : 'never';
      meta.textContent = `${summary.sourceMessageCount || 0} messages - ${summary.model || 'no model'} - updated ${updated}`;
    }
  });
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
      <div class="memory-row-header">
        <strong>${escapeHtml(message.role || 'message')} ${message.model ? `- ${escapeHtml(message.model)}` : ''}</strong>
        <button class="memory-delete-btn" type="button" data-delete-memory-message="${escapeHtml(message.id)}" aria-label="Delete chat memory item" title="Delete chat memory item">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
      <p>${escapeHtml(message.content || '')}</p>
      <small>${escapeHtml(formatTime(message.created_at || message.createdAt))}</small>
    </div>
  `).join('');
  target.querySelectorAll('[data-delete-memory-message]').forEach(button => {
    button.addEventListener('click', () => deleteMemoryItem('messages', button.dataset.deleteMemoryMessage));
  });
  window.__icons?.render?.(target);
}

function renderMemoryFactoids(factoids) {
  const target = byId('memoryFactoids');
  if (!target) return;
  if (!factoids.length) {
    target.innerHTML = '<div class="empty">No user factoids learned yet</div>';
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

