const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { createDebugSettingsStore, normalizeDebugSettings } = require('../server/debugSettings');

const repoRoot = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('debug settings default to showing main chat debug pills', () => {
  assert.deepEqual(normalizeDebugSettings({}), { showChatDebugPills: true });
  assert.deepEqual(normalizeDebugSettings({ showChatDebugPills: false }), { showChatDebugPills: false });
  assert.deepEqual(normalizeDebugSettings({ showChatDebugPills: true }), { showChatDebugPills: true });
});

test('debug settings store persists chat debug pill visibility', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-debug-settings-'));
  const settingsPath = path.join(dir, 'debug.json');
  const store = createDebugSettingsStore(null, { settingsPath });

  assert.equal(store.current().showChatDebugPills, true);
  assert.equal(store.save({ showChatDebugPills: false }).showChatDebugPills, false);

  const reloaded = createDebugSettingsStore(null, { settingsPath });
  assert.equal(reloaded.current().showChatDebugPills, false);
});

test('admin menu exposes Debug Settings page', () => {
  const menuJs = read('public/menu.js');
  const adminHtml = read('public/menu-pages/admin.html');
  const indexHtml = read('public/index.html');

  assert.match(menuJs, /debugSettings:\s*\{\s*title:\s*'Debug Settings'/);
  assert.match(menuJs, /route:\s*'debugSettings'[\s\S]*title:\s*'Debug Settings'/);
  assert.match(adminHtml, /data-admin-route="debugSettings"/);
  assert.match(indexHtml, /\/menu\/debug-settings\.js/);
});

test('main chat debug pills are controlled by debug settings', () => {
  const appJs = read('public/app.js');
  const debugMenuJs = read('public/menu/debug-settings.js');

  assert.match(appJs, /let showChatDebugPills = true/);
  assert.match(appJs, /async function loadChatDebugSettings\(\)/);
  assert.match(appJs, /\/api\/admin\/debug-settings/);
  assert.match(appJs, /function applyChatDebugPillVisibility/);
  assert.match(appJs, /querySelector\('\.ollama-debug-rail'\)\?\.remove\(\)/);
  assert.match(appJs, /querySelector\('\.skill-rail'\)\?\.remove\(\)/);
  assert.match(appJs, /loadChatAdminState\(\)\.then\(loadChatDebugSettings\)\.finally\(loadMemoryHistory\)/);
  assert.match(appJs, /applyChatDebugPillVisibility/);
  assert.match(debugMenuJs, /showChatDebugPills/);
  assert.match(debugMenuJs, /window\.__chat\?\.applyChatDebugPillVisibility/);
});
