// menu.js - side menu navigation with modular main-page partials.
const menuBtn = document.createElement('button');
menuBtn.id = 'fabMenu';
menuBtn.className = 'fab-menu';
menuBtn.innerHTML = '<i data-lucide="menu"></i>';
document.body.appendChild(menuBtn);

const panel = document.createElement('aside');
panel.id = 'slidePanel';
panel.className = 'slide-panel';
panel.innerHTML = `
  <div class="panel-header">
    <span id="panelTitle">Menu</span>
    <button id="closePanel" class="panel-icon-btn" type="button" aria-label="Close">
      <i data-lucide="x"></i>
    </button>
  </div>
  <div id="menuContent" class="panel-body"></div>
`;
document.body.appendChild(panel);

menuBtn.style.cssText = (menuBtn.style.cssText || '') + 'position:fixed;right:24px;bottom:24px;z-index:10000;';
panel.style.cssText = (panel.style.cssText || '') + 'position:fixed;right:0;top:0;bottom:0;width:360px;z-index:9999;transform:translateX(100%);transition:transform 240ms ease;pointer-events:none;';

const main = document.querySelector('.main');
const mainContent = document.getElementById('mainContent');
const chatContainer = document.querySelector('.chat-container');
const menuContent = document.getElementById('menuContent');
const closeBtn = document.getElementById('closePanel');

const mainPage = document.createElement('section');
mainPage.id = 'mainMenuPage';
mainPage.className = 'main-menu-page';
mainPage.hidden = true;
mainContent.appendChild(mainPage);

const routes = {
  models: { title: 'Models', url: '/menu-pages/models.html', init: initModels },
  monitor: { title: 'Monitor', url: '/menu-pages/monitor.html', init: initMonitor },
  logging: { title: 'Logging', url: '/menu-pages/logging.html', init: initLogging },
  remote: { title: 'Remote Control', url: '/menu-pages/remote.html', init: initRemote },
  settings: { title: 'Settings', url: '/menu-pages/settings.html', init: initSettings }
};

let currentRoute = 'chat';
let logSource;

function setPanelOpen(isOpen) {
  if (isOpen) {
    panel.style.transform = 'translateX(0)';
    panel.style.pointerEvents = 'auto';
    panel.classList.add('open');
    menuBtn.classList.add('open');
    menuBtn.setAttribute('aria-expanded', 'true');
    main?.classList.add('panel-open');
    loadMenuLanding();
  } else {
    panel.style.transform = 'translateX(100%)';
    panel.style.pointerEvents = 'none';
    panel.classList.remove('open');
    menuBtn.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
    main?.classList.remove('panel-open');
  }
}

async function loadMenuLanding() {
  menuContent.innerHTML = '<div class="menu-loading">Loading...</div>';

  try {
    const response = await fetch('/menu-pages/landing.html', { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    menuContent.innerHTML = await response.text();
    menuContent.querySelectorAll('[data-menu-route]').forEach(button => {
      button.classList.toggle('active', button.dataset.menuRoute === currentRoute);
      button.addEventListener('click', () => loadMainPage(button.dataset.menuRoute));
    });
    window.__icons?.render?.(panel);
  } catch (err) {
    menuContent.innerHTML = `<div class="menu-error">Could not load menu: ${escapeHtml(err.message)}</div>`;
  }
}

async function loadMainPage(routeName) {
  if (routeName === 'chat') {
    currentRoute = 'chat';
    mainPage.hidden = true;
    mainPage.innerHTML = '';
    chatContainer.hidden = false;
    loadMenuLanding();
    return;
  }

  const route = routes[routeName];
  if (!route) return;

  currentRoute = routeName;
  chatContainer.hidden = true;
  mainPage.hidden = false;
  mainPage.innerHTML = '<div class="menu-loading">Loading...</div>';
  loadMenuLanding();

  try {
    const response = await fetch(route.url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    mainPage.innerHTML = await response.text();
    window.__icons?.render?.(mainPage);
    route.init?.();
  } catch (err) {
    mainPage.innerHTML = `<div class="menu-error">Could not load ${escapeHtml(route.title)}: ${escapeHtml(err.message)}</div>`;
  }
}

function initModels() {
  byId('installBtn')?.addEventListener('click', installModel);
  fetchModels();
  fetchAvailableModels();
}

function initMonitor() {
  byId('refreshMonitor')?.addEventListener('click', fetchMonitor);
  fetchMonitor();
}

function initLogging() {
  byId('refreshLogs')?.addEventListener('click', fetchLogs);
  fetchLogs();
}

function initRemote() {
  byId('softReboot')?.addEventListener('click', softRebootServer);
}

function initSettings() {
  window.__icons?.render?.(mainPage);
}

function byId(id) {
  return mainPage.querySelector(`#${id}`);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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
      if (!confirm('Remove model ' + model + '?')) return;
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
  } catch (err) {
    if (modelStatus) modelStatus.textContent = 'Error removing: ' + err.message;
  }
}

async function installModel() {
  const modelInput = byId('modelInput');
  const modelStatus = byId('modelStatus');
  const model = modelInput?.value.trim();
  if (!model) return alert('Enter model name');
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
      if (!confirm(`Download ${fullModel}? This may take a while.`)) return;
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
  } catch (err) {
    if (modelStatus) modelStatus.textContent = `Download error: ${err.message}`;
  }
}

async function fetchMonitor() {
  const monitorOutput = byId('monitorOutput');
  if (!monitorOutput) return;
  monitorOutput.textContent = 'Refreshing...';

  try {
    const r = await fetch('/api/ollama/monitor');
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || JSON.stringify(j));
    monitorOutput.textContent = JSON.stringify(j.data, null, 2);
  } catch (e) {
    monitorOutput.textContent = 'Error: ' + e.message;
  }
}

async function fetchLogs() {
  const logsList = byId('logsList');
  if (!logsList) return;
  logsList.textContent = 'Loading...';

  try {
    const r = await fetch('/api/logs');
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || JSON.stringify(j));
    renderLogs(j.data || []);
    startLogStream();
  } catch (e) {
    logsList.textContent = 'Error: ' + e.message;
  }
}

function renderLogs(items) {
  const logsList = byId('logsList');
  if (!logsList) return;

  if (!items || items.length === 0) {
    logsList.innerHTML = '<div class="empty">No logs</div>';
    return;
  }

  logsList.innerHTML = '';
  items.forEach(prependLog);
}

function startLogStream() {
  if (logSource) return;
  logSource = new EventSource('/api/logs/stream');
  logSource.onmessage = (e) => {
    try { prependLog(JSON.parse(e.data)); } catch (err) { console.warn(err); }
  };
}

function prependLog(entry) {
  const logsList = byId('logsList');
  if (!logsList) return;

  const row = document.createElement('div');
  row.className = 'log-row';
  row.textContent = `[${entry.ts}] ${String(entry.level).toUpperCase()} ${entry.msg}`;
  logsList.insertBefore(row, logsList.firstChild);
}

async function softRebootServer() {
  const softReboot = byId('softReboot');
  const rebootStatus = byId('rebootStatus');
  if (!confirm('Send soft reboot to server? This will disconnect you briefly.')) return;
  if (rebootStatus) rebootStatus.textContent = 'Sending reboot command...';
  if (softReboot) softReboot.disabled = true;

  try {
    const r = await fetch('/api/control/reboot', { method: 'POST' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || JSON.stringify(j));
    if (rebootStatus) rebootStatus.textContent = 'Reboot command sent. Server restarting...';
    waitForServer(rebootStatus, softReboot);
  } catch (e) {
    if (rebootStatus) rebootStatus.textContent = 'Error: ' + e.message;
    if (softReboot) softReboot.disabled = false;
  }
}

function waitForServer(rebootStatus, softReboot) {
  let attempts = 0;
  const maxAttempts = 30;
  const checkConnection = setInterval(async () => {
    attempts++;
    try {
      const health = await fetch('/api/ollama/available', { signal: AbortSignal.timeout(2000) });
      if (health.ok) {
        clearInterval(checkConnection);
        if (rebootStatus) rebootStatus.textContent = 'Server is back online. Refreshing...';
        setTimeout(() => { window.location.reload(); }, 1000);
      }
    } catch (e) {
      if (attempts >= maxAttempts) {
        clearInterval(checkConnection);
        if (rebootStatus) rebootStatus.textContent = 'Server reboot took too long. Please refresh manually.';
        if (softReboot) softReboot.disabled = false;
      } else if (rebootStatus) {
        rebootStatus.textContent = `Waiting for server... (${attempts}/${maxAttempts}s)`;
      }
    }
  }, 1000);
}

menuBtn.addEventListener('click', () => {
  setPanelOpen(!panel.classList.contains('open'));
});
closeBtn.addEventListener('click', () => setPanelOpen(false));

loadMenuLanding();
window.__icons?.render?.(panel);

window.__menu = {
  open: () => setPanelOpen(true),
  close: () => setPanelOpen(false),
  load: loadMainPage,
  current: () => currentRoute
};
