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

const panelBackdrop = document.createElement('div');
panelBackdrop.id = 'slidePanelBackdrop';
panelBackdrop.className = 'slide-panel-backdrop';
panelBackdrop.setAttribute('aria-hidden', 'true');

menuBtn.style.cssText = (menuBtn.style.cssText || '') + 'z-index:10000;';
panel.style.cssText = (panel.style.cssText || '') + 'position:fixed;right:0;top:0;bottom:var(--lower-banner-reserve);width:min(360px, calc(100vw - 16px));z-index:20000;transform:translateX(100%);transition:transform 240ms ease;pointer-events:none;';
document.body.appendChild(panelBackdrop);
document.body.appendChild(panel);

function applyPanelOpenState(isOpen) {
  panel.hidden = false;
  panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  panel.style.display = 'flex';
  panel.style.visibility = 'visible';
  panel.style.opacity = '1';
  panel.style.transform = isOpen ? 'translateX(0)' : 'translateX(100%)';
  panel.style.pointerEvents = isOpen ? 'auto' : 'none';
  panel.classList.toggle('open', isOpen);
  panelBackdrop.classList.toggle('open', isOpen);

  const currentMenuBtn = document.getElementById('fabMenu');
  currentMenuBtn?.classList.toggle('open', isOpen);
  currentMenuBtn?.setAttribute('aria-expanded', String(isOpen));
}

function togglePanelChrome(event) {
  event?.preventDefault();
  event?.stopPropagation();
  if (event) event.__menuToggleHandled = true;
  const shouldOpen = !panel.classList.contains('open');
  applyPanelOpenState(shouldOpen);
  if (shouldOpen) window.__hydrateMenuPanel?.();
  else window.__dehydrateMenuPanel?.();
}

menuBtn.addEventListener('click', togglePanelChrome);
document.addEventListener('click', event => {
  if (event.__menuToggleHandled) return;
  if (!event.target.closest?.('#fabMenu')) return;
  togglePanelChrome(event);
}, true);
panel.querySelector('#closePanel')?.addEventListener('click', event => {
  event.preventDefault();
  applyPanelOpenState(false);
});

function absorbPanelEvent(event) {
  if (!panel.classList.contains('open')) return;
  event.stopPropagation();
}

function closeFromBackdrop(event) {
  if (!panel.classList.contains('open')) return;
  event.preventDefault();
  event.stopPropagation();
  setPanelOpen(false);
}

['pointerdown', 'pointerup', 'click', 'touchstart', 'touchmove', 'touchend', 'wheel'].forEach(type => {
  panel.addEventListener(type, absorbPanelEvent, { passive: type === 'wheel' ? false : true });
});
['pointerdown', 'click', 'touchstart', 'touchmove', 'wheel'].forEach(type => {
  panelBackdrop.addEventListener(type, closeFromBackdrop, { passive: false });
});

const main = document.querySelector('.main');
const mainContent = document.getElementById('mainContent');
const chatContainer = document.querySelector('.chat-container');
const lowerBanner = document.getElementById('lowerBanner');
const menuInputSection = document.querySelector('.input-section');
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
  mainPage.querySelectorAll('[data-admin-external]').forEach(button => {
    button.addEventListener('click', () => openAdminExternal(button.dataset.adminExternal));
  });
}

const routes = {
  skills: { title: 'Skills Menu', url: '/menu-pages/skills.html', init: initSkills },
  memory: { title: "Bob's Memory", url: '/menu-pages/memory.html', init: initMemory },
  memoryRequirements: { title: "Bob's Memory Requirements", url: '/menu-pages/memory-requirements.html', init: initMemoryRequirements },
  webSearch: { title: 'Web Search Summary', url: '/menu-pages/web-search.html', init: initWebSearchSkill },
  yahoo: { title: 'Yahoo', url: '/menu-pages/yahoo.html', init: initYahooSkill },
  userChat: { title: 'User Chat', url: '/menu-pages/user-chat.html', init: initUserChat },
  admin: { title: 'Admin Menu', url: '/menu-pages/admin.html', init: initAdminMenu, admin: true },
  users: { title: 'Users', url: '/menu-pages/users.html', init: initUsers, admin: true },
  models: { title: 'Models', url: '/menu-pages/models.html', init: initModels, admin: true },
  monitor: { title: 'Monitor', url: '/menu-pages/monitor.html', init: initMonitor, admin: true },
  logging: { title: 'Logging', url: '/menu-pages/logging.html', init: initLogging, admin: true },
  tests: { title: 'Tests', url: '/menu-pages/tests.html', init: initAdminMenu, admin: true },
  appTester: { title: "Bob's Face", url: '/menu-pages/app-tester.html', init: initAppTester, admin: true },
  bobChatTester: { title: 'Bob Chat Tester', url: '/menu-pages/bob-chat-tester.html', init: initBobChatTester, admin: true },
  activity: { title: 'Activity', url: '/menu-pages/activity.html', init: initActivity, admin: true },
  security: { title: 'Security', url: '/menu-pages/security.html', init: initSecurity, admin: true },
  remote: { title: 'Remote Control', url: '/menu-pages/remote.html', init: initRemote, admin: true },
  settings: { title: 'Settings', url: '/menu-pages/settings.html', init: initSettings }
};

const menuSubmenus = {
  skills: {
    title: 'Skills Menu',
    items: [
      { route: 'memory', icon: 'brain', title: "Bob's Memory", description: "Review chat memory and Bob's summaries." },
      { route: 'webSearch', icon: 'search', title: 'Web Search Summary', description: 'Search current web results and summarize them with sources.' },
      { route: 'yahoo', icon: 'mail', title: 'Yahoo', description: 'Link Yahoo with OAuth and manage Bob access.' }
    ]
  },
  admin: {
    title: 'Admin Menu',
    admin: true,
    items: [
      { route: 'users', icon: 'users', title: 'Users', description: 'Review seen users and manage admin access.' },
      { route: 'models', icon: 'boxes', title: 'Models', description: 'Install, remove, and download Bob models.' },
      { route: 'monitor', icon: 'activity', title: 'Monitor', description: 'Check the current Bob server state.' },
      { route: 'tests', icon: 'flask-conical', title: 'Tests', description: 'Open Bob face, voice, and chat contract test tools.' },
      { route: 'logging', icon: 'logs', title: 'Logging', description: 'Watch recent server activity.' },
      { route: 'activity', icon: 'chart-line', title: 'Activity', description: 'Track users, actions, and connection rates.' },
      { route: 'security', icon: 'shield-alert', title: 'Security', description: 'Review auth failures and admin access denials.' },
      { external: 'vaultwarden', icon: 'vault', title: 'Vaultwarden', description: 'Open the secrets vault and admin panel.' },
      { route: 'remote', icon: 'power', title: 'Remote Control', description: 'Restart the local server process.' }
    ]
  },
  tests: {
    title: 'Tests',
    admin: true,
    items: [
      { route: 'appTester', icon: 'flask-conical', title: "Bob's Face", description: 'Test Bob face rendering and the configured voice.' },
      { route: 'bobChatTester', icon: 'file-json-2', title: 'Bob Chat Tester', description: 'Test Bob chat responses against the JSON contract.' }
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
  if (menuInputSection) menuInputSection.hidden = !isChat;
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
  applyPanelOpenState(isOpen);
  if (isOpen) {
    window.__hydrateMenuPanel?.();
  } else {
    window.__dehydrateMenuPanel?.();
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
    menuContent.querySelectorAll('[data-menu-external]').forEach(button => {
      button.addEventListener('click', () => openAdminExternal(button.dataset.menuExternal));
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
    <button class="menu-item" type="button" ${item.external ? `data-menu-external="${escapeHtml(item.external)}"` : `data-menu-route="${escapeHtml(item.route)}"`}>
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
      const routeName = button.dataset.menuRoute;
      if (menuSubmenus[routeName]) {
        loadMainPage(routeName, { refreshMenu: false });
        slideToSubmenu(routeName);
        return;
      }
      loadMainPage(routeName, { refreshMenu: false });
      menuContent.querySelectorAll('[data-menu-route]').forEach(item => {
        item.classList.toggle('active', item === button);
      });
    });
  });
  menuContent.querySelectorAll('[data-menu-external]').forEach(button => {
    button.addEventListener('click', () => openAdminExternal(button.dataset.menuExternal));
  });
  renderMenuIcons();
  requestAnimationFrame(() => {
    menuContent.querySelector('.menu-slide-shell')?.classList.add('show-child');
  });
}

async function openAdminExternal(key) {
  if (!currentUser.isAdmin) return;

  try {
    const response = await fetchWithAuthRedirect('/api/admin/links', { cache: 'no-store' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Unable to load admin links');
    const url = json.data?.[key];
    if (!url) throw new Error('Admin link is not configured');
    window.location.href = url;
  } catch (err) {
    await window.__dialog.alert({ title: 'Admin Link Unavailable', message: err.message });
  }
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
  if (currentRoute === 'userChat' && routeName !== 'userChat') stopUserChat();

  if (routeName === 'chat') {
    currentRoute = 'chat';
    document.body.classList.remove('bob-chat-tester-route');
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
    document.body.classList.remove('bob-chat-tester-route');
    mainPage.hidden = true;
    mainPage.innerHTML = '';
    chatContainer.hidden = false;
    setLowerBannerRoute('chat');
    setPanelOpen(false);
    return;
  }

  currentRoute = routeName;
  document.body.classList.toggle('bob-chat-tester-route', routeName === 'bobChatTester');
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

const USER_CHAT_KEYPAIR_STORAGE = 'halUserChatEcdhKeyPair.v1';
const USER_CHAT_ENTROPY_TARGET = 80;
let userChatState = null;

async function initUserChat() {
  const usersEl = byId('userChatUsers');
  const messagesEl = byId('userChatMessages');
  const statusEl = byId('userChatStatus');
  const form = byId('userChatForm');
  const input = byId('userChatInput');
  const send = byId('userChatSend');
  const refresh = byId('userChatRefresh');
  const search = byId('userChatSearch');

  if (!window.crypto?.subtle) {
    statusEl.textContent = 'Crypto unavailable';
    messagesEl.innerHTML = '<div class="menu-error">This browser does not support WebCrypto ECDH encryption.</div>';
    return;
  }

  try {
    userChatState = {
      keyPair: await loadOrCreateUserChatKeyPair(),
      users: [],
      selected: null,
      timer: null
    };

    await publishUserChatPublicKey(userChatState.keyPair.publicKey);
    await refreshUserChatUsers();
    refresh?.addEventListener('click', refreshUserChatUsers);
    form?.addEventListener('submit', async event => {
      event.preventDefault();
      await sendUserChatMessage();
    });
  } catch (err) {
    statusEl.textContent = 'Unavailable';
    messagesEl.innerHTML = `<div class="menu-error">${escapeHtml(err.message)}</div>`;
    usersEl.innerHTML = '';
  }

  async function refreshUserChatUsers() {
    statusEl.textContent = 'Syncing';
    try {
      const query = String(search?.value || '').trim();
      const response = await fetchWithAuthRedirect(`/api/user-chat/users${query ? `?q=${encodeURIComponent(query)}` : ''}`, { cache: 'no-store' });
      const json = await response.json();
      if (!json.ok) throw new Error(json.error || 'Unable to load users');
      userChatState.users = json.data || [];
      renderUserChatUsers();
      statusEl.textContent = 'Encrypted';
    } catch (err) {
      statusEl.textContent = 'Offline';
      usersEl.innerHTML = `<div class="menu-error">${escapeHtml(err.message)}</div>`;
    }
  }

  function renderUserChatUsers() {
    const users = userChatState.users;

    usersEl.innerHTML = users.map(user => `
      <button class="user-chat-user${userChatState.selected?.userKey === user.userKey ? ' active' : ''}" type="button" data-user-key="${escapeHtml(user.userKey)}" ${user.isSelf || !user.canChat ? 'disabled' : ''}>
        <i data-lucide="${user.isSelf ? 'user-round-check' : user.canChat ? 'user' : 'user-x'}"></i>
        <span>
          <strong>${escapeHtml(user.name)}</strong>
          <small>${escapeHtml(user.isSelf ? `You - ${user.fingerprint || 'key ready'}` : user.canChat ? (user.fingerprint || user.email || user.userKey) : 'User found - waiting for chat key')}</small>
        </span>
      </button>
    `).join('') || `<div class="menu-loading">${search?.value ? 'No matching users.' : 'No users found yet.'}</div>`;

    usersEl.querySelectorAll('[data-user-key]').forEach(button => {
      button.addEventListener('click', () => selectUserChatPeer(button.dataset.userKey));
    });
    window.__icons?.render?.(mainPage);
  }

  let searchTimer;
  function scheduleUserChatSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refreshUserChatUsers, 180);
  }

  async function selectUserChatPeer(userKey) {
    userChatState.selected = userChatState.users.find(user => user.userKey === userKey) || null;
    byId('userChatPeerName').textContent = userChatState.selected?.name || 'Select a user';
    byId('userChatPeerMeta').textContent = userChatState.selected?.fingerprint
      ? `Verify fingerprint: ${userChatState.selected.fingerprint}`
      : userChatState.selected?.email || userChatState.selected?.userKey || 'Messages are encrypted in this browser before they reach the server.';
    input.disabled = !userChatState.selected;
    send.disabled = !userChatState.selected;
    usersEl.querySelectorAll('.user-chat-user').forEach(button => {
      button.classList.toggle('active', button.dataset.userKey === userKey);
    });
    await loadUserChatThread();
    clearInterval(userChatState.timer);
    userChatState.timer = setInterval(loadUserChatThread, 8000);
  }

  async function loadUserChatThread() {
    if (!userChatState?.selected) return;
    const response = await fetchWithAuthRedirect(`/api/user-chat/messages?with=${encodeURIComponent(userChatState.selected.userKey)}&limit=100`, { cache: 'no-store' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Unable to load messages');
    const rows = await Promise.all((json.data || []).map(decryptUserChatRow));
    messagesEl.innerHTML = rows.map(row => `
      <div class="user-chat-message ${row.direction}">
        <p>${escapeHtml(row.text)}</p>
        <small>${escapeHtml(new Date(row.createdAt).toLocaleString())}</small>
      </div>
    `).join('') || '<div class="menu-loading">No messages with this user yet.</div>';
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function sendUserChatMessage() {
    const text = input.value.trim();
    if (!text || !userChatState?.selected) return;
    input.value = '';
    send.disabled = true;
    try {
      const encrypted = await encryptUserChatText(text, userChatState.selected.publicKeyJwk);
      const response = await fetchWithAuthRedirect('/api/user-chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientKey: userChatState.selected.userKey,
          ...encrypted
        })
      });
      const json = await response.json();
      if (!json.ok) throw new Error(json.error || 'Unable to send message');
      await loadUserChatThread();
    } catch (err) {
      await window.__dialog.alert({ title: 'Encrypted Chat Failed', message: err.message });
    } finally {
      send.disabled = false;
      input.focus();
    }
  }

  search?.addEventListener('input', scheduleUserChatSearch);
}

function stopUserChat() {
  if (userChatState?.timer) clearInterval(userChatState.timer);
  userChatState = null;
}

async function loadOrCreateUserChatKeyPair() {
  const stored = JSON.parse(localStorage.getItem(USER_CHAT_KEYPAIR_STORAGE) || 'null');
  if (stored?.privateKeyJwk && stored?.publicKeyJwk) {
    return {
      privateKey: await crypto.subtle.importKey('jwk', stored.privateKeyJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']),
      publicKey: await crypto.subtle.importKey('jwk', stored.publicKeyJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, [])
    };
  }

  const entropy = await collectUserChatEntropy();
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const publicKeyJwk = await exportUserChatPublicKey(keyPair.publicKey);
  const fingerprint = await userChatFingerprint(publicKeyJwk);
  localStorage.setItem(USER_CHAT_KEYPAIR_STORAGE, JSON.stringify({
    privateKeyJwk: await crypto.subtle.exportKey('jwk', keyPair.privateKey),
    publicKeyJwk,
    entropyDigest: entropy.digest,
    fingerprint,
    createdAt: new Date().toISOString()
  }));
  return keyPair;
}

async function exportUserChatPublicKey(publicKey) {
  return crypto.subtle.exportKey('jwk', publicKey);
}

async function publishUserChatPublicKey(publicKey) {
  const stored = JSON.parse(localStorage.getItem(USER_CHAT_KEYPAIR_STORAGE) || '{}');
  const response = await fetchWithAuthRedirect('/api/user-chat/key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKeyJwk: await exportUserChatPublicKey(publicKey),
      fingerprint: stored.fingerprint || ''
    })
  });
  const json = await response.json();
  if (!json.ok) throw new Error(json.error || 'Unable to publish chat key');
}

function collectUserChatEntropy() {
  return new Promise(resolve => {
    const samples = [];
    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const overlay = document.createElement('div');
    overlay.className = 'entropy-overlay';
    overlay.innerHTML = `
      <div class="entropy-dialog" role="dialog" aria-modal="true" aria-labelledby="entropyTitle">
        <div class="entropy-header">
          <span><i data-lucide="shield-check"></i></span>
          <h2 id="entropyTitle">Create Chat Key</h2>
        </div>
        <p>Move around the field, click, or type until the meter fills. This adds a human randomness ceremony before your browser creates the end-to-end chat key.</p>
        <div id="entropyPad" class="entropy-pad" tabindex="0">
          <div id="entropyTrace" class="entropy-trace"></div>
        </div>
        <div class="entropy-meter"><span id="entropyMeter"></span></div>
        <button id="entropyContinue" type="button" disabled><i data-lucide="key-round"></i> Create encrypted chat key</button>
      </div>
    `;

    const pad = overlay.querySelector('#entropyPad');
    const trace = overlay.querySelector('#entropyTrace');
    const meter = overlay.querySelector('#entropyMeter');
    const button = overlay.querySelector('#entropyContinue');

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    function addSample(event) {
      event.preventDefault();
      event.stopPropagation();
      const rect = pad.getBoundingClientRect();
      const point = {
        type: event.type,
        x: Math.round((event.clientX || 0) - rect.left),
        y: Math.round((event.clientY || 0) - rect.top),
        t: Math.round(performance.now() * 1000),
        k: event.key || '',
        r: Array.from(crypto.getRandomValues(new Uint8Array(4))).join(',')
      };
      samples.push(point);
      const percent = Math.min(100, Math.round((samples.length / USER_CHAT_ENTROPY_TARGET) * 100));
      meter.style.width = `${percent}%`;
      trace.style.transform = `translate(${Math.max(0, Math.min(rect.width - 18, point.x))}px, ${Math.max(0, Math.min(rect.height - 18, point.y))}px)`;
      if (samples.length >= USER_CHAT_ENTROPY_TARGET) button.disabled = false;
    }

    async function finish() {
      const material = JSON.stringify({
        samples,
        random: Array.from(randomBytes),
        userAgent: navigator.userAgent,
        createdAt: new Date().toISOString()
      });
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
      overlay.remove();
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      resolve({ digest: arrayBufferToBase64(digest) });
    }

    function trapTouch(event) {
      event.preventDefault();
      event.stopPropagation();
    }

    overlay.addEventListener('touchstart', trapTouch, { passive: false });
    overlay.addEventListener('touchmove', trapTouch, { passive: false });
    overlay.addEventListener('wheel', trapTouch, { passive: false });
    pad.addEventListener('pointermove', addSample, { passive: false });
    pad.addEventListener('pointerdown', addSample, { passive: false });
    pad.addEventListener('keydown', addSample);
    button.addEventListener('click', finish);
    document.body.appendChild(overlay);
    window.__icons?.render?.(overlay);
    pad.focus();
  });
}

async function userChatFingerprint(publicKeyJwk) {
  const canonical = JSON.stringify({
    crv: publicKeyJwk.crv,
    kty: publicKeyJwk.kty,
    x: publicKeyJwk.x,
    y: publicKeyJwk.y
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .match(/.{1,4}/g)
    .join('-')
    .toUpperCase();
}

async function deriveUserChatAesKey(publicKeyJwk) {
  const publicKey = await crypto.subtle.importKey('jwk', publicKeyJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: publicKey },
    userChatState.keyPair.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptUserChatText(text, recipientPublicKeyJwk) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveUserChatAesKey(recipientPublicKeyJwk);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv)
  };
}

async function decryptUserChatRow(row) {
  try {
    const peerKey = row.direction === 'sent'
      ? userChatState.selected.publicKeyJwk
      : row.senderPublicKeyJwk;
    const key = await deriveUserChatAesKey(peerKey);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToUint8Array(row.iv) },
      key,
      base64ToUint8Array(row.ciphertext)
    );
    return { ...row, text: new TextDecoder().decode(plaintext) };
  } catch (err) {
    return { ...row, text: '[Unable to decrypt on this device]' };
  }
}

function arrayBufferToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToUint8Array(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

window.__hydrateMenuPanel = () => {
  main?.classList.add('panel-open');
  fetchAccount();
  loadMenuLanding();
};

window.__dehydrateMenuPanel = () => {
  main?.classList.remove('panel-open');
};

function togglePanel(event) {
  togglePanelChrome(event);
}

document.addEventListener('click', event => {
  if (event.__menuToggleHandled) return;
  const button = event.target.closest?.('#fabMenu');
  if (!button) return;
  togglePanel(event);
});
closeBtn?.addEventListener('click', () => setPanelOpen(false));
document.addEventListener('pointerdown', event => {
  if (!panel.classList.contains('open')) return;
  if (panel.contains(event.target) || event.target.closest?.('#fabMenu')) return;
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
