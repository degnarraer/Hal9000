// Extracted from menu.js. Loaded after public/menu.js.
function initLogging() {
  byId('refreshLogs')?.addEventListener('click', restartLogStream);
  restartLogStream();
}

function initRemote() {
  byId('softReboot')?.addEventListener('click', softRebootServer);
}

function renderLogs(items, { reset = false } = {}) {
  const logsList = byId('logsList');
  if (!logsList) return;

  if (reset) logsList.innerHTML = '';

  if ((!items || items.length === 0) && !logsList.children.length) {
    logsList.innerHTML = '<div class="empty">No logs</div>';
    return;
  }

  logsList.querySelector('.empty')?.remove();
  items.forEach(appendLog);
  scrollLogsToBottom(logsList);
}

function startLogStream() {
  if (logSource) return;
  const logsList = byId('logsList');
  const status = byId('logsStreamStatus');
  if (logsList) logsList.innerHTML = '<div class="empty">Connecting to live log stream...</div>';
  if (status) status.textContent = 'Connecting...';

  logSource = new EventSource('/api/logs/stream');
  logSource.onmessage = (e) => {
    try {
      appendLog(JSON.parse(e.data));
      if (status) status.textContent = 'Live';
    } catch (err) {
      console.warn(err);
    }
  };
  logSource.onopen = () => {
    if (status) status.textContent = 'Live';
  };
  logSource.onerror = () => {
    if (status) status.textContent = 'Reconnecting...';
  };
}

function restartLogStream() {
  stopLogStream();
  startLogStream();
}

function stopLogStream() {
  if (!logSource) return;
  logSource.close();
  logSource = null;
}

function appendLog(entry) {
  const logsList = byId('logsList');
  if (!logsList) return;
  const shouldAutoScroll = logsList.scrollTop + logsList.clientHeight >= logsList.scrollHeight - 24;

  const row = document.createElement('div');
  row.className = 'log-row';
  row.textContent = `[${entry.ts}] ${String(entry.level).toUpperCase()} ${entry.msg}`;
  logsList.appendChild(row);

  if (shouldAutoScroll) scrollLogsToBottom(logsList);
}

function scrollLogsToBottom(logsList) {
  logsList.scrollTop = logsList.scrollHeight;
}

async function softRebootServer() {
  const softReboot = byId('softReboot');
  const rebootStatus = byId('rebootStatus');
  const confirmed = await window.__dialog.confirm({
    title: 'Soft Reboot',
    message: 'Send soft reboot to server? This will disconnect you briefly.',
    confirmText: 'Reboot',
    danger: true
  });
  if (!confirmed) return;
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

