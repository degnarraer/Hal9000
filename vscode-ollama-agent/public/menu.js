// menu.js - side menu navigation with modular main-page partials.
const menuBtn = document.getElementById('fabMenu') || document.createElement('button');
menuBtn.id = 'fabMenu';
menuBtn.className = 'fab-menu';
menuBtn.type = 'button';
menuBtn.setAttribute('aria-label', 'Open menu');
menuBtn.setAttribute('aria-expanded', 'false');
menuBtn.setAttribute('title', 'Open menu');
if (!menuBtn.querySelector('[data-lucide="menu"]')) {
  menuBtn.innerHTML = '<i data-lucide="menu"></i><span class="menu-glyph" aria-hidden="true">Menu</span>';
}

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
  <div id="accountPanel" class="account-panel">
    <div class="account-avatar"><i data-lucide="user"></i></div>
    <div class="account-details">
      <strong id="accountName">Signed in</strong>
      <span id="accountEmail">Loading account...</span>
    </div>
    <button id="bootstrapAdminBtn" class="panel-icon-btn" type="button" aria-label="Make me admin" title="Make me admin" hidden>
      <i data-lucide="shield-plus"></i>
    </button>
    <button id="signOutBtn" class="panel-icon-btn" type="button" aria-label="Sign out" title="Sign out">
      <i data-lucide="log-out"></i>
    </button>
  </div>
  <div id="menuContent" class="panel-body"></div>
`;
document.body.appendChild(panel);

menuBtn.style.cssText = (menuBtn.style.cssText || '') + 'z-index:10000;';
panel.style.cssText = (panel.style.cssText || '') + 'position:fixed;right:0;top:0;bottom:var(--lower-banner-reserve);width:min(360px, calc(100vw - 16px));z-index:900;transform:translateX(100%);transition:transform 240ms ease;pointer-events:none;';

const main = document.querySelector('.main');
if (main) {
  main.appendChild(panel);
}
const mainContent = document.getElementById('mainContent');
const chatContainer = document.querySelector('.chat-container');
const lowerBanner = document.getElementById('lowerBanner');
const inputSection = document.querySelector('.input-section');
const lowerBannerActions = document.getElementById('lowerBannerActions');
const clearChatBtn = document.getElementById('clearChat');
const pageBannerStatus = document.getElementById('pageBannerStatus');
const pageBannerTitle = document.getElementById('pageBannerTitle');
const pageBannerSubtitle = document.getElementById('pageBannerSubtitle');
const menuContent = document.getElementById('menuContent');
const closeBtn = document.getElementById('closePanel');
const accountName = document.getElementById('accountName');
const accountEmail = document.getElementById('accountEmail');
const bootstrapAdminBtn = document.getElementById('bootstrapAdminBtn');
const signOutBtn = document.getElementById('signOutBtn');

if (lowerBannerActions && menuBtn.parentElement !== lowerBannerActions) {
  lowerBannerActions.appendChild(menuBtn);
}

function syncLowerBannerReserve() {
  if (!lowerBanner) return;
  const rect = lowerBanner.getBoundingClientRect();
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const reserve = Math.max(0, Math.ceil(viewportHeight - rect.top));
  document.documentElement.style.setProperty('--lower-banner-reserve', `${reserve}px`);
}

if (lowerBanner) {
  if (window.ResizeObserver) {
    const lowerBannerObserver = new ResizeObserver(syncLowerBannerReserve);
    lowerBannerObserver.observe(lowerBanner);
  }
  window.addEventListener('resize', syncLowerBannerReserve);
  window.visualViewport?.addEventListener('resize', syncLowerBannerReserve);
  window.visualViewport?.addEventListener('scroll', syncLowerBannerReserve);
  requestAnimationFrame(syncLowerBannerReserve);
}

const mainPage = document.createElement('section');
mainPage.id = 'mainMenuPage';
mainPage.className = 'main-menu-page';
mainPage.hidden = true;
mainContent.appendChild(mainPage);

function initSkills() {
  mainPage.querySelectorAll('[data-skill-route]').forEach(button => {
    button.addEventListener('click', () => loadMainPage(button.dataset.skillRoute));
  });
}

function initAdminMenu() {
  mainPage.querySelectorAll('[data-admin-route]').forEach(button => {
    button.addEventListener('click', () => loadMainPage(button.dataset.adminRoute));
  });
}

const routes = {
  skills: { title: 'Skills Menu', url: '/menu-pages/skills.html', init: initSkills },
  memory: { title: 'Memory', url: '/menu-pages/memory.html', init: initMemory },
  webSearch: { title: 'Web Search Summary', url: '/menu-pages/web-search.html', init: initWebSearchSkill },
  admin: { title: 'Admin Menu', url: '/menu-pages/admin.html', init: initAdminMenu, admin: true },
  models: { title: 'Models', url: '/menu-pages/models.html', init: initModels, admin: true },
  monitor: { title: 'Monitor', url: '/menu-pages/monitor.html', init: initMonitor, admin: true },
  logging: { title: 'Logging', url: '/menu-pages/logging.html', init: initLogging, admin: true },
  activity: { title: 'Activity', url: '/menu-pages/activity.html', init: initActivity, admin: true },
  security: { title: 'Security', url: '/menu-pages/security.html', init: initSecurity, admin: true },
  remote: { title: 'Remote Control', url: '/menu-pages/remote.html', init: initRemote, admin: true },
  settings: { title: 'Settings', url: '/menu-pages/settings.html', init: initSettings }
};

const menuSubmenus = {
  skills: {
    title: 'Skills Menu',
    items: [
      { route: 'memory', icon: 'brain', title: 'Memory', description: "Review chat memory and HAL's summaries." },
      { route: 'webSearch', icon: 'search', title: 'Web Search Summary', description: 'Search current web results and summarize them with sources.' }
    ]
  },
  admin: {
    title: 'Admin Menu',
    admin: true,
    items: [
      { route: 'models', icon: 'boxes', title: 'Models', description: 'Install, remove, and download Ollama models.' },
      { route: 'monitor', icon: 'activity', title: 'Monitor', description: 'Check the current Ollama server state.' },
      { route: 'logging', icon: 'logs', title: 'Logging', description: 'Watch recent server activity.' },
      { route: 'activity', icon: 'chart-line', title: 'Activity', description: 'Track users, actions, and connection rates.' },
      { route: 'security', icon: 'shield-alert', title: 'Security', description: 'Review auth failures and admin access denials.' },
      { route: 'remote', icon: 'power', title: 'Remote Control', description: 'Restart the local server process.' }
    ]
  }
};

let currentRoute = 'chat';
let logSource;
let monitorTimer;
let memoryTimer;
let activityTimer;
let securityTimer;
let chartJsPromise;
let activityCharts = {};
let securityCharts = {};
let currentUser = { roles: ['user'], isAdmin: false };

function isAuthRedirect(response) {
  try {
    return response.redirected && new URL(response.url, window.location.origin).pathname.startsWith('/auth/');
  } catch (err) {
    return false;
  }
}

async function fetchWithAuthRedirect(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 401 || isAuthRedirect(response)) {
    window.location.href = '/auth/login';
    throw new Error('Authentication required');
  }
  return response;
}

function renderMenuIcons() {
  window.__icons?.render?.(menuBtn);
  window.__icons?.render?.(panel);
}

function setLowerBannerRoute(routeName) {
  const isChat = routeName === 'chat';
  if (inputSection) inputSection.hidden = !isChat;
  if (clearChatBtn) clearChatBtn.hidden = !isChat;
  if (pageBannerStatus) pageBannerStatus.hidden = isChat;

  if (!isChat) {
    const route = routes[routeName];
    const title = route?.title || 'Tools';
    if (pageBannerTitle) pageBannerTitle.textContent = title;
    if (pageBannerSubtitle) pageBannerSubtitle.textContent = 'Menu stays available from every screen.';
  }
}

function setPanelOpen(isOpen) {
  if (isOpen) {
    panel.style.transform = 'translateX(0)';
    panel.style.pointerEvents = 'auto';
    panel.classList.add('open');
    menuBtn.classList.add('open');
    menuBtn.setAttribute('aria-expanded', 'true');
    main?.classList.add('panel-open');
    fetchAccount();
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

async function fetchAccount() {
  if (!accountName || !accountEmail) return;

  try {
    const response = await fetchWithAuthRedirect('/api/auth/me', { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Unable to load account');
    const user = json.data || {};
    currentUser = user;
    accountName.textContent = user.name || 'Signed in';
    accountEmail.textContent = `${user.email || user.subject || 'Authenticated session'}${user.isAdmin ? ' - Admin' : ''}`;
    await updateBootstrapAdminButton();
    filterMenuForRole();
  } catch (err) {
    currentUser = { roles: ['user'], isAdmin: false };
    accountName.textContent = 'Signed in';
    accountEmail.textContent = 'Account unavailable';
    if (bootstrapAdminBtn) bootstrapAdminBtn.hidden = true;
  }
}

async function updateBootstrapAdminButton() {
  if (!bootstrapAdminBtn) return;
  bootstrapAdminBtn.hidden = true;
  if (currentUser.isAdmin) return;

  try {
    const response = await fetchWithAuthRedirect('/api/admin/bootstrap/status', { cache: 'no-store' });
    const json = await response.json();
    bootstrapAdminBtn.hidden = !json.ok || !json.data?.canBootstrap;
  } catch (err) {
    bootstrapAdminBtn.hidden = true;
  }
  renderMenuIcons();
}

async function bootstrapAdmin() {
  const confirmed = await window.__dialog.confirm({
    title: 'Make Admin',
    message: 'Make your account an administrator? This is only available before the first admin exists.',
    confirmText: 'Make Admin'
  });
  if (!confirmed) return;
  bootstrapAdminBtn?.setAttribute('disabled', 'disabled');
  try {
    const response = await fetchWithAuthRedirect('/api/admin/bootstrap', { method: 'POST' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Admin bootstrap failed');
    await fetchAccount();
    loadMenuLanding();
  } catch (err) {
    await window.__dialog.alert({ title: 'Admin Bootstrap Failed', message: err.message });
  } finally {
    bootstrapAdminBtn?.removeAttribute('disabled');
  }
}

async function signOut() {
  signOutBtn?.setAttribute('disabled', 'disabled');
  try {
    await fetch('/auth/logout', { method: 'POST' });
  } finally {
    window.location.href = '/auth/login';
  }
}

async function loadMenuLanding() {
  menuContent.innerHTML = '<div class="menu-loading">Loading...</div>';

  try {
    const response = await fetchWithAuthRedirect('/menu-pages/landing.html', { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    menuContent.innerHTML = `<div class="menu-slide menu-slide-root">${await response.text()}</div>`;
    filterMenuForRole();
    menuContent.querySelectorAll('[data-menu-route]').forEach(button => {
      button.classList.toggle('active', button.dataset.menuRoute === currentRoute);
      button.addEventListener('click', () => {
        const routeName = button.dataset.menuRoute;
        if (menuSubmenus[routeName]) {
          loadMainPage(routeName, { refreshMenu: false });
          slideToSubmenu(routeName);
          return;
        }
        loadMainPage(routeName);
      });
    });
    renderMenuIcons();
  } catch (err) {
    menuContent.innerHTML = `<div class="menu-error">Could not load menu: ${escapeHtml(err.message)}</div>`;
  }
}

function slideToSubmenu(submenuName) {
  const submenu = menuSubmenus[submenuName];
  if (!submenu || (submenu.admin && !currentUser.isAdmin)) return;
  const rootHtml = menuContent.querySelector('.menu-slide-root')?.innerHTML || '';

  const childHtml = submenu.items.map(item => `
    <button class="menu-item" type="button" data-menu-route="${escapeHtml(item.route)}">
      <i data-lucide="${escapeHtml(item.icon)}"></i>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.description)}</small>
      </span>
    </button>
  `).join('');

  menuContent.innerHTML = `
    <div class="menu-slide-shell">
      <div class="menu-slide menu-slide-root">${rootHtml}</div>
      <div class="menu-slide menu-slide-child">
        <button class="menu-back" type="button" data-menu-back>
          <i data-lucide="arrow-left"></i>
          ${escapeHtml(submenu.title)}
        </button>
        <section class="menu-landing">${childHtml}</section>
      </div>
    </div>
  `;

  menuContent.querySelector('[data-menu-back]')?.addEventListener('click', loadMenuLanding);
  menuContent.querySelectorAll('[data-menu-route]').forEach(button => {
    button.classList.toggle('active', button.dataset.menuRoute === currentRoute);
    button.addEventListener('click', () => {
      loadMainPage(button.dataset.menuRoute, { refreshMenu: false });
      menuContent.querySelectorAll('[data-menu-route]').forEach(item => {
        item.classList.toggle('active', item === button);
      });
    });
  });
  renderMenuIcons();
  requestAnimationFrame(() => {
    menuContent.querySelector('.menu-slide-shell')?.classList.add('show-child');
  });
}

function filterMenuForRole() {
  if (!menuContent) return;
  menuContent.querySelectorAll('[data-admin-only="true"]').forEach(element => {
    element.hidden = !currentUser.isAdmin;
  });
}

async function loadMainPage(routeName, options = {}) {
  const shouldRefreshMenu = options.refreshMenu !== false;
  if (currentRoute === 'monitor' && routeName !== 'monitor') stopMonitorAutoRefresh();
  if (currentRoute === 'memory' && routeName !== 'memory') stopMemoryAutoRefresh();
  if (currentRoute === 'activity' && routeName !== 'activity') stopActivityAutoRefresh();
  if (currentRoute === 'security' && routeName !== 'security') stopSecurityAutoRefresh();
  if (currentRoute === 'logging' && routeName !== 'logging') stopLogStream();

  if (routeName === 'chat') {
    currentRoute = 'chat';
    mainPage.hidden = true;
    mainPage.innerHTML = '';
    chatContainer.hidden = false;
    setLowerBannerRoute('chat');
    if (shouldRefreshMenu) loadMenuLanding();
    return;
  }

  const route = routes[routeName];
  if (!route) return;
  if (route.admin && !currentUser.isAdmin) {
    currentRoute = 'chat';
    mainPage.hidden = true;
    mainPage.innerHTML = '';
    chatContainer.hidden = false;
    setLowerBannerRoute('chat');
    setPanelOpen(false);
    return;
  }

  currentRoute = routeName;
  chatContainer.hidden = true;
  mainPage.hidden = false;
  setLowerBannerRoute(routeName);
  mainPage.innerHTML = '<div class="menu-loading">Loading...</div>';
  if (shouldRefreshMenu) loadMenuLanding();

  try {
    const response = await fetchWithAuthRedirect(route.url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    mainPage.innerHTML = await response.text();
    window.__icons?.render?.(mainPage);
    route.init?.();
  } catch (err) {
    mainPage.innerHTML = `<div class="menu-error">Could not load ${escapeHtml(route.title)}: ${escapeHtml(err.message)}</div>`;
  }
}

function initSettings() {
  byId('fullscreenToggle')?.addEventListener('click', toggleFullscreen);
  updateFullscreenStatus();
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

async function toggleFullscreen() {
  const status = byId('fullscreenStatus');

  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      updateFullscreenStatus('Full screen exited.');
      return;
    }

    const target = document.documentElement;
    if (target.requestFullscreen) {
      await target.requestFullscreen({ navigationUI: 'hide' });
      updateFullscreenStatus('Full screen is active.');
      return;
    }

    if (status) status.textContent = 'This browser does not support full screen from the page.';
  } catch (err) {
    if (status) status.textContent = 'Full screen was blocked. Try Add to Home Screen for app mode.';
  }
}

function updateFullscreenStatus(message) {
  const button = byId('fullscreenToggle');
  const status = byId('fullscreenStatus');
  const isFullscreen = Boolean(document.fullscreenElement);

  if (button) {
    button.innerHTML = isFullscreen
      ? '<i data-lucide="minimize"></i> Exit full screen'
      : '<i data-lucide="maximize"></i> Full screen';
  }

  if (status) {
    status.textContent = message || (isFullscreen
      ? 'Full screen is active.'
      : 'For the most app-like mobile mode, use this or Add to Home Screen.');
  }

  window.__icons?.render?.(mainPage);
}

document.addEventListener('fullscreenchange', () => updateFullscreenStatus());

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatRate(bytesPerSecond) {
  return `${formatBytes(bytesPerSecond)}/s`;
}

function formatTime(value) {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function capitalize(value) {
  return String(value || '').charAt(0).toUpperCase() + String(value || '').slice(1);
}

menuBtn.addEventListener('click', () => {
  setPanelOpen(!panel.classList.contains('open'));
});
closeBtn.addEventListener('click', () => setPanelOpen(false));
document.addEventListener('pointerdown', event => {
  if (!panel.classList.contains('open')) return;
  if (panel.contains(event.target) || menuBtn.contains(event.target)) return;
  setPanelOpen(false);
});
window.addEventListener('hal:memory-changed', () => {
  if (currentRoute === 'memory') fetchMemoryManager({ silent: true });
});
bootstrapAdminBtn?.addEventListener('click', bootstrapAdmin);
signOutBtn?.addEventListener('click', signOut);

setLowerBannerRoute('chat');
loadMenuLanding();
renderMenuIcons();
fetchAccount();

window.__menu = {
  open: () => setPanelOpen(true),
  close: () => setPanelOpen(false),
  load: loadMainPage,
  current: () => currentRoute
};
