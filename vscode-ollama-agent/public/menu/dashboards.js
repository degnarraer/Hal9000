// Extracted from menu.js. Loaded after public/menu.js.
function initActivity() {
  byId('refreshActivity')?.addEventListener('click', fetchActivityDashboard);
  byId('autoRefreshActivity')?.addEventListener('change', toggleActivityAutoRefresh);
  fetchActivityDashboard();
  startActivityAutoRefresh();
}

function initSecurity() {
  byId('refreshSecurity')?.addEventListener('click', fetchSecurityDashboard);
  byId('autoRefreshSecurity')?.addEventListener('change', toggleSecurityAutoRefresh);
  fetchSecurityDashboard();
  startSecurityAutoRefresh();
}

function loadChartJs() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (!chartJsPromise) {
    chartJsPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/chart.js/chart.umd.min.js';
      script.onload = () => resolve(window.Chart);
      script.onerror = () => reject(new Error('Chart.js failed to load'));
      document.head.appendChild(script);
    });
  }
  return chartJsPromise;
}

function chartOptions(label, valueFormatter) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { labels: { color: '#dfe9ff' } },
      tooltip: {
        callbacks: {
          label: context => `${context.dataset.label}: ${valueFormatter ? valueFormatter(context.raw) : context.raw}`
        }
      },
      title: { display: false, text: label }
    },
    scales: {
      x: { ticks: { color: '#8b94a6', maxRotation: 0 }, grid: { color: 'rgba(255,255,255,0.04)' } },
      y: { beginAtZero: true, ticks: { color: '#8b94a6', callback: valueFormatter || undefined }, grid: { color: 'rgba(255,255,255,0.05)' } }
    }
  };
}

function upsertChart(key, canvas, config) {
  if (!canvas) return;
  if (activityCharts[key]) {
    activityCharts[key].data = config.data;
    activityCharts[key].options = config.options;
    activityCharts[key].update();
    return;
  }
  activityCharts[key] = new Chart(canvas, config);
}

function upsertSecurityChart(key, canvas, config) {
  if (!canvas) return;
  if (securityCharts[key]) {
    securityCharts[key].data = config.data;
    securityCharts[key].options = config.options;
    securityCharts[key].update();
    return;
  }
  securityCharts[key] = new Chart(canvas, config);
}

async function fetchActivityDashboard() {
  const status = byId('activityStatus');
  if (status) status.textContent = 'Refreshing activity...';

  try {
    await loadChartJs();
    const response = await fetch('/api/activity/dashboard', { cache: 'no-store' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Activity dashboard unavailable');
    renderActivityDashboard(json.data || {});
    if (status) status.textContent = json.data?.persistent ? 'Metrics persisted to database.' : 'Database unavailable; showing temporary metrics.';
  } catch (err) {
    if (status) status.textContent = 'Activity error: ' + err.message;
  }
}

function renderActivityDashboard(data) {
  renderActivitySummary(data);
  renderActivityUsers(data.users || []);
  renderActivityEvents(data.recentEvents || []);
  renderActivityCharts(data.samples || []);
}

function renderActivitySummary(data) {
  const summary = byId('activitySummary');
  if (!summary) return;
  const latest = (data.samples || []).at(-1) || {};
  summary.innerHTML = `
    <div class="metric"><span>Online</span><strong>${escapeHtml(data.onlineCount || 0)}</strong></div>
    <div class="metric"><span>Download</span><strong>${escapeHtml(formatRate(latest.downloadBps || 0))}</strong></div>
    <div class="metric"><span>Upload</span><strong>${escapeHtml(formatRate(latest.uploadBps || 0))}</strong></div>
    <div class="metric"><span>Requests</span><strong>${escapeHtml(latest.requests || 0)} / sample</strong></div>
  `;
}

function renderActivityUsers(users) {
  const target = byId('activityUsers');
  if (!target) return;
  if (!users.length) {
    target.innerHTML = '<div class="empty">No users online</div>';
    return;
  }
  target.innerHTML = users.map(user => `
    <div class="activity-row">
      <strong>${escapeHtml(user.email || user.name || 'User')}</strong>
      <span>${escapeHtml(user.action || 'Idle')}</span>
      <small>${escapeHtml((user.roles || []).join(', ') || 'user')} - ${escapeHtml(formatTime(user.lastSeenAt))}</small>
    </div>
  `).join('');
}

function renderActivityEvents(events) {
  const target = byId('activityEvents');
  if (!target) return;
  if (!events.length) {
    target.innerHTML = '<div class="empty">No recent activity</div>';
    return;
  }
  target.innerHTML = events.map(event => `
    <div class="activity-row">
      <strong>${escapeHtml(event.email || 'User')}</strong>
      <span>${escapeHtml(event.action || event.path || 'Activity')} - ${escapeHtml(event.status || '')}</span>
      <small>${escapeHtml(formatTime(event.created_at))} - ${escapeHtml(formatBytes(event.download_bytes || 0))} down / ${escapeHtml(formatBytes(event.upload_bytes || 0))} up</small>
    </div>
  `).join('');
}

function renderActivityCharts(samples) {
  const labels = samples.map(sample => formatTime(sample.sampledAt || sample.sampled_at));
  const download = samples.map(sample => Number(sample.downloadBps || sample.download_bps || 0));
  const upload = samples.map(sample => Number(sample.uploadBps || sample.upload_bps || 0));
  const online = samples.map(sample => Number(sample.onlineUsers || sample.online_users || 0));
  const requests = samples.map(sample => Number(sample.requests || 0));

  upsertChart('rates', byId('activityRatesChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Download', data: download, borderColor: '#00e0ff', backgroundColor: 'rgba(0,224,255,0.12)', tension: 0.25 },
        { label: 'Upload', data: upload, borderColor: '#ff9a5a', backgroundColor: 'rgba(255,154,90,0.12)', tension: 0.25 }
      ]
    },
    options: chartOptions('Connection Rates', formatRate)
  });

  upsertChart('users', byId('activityUsersChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{ label: 'Online users', data: online, borderColor: '#7c5cff', backgroundColor: 'rgba(124,92,255,0.14)', tension: 0.25, fill: true }]
    },
    options: chartOptions('Users Online')
  });

  upsertChart('requests', byId('activityRequestsChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Requests', data: requests, borderColor: '#bff9ff', backgroundColor: 'rgba(191,249,255,0.22)' }]
    },
    options: chartOptions('Requests')
  });
}

function startActivityAutoRefresh() {
  stopActivityAutoRefresh();
  const auto = byId('autoRefreshActivity');
  if (auto && !auto.checked) return;
  activityTimer = setInterval(fetchActivityDashboard, 5000);
}

function toggleActivityAutoRefresh(event) {
  if (event.target.checked) startActivityAutoRefresh();
  else stopActivityAutoRefresh();
}

function stopActivityAutoRefresh() {
  if (activityTimer) clearInterval(activityTimer);
  activityTimer = null;
  Object.values(activityCharts).forEach(chart => chart.destroy());
  activityCharts = {};
}

async function fetchSecurityDashboard() {
  const status = byId('securityStatus');
  if (status) status.textContent = 'Refreshing security events...';

  try {
    await loadChartJs();
    const response = await fetch('/api/security/dashboard', { cache: 'no-store' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Security dashboard unavailable');
    renderSecurityDashboard(json.data || {});
    if (status) status.textContent = json.data?.persistent ? 'Security events persisted to database.' : 'Database unavailable; showing temporary events.';
  } catch (err) {
    if (status) status.textContent = 'Security error: ' + err.message;
  }
}

function renderSecurityDashboard(data) {
  renderSecuritySummary(data.summary || {});
  renderSecurityEvents(data.events || []);
  renderSecurityTimeline(data.timeline || []);
}

function renderSecuritySummary(summary) {
  const target = byId('securitySummary');
  if (!target) return;
  target.innerHTML = `
    <div class="metric"><span>24h Events</span><strong>${escapeHtml(summary.total || 0)}</strong></div>
    <div class="metric"><span>Warnings</span><strong>${escapeHtml(summary.warnings || 0)}</strong></div>
    <div class="metric"><span>Auth Failures</span><strong>${escapeHtml(summary.auth_failures || 0)}</strong></div>
    <div class="metric"><span>Admin Denied</span><strong>${escapeHtml(summary.admin_denied || 0)}</strong></div>
  `;
}

function renderSecurityEvents(events) {
  const target = byId('securityEvents');
  if (!target) return;
  if (!events.length) {
    target.innerHTML = '<div class="empty">No security events recorded</div>';
    return;
  }

  target.innerHTML = events.map(event => `
    <div class="activity-row security-event severity-${escapeHtml(event.severity || 'info')}">
      <strong>${escapeHtml((event.severity || 'info').toUpperCase())} - ${escapeHtml(event.type || 'security_event')}</strong>
      <span>${escapeHtml(event.actor || 'anonymous')} - ${escapeHtml(event.method || '')} ${escapeHtml(event.path || '')}</span>
      <small>${escapeHtml(formatTime(event.created_at || event.createdAt))} - ${escapeHtml(event.ip || 'unknown ip')} - ${escapeHtml(event.detail || '')}</small>
    </div>
  `).join('');
}

function renderSecurityTimeline(timeline) {
  const labels = timeline.map(row => formatTime(row.bucket));
  const total = timeline.map(row => Number(row.total || 0));
  const notable = timeline.map(row => Number(row.notable || 0));

  upsertSecurityChart('timeline', byId('securityTimelineChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Total events', data: total, borderColor: '#00e0ff', backgroundColor: 'rgba(0,224,255,0.12)', tension: 0.25 },
        { label: 'Warnings/Critical', data: notable, borderColor: '#ff5f7a', backgroundColor: 'rgba(255,95,122,0.12)', tension: 0.25 }
      ]
    },
    options: chartOptions('Security Events')
  });
}

function startSecurityAutoRefresh() {
  stopSecurityAutoRefresh();
  const auto = byId('autoRefreshSecurity');
  if (auto && !auto.checked) return;
  securityTimer = setInterval(fetchSecurityDashboard, 5000);
}

function toggleSecurityAutoRefresh(event) {
  if (event.target.checked) startSecurityAutoRefresh();
  else stopSecurityAutoRefresh();
}

function stopSecurityAutoRefresh() {
  if (securityTimer) clearInterval(securityTimer);
  securityTimer = null;
  Object.values(securityCharts).forEach(chart => chart.destroy());
  securityCharts = {};
}
