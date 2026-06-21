// Extracted from menu.js. Loaded after public/menu.js.
function initWebSearchSkill() {
  byId('runWebSearchSkill')?.addEventListener('click', runWebSearchSkillPage);
  byId('webSearchQuery')?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      runWebSearchSkillPage();
    }
  });
}

async function runWebSearchSkillPage() {
  const input = byId('webSearchQuery');
  const status = byId('webSearchStatus');
  const output = byId('webSearchOutput');
  const sources = byId('webSearchSources');
  const button = byId('runWebSearchSkill');
  const query = input?.value.trim();

  if (!query) {
    if (status) status.textContent = 'Enter a topic or question first.';
    input?.focus();
    return;
  }

  const model = localStorage.getItem('selectedModel') || document.getElementById('model')?.value;
  if (!model) {
    if (status) status.textContent = 'Install or select an Ollama model before running this skill.';
    return;
  }

  if (status) status.textContent = `Searching the web with ${model}...`;
  if (output) output.textContent = 'Working...';
  if (sources) sources.innerHTML = '';
  if (button) button.disabled = true;

  try {
    const response = await fetchWithAuthRedirect('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: `Search the web for ${query} and summarize`
      })
    });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Web search skill failed');
    const data = json.data || {};
    if (output) output.textContent = data.response || 'No summary returned.';
    renderWebSearchSources(data.sources || []);
    if (status) status.textContent = data.query ? `Summary complete for "${data.query}".` : 'Summary complete.';
  } catch (err) {
    if (status) status.textContent = 'Web search error: ' + err.message;
    if (output) output.textContent = '';
  } finally {
    if (button) button.disabled = false;
  }
}

function renderWebSearchSources(items) {
  const target = byId('webSearchSources');
  if (!target) return;
  if (!items.length) {
    target.innerHTML = '<div class="empty">No sources returned</div>';
    return;
  }

  target.innerHTML = items.map((item, index) => `
    <a class="web-search-source" href="${escapeHtml(item.url || '#')}" target="_blank" rel="noopener noreferrer">
      <strong>${index + 1}. ${escapeHtml(item.title || item.url || 'Source')}</strong>
      <span>${escapeHtml(item.url || '')}</span>
      <small>${escapeHtml(item.snippet || 'No snippet provided.')}</small>
    </a>
  `).join('');
}
