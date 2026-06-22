// Extracted from menu.js. Loaded after public/menu.js.
function initModels() {
  byId('installBtn')?.addEventListener('click', installModel);
  byId('saveOllamaConfig')?.addEventListener('click', saveOllamaConfig);
  fetchOllamaConfig();
  fetchModels();
  fetchAvailableModels();
}

async function fetchOllamaConfig() {
  const keepAlive = byId('ollamaKeepAlive');
  const status = byId('ollamaConfigStatus');
  if (!keepAlive) return;
  if (status) status.textContent = 'Loading Ollama config...';

  try {
    const resp = await fetch('/api/ollama/config', { cache: 'no-store' });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || JSON.stringify(json));
    keepAlive.value = json.data?.keepAlive || '5m';
    if (status) {
      status.textContent = `Ollama ${json.data?.url || 'URL unknown'} - default chat model ${json.data?.defaultModel || 'unknown'}`;
    }
  } catch (err) {
    if (status) status.textContent = 'Config error: ' + err.message;
  }
}

async function saveOllamaConfig() {
  const keepAlive = byId('ollamaKeepAlive')?.value || '5m';
  const status = byId('ollamaConfigStatus');
  if (status) status.textContent = 'Saving Ollama config...';

  try {
    const resp = await fetch('/api/ollama/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keepAlive })
    });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || JSON.stringify(json));
    if (status) status.textContent = `Saved. Chat requests now use keep_alive ${json.data.keepAlive}.`;
  } catch (err) {
    if (status) status.textContent = 'Save error: ' + err.message;
  }
}

async function fetchModels() {
  const modelsList = byId('modelsList');
  if (!modelsList) return;
  modelsList.textContent = 'Loading...';

  try {
    const resp = await fetch('/api/ollama/models');
    const j = await resp.json();
    if (!j.ok) throw new Error(JSON.stringify(j));
    renderModels(j.data || []);
  } catch (e) {
    modelsList.textContent = 'Error: ' + e.message;
  }
}

function renderModels(items) {
  const modelsList = byId('modelsList');
  if (!modelsList) return;

  if (!items || items.length === 0) {
    modelsList.innerHTML = '<div class="empty">No models installed</div>';
    return;
  }

  modelsList.innerHTML = '';
  items.forEach(it => {
    const name = (typeof it === 'string') ? it : (it.name || it.model || JSON.stringify(it));
    const row = document.createElement('div');
    row.className = 'model-row';
    row.innerHTML = `
      <div class="model-name">${escapeHtml(name)}</div>
      <div class="model-actions">
        <button class="btn-remove" type="button" data-model="${escapeHtml(name)}">Remove</button>
      </div>
    `;
    modelsList.appendChild(row);
  });

  modelsList.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const model = btn.dataset.model;
      const confirmed = await window.__dialog.confirm({
        title: 'Remove Model',
        message: 'Remove model ' + model + '?',
        confirmText: 'Remove',
        danger: true
      });
      if (!confirmed) return;
      await removeModel(model);
    });
  });
}

async function removeModel(model) {
  const modelStatus = byId('modelStatus');
  if (modelStatus) modelStatus.textContent = 'Removing ' + model + '...';

  try {
    const r = await fetch('/api/ollama/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || JSON.stringify(j));
    if (modelStatus) modelStatus.textContent = 'Removed ' + model;
    fetchModels();
    window.__chat?.loadModels?.();
  } catch (err) {
    if (modelStatus) modelStatus.textContent = 'Error removing: ' + err.message;
  }
}

async function installModel() {
  const modelInput = byId('modelInput');
  const modelStatus = byId('modelStatus');
  const model = modelInput?.value.trim();
  if (!model) {
    await window.__dialog.alert({ title: 'Model Required', message: 'Enter model name' });
    return;
  }
  if (modelStatus) modelStatus.textContent = 'Installing ' + model + '...';

  try {
    const r = await fetch('/api/ollama/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || JSON.stringify(j));
    if (modelStatus) modelStatus.textContent = 'Installed ' + model;
    modelInput.value = '';
    fetchModels();
    window.__chat?.loadModels?.();
  } catch (err) {
    if (modelStatus) modelStatus.textContent = 'Install error: ' + err.message;
  }
}

async function fetchAvailableModels() {
  const availableList = byId('availableList');
  if (!availableList) return;
  availableList.textContent = 'Loading available models...';

  try {
    const resp = await fetch('/api/ollama/available');
    const j = await resp.json();
    if (!j.ok) throw new Error(j.error || JSON.stringify(j));
    renderAvailableModels(j.data || []);
  } catch (e) {
    availableList.textContent = 'Error fetching available models: ' + e.message;
  }
}

function renderAvailableModels(items) {
  const availableList = byId('availableList');
  if (!availableList) return;

  if (!items || items.length === 0) {
    availableList.innerHTML = '<div class="empty">No models available</div>';
    return;
  }

  availableList.innerHTML = '';
  items.forEach(model => {
    const name = model.name || model;
    const desc = model.description || model.source || '';
    const tags = model.tags || ['latest'];
    const row = document.createElement('div');
    row.className = 'available-model-row';
    row.innerHTML = `
      <div class="model-info">
        <div class="model-title">${escapeHtml(name)}</div>
        ${desc ? `<div class="model-desc">${escapeHtml(desc)}</div>` : ''}
        <div class="model-tags">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
      </div>
      <div class="model-actions">
        <select class="tag-select" data-model="${escapeHtml(name)}">
          ${tags.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
        </select>
        <button class="btn-download" type="button" data-model="${escapeHtml(name)}">Download</button>
      </div>
    `;
    availableList.appendChild(row);
  });

  availableList.querySelectorAll('.btn-download').forEach(btn => {
    btn.addEventListener('click', async () => {
      const modelName = btn.dataset.model;
      const tagSelect = btn.parentElement.querySelector('.tag-select');
      const tag = tagSelect?.value || 'latest';
      const fullModel = tag !== 'latest' ? `${modelName}:${tag}` : modelName;
      const confirmed = await window.__dialog.confirm({
        title: 'Download Model',
        message: `Download ${fullModel}? This may take a while.`,
        confirmText: 'Download'
      });
      if (!confirmed) return;
      await downloadModel(fullModel);
    });
  });
}

async function downloadModel(model) {
  const modelStatus = byId('modelStatus');
  if (modelStatus) modelStatus.textContent = `Downloading ${model}...`;

  try {
    const r = await fetch('/api/ollama/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || JSON.stringify(j));
    if (modelStatus) modelStatus.textContent = `Downloaded ${model}`;
    fetchModels();
    fetchAvailableModels();
    window.__chat?.loadModels?.();
  } catch (err) {
    if (modelStatus) modelStatus.textContent = `Download error: ${err.message}`;
  }
}

