// Extracted from menu.js. Loaded after public/menu.js.
function initMonitor() {
  byId('refreshMonitor')?.addEventListener('click', fetchMonitor);
  byId('autoRefreshMonitor')?.addEventListener('change', toggleMonitorAutoRefresh);
  byId('inspectModel')?.addEventListener('click', inspectMonitorModel);
  byId('loadModel')?.addEventListener('click', loadMonitorModel);
  byId('unloadModel')?.addEventListener('click', unloadMonitorModel);
  fetchMonitor();
}

async function fetchMonitor() {
  const monitorOutput = byId('monitorOutput');
  const monitorSummary = byId('monitorSummary');
  const loadedModels = byId('loadedModels');
  const modelSelect = byId('monitorModelSelect');
  if (!monitorOutput) return;
  monitorOutput.textContent = 'Refreshing...';
  if (monitorSummary) monitorSummary.innerHTML = '';
  if (loadedModels) loadedModels.textContent = 'Loading...';

  try {
    const r = await fetch('/api/ollama/monitor/details', { cache: 'no-store' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || JSON.stringify(j));
    renderMonitor(j.data);
    populateMonitorModels(modelSelect, j.data.models || []);
    monitorOutput.textContent = JSON.stringify(j.data, null, 2);
  } catch (e) {
    monitorOutput.textContent = 'Error: ' + e.message;
    if (loadedModels) loadedModels.textContent = 'Error loading monitor data';
  }
}

function renderMonitor(data) {
  const monitorSummary = byId('monitorSummary');
  const loadedModels = byId('loadedModels');
  if (!monitorSummary || !loadedModels) return;

  const running = data.running || [];
  const models = data.models || [];
  const version = data.version?.version || 'unknown';

  monitorSummary.innerHTML = `
    <div class="metric"><span>Service</span><strong>${escapeHtml(data.url || 'unknown')}</strong></div>
    <div class="metric"><span>Version</span><strong>${escapeHtml(version)}</strong></div>
    <div class="metric"><span>Installed</span><strong>${models.length}</strong></div>
    <div class="metric"><span>Loaded</span><strong>${running.length}</strong></div>
  `;

  if (running.length === 0) {
    loadedModels.innerHTML = '<div class="empty">No models are currently loaded</div>';
    return;
  }

  loadedModels.innerHTML = '';
  running.forEach(model => {
    const name = model.name || model.model || 'unknown';
    const size = formatBytes(model.size || model.size_vram || 0);
    const expiresAt = model.expires_at ? new Date(model.expires_at).toLocaleTimeString() : 'not reported';
    const row = document.createElement('div');
    row.className = 'monitor-model-row';
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(name)}</strong>
        <small>VRAM ${escapeHtml(size)} - expires ${escapeHtml(expiresAt)}</small>
      </div>
      <button type="button" data-monitor-unload="${escapeHtml(name)}">Unload</button>
    `;
    loadedModels.appendChild(row);
  });

  loadedModels.querySelectorAll('[data-monitor-unload]').forEach(button => {
    button.addEventListener('click', () => unloadMonitorModel(button.dataset.monitorUnload));
  });
}

function populateMonitorModels(modelSelect, models) {
  if (!modelSelect) return;
  const selected = modelSelect.value || localStorage.getItem('selectedModel') || '';
  modelSelect.innerHTML = '';

  models.forEach(model => {
    const name = typeof model === 'string' ? model : (model.name || model.model || '');
    if (!name) return;
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    modelSelect.appendChild(option);
  });

  if (selected && Array.from(modelSelect.options).some(option => option.value === selected)) {
    modelSelect.value = selected;
  }
}

async function inspectMonitorModel() {
  const model = byId('monitorModelSelect')?.value;
  const details = byId('modelDetails');
  if (!model || !details) return;
  details.textContent = `Inspecting ${model}...`;

  try {
    const r = await fetch('/api/ollama/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || JSON.stringify(j));
    details.textContent = JSON.stringify(j.data, null, 2);
  } catch (err) {
    details.textContent = 'Inspect error: ' + err.message;
  }
}

async function loadMonitorModel() {
  const model = byId('monitorModelSelect')?.value;
  const keepAlive = byId('keepAliveSelect')?.value || '5m';
  const details = byId('modelDetails');
  if (!model) return;
  if (details) details.textContent = `Loading ${model}...`;

  try {
    const r = await fetch('/api/ollama/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, keepAlive })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || JSON.stringify(j));
    if (details) details.textContent = `Loaded ${model} with keep_alive ${keepAlive}`;
    fetchMonitor();
  } catch (err) {
    if (details) details.textContent = 'Load error: ' + err.message;
  }
}

async function unloadMonitorModel(modelOverride) {
  const model = modelOverride || byId('monitorModelSelect')?.value;
  const details = byId('modelDetails');
  if (!model) return;
  if (details) details.textContent = `Unloading ${model}...`;

  try {
    const r = await fetch('/api/ollama/unload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || JSON.stringify(j));
    if (details) details.textContent = `Unloaded ${model}`;
    fetchMonitor();
  } catch (err) {
    if (details) details.textContent = 'Unload error: ' + err.message;
  }
}

function toggleMonitorAutoRefresh(event) {
  stopMonitorAutoRefresh();

  if (event.target.checked) {
    monitorTimer = setInterval(fetchMonitor, 3000);
  }
}

function stopMonitorAutoRefresh() {
  if (!monitorTimer) return;
  clearInterval(monitorTimer);
  monitorTimer = null;
}

