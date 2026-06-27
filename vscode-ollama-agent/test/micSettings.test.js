const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { createMicSettingsStore, normalizeMicSettings } = require('../server/micSettings');

const repoRoot = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('mic settings normalize the selected transcription provider', () => {
  assert.deepEqual(normalizeMicSettings({}), { transcriptionProvider: 'pipeline' });
  assert.deepEqual(normalizeMicSettings({ transcriptionProvider: 'pipeline' }), { transcriptionProvider: 'pipeline' });
  assert.deepEqual(normalizeMicSettings({ transcriptionProvider: 'server' }), { transcriptionProvider: 'server' });
  assert.deepEqual(normalizeMicSettings({ transcriptionProvider: 'browser' }), { transcriptionProvider: 'browser' });
  assert.deepEqual(normalizeMicSettings({ provider: 'SERVER' }), { transcriptionProvider: 'server' });
  assert.deepEqual(normalizeMicSettings({ transcriptionProvider: 'bad-value' }), { transcriptionProvider: 'pipeline' });
});

test('mic settings store persists provider selection', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bob-mic-settings-'));
  const settingsPath = path.join(dir, 'mic.json');
  const store = createMicSettingsStore(null, { settingsPath });

  assert.equal(store.current().transcriptionProvider, 'pipeline');
  assert.equal(store.save({ transcriptionProvider: 'server' }).transcriptionProvider, 'server');

  const reloaded = createMicSettingsStore(null, { settingsPath });
  assert.equal(reloaded.current().transcriptionProvider, 'server');
});

test('admin menu exposes Microphone Services page', () => {
  const menuJs = read('public/menu.js');
  const adminHtml = read('public/menu-pages/admin.html');
  const indexHtml = read('public/index.html');
  const pageHtml = read('public/menu-pages/mic-services.html');
  const pageJs = read('public/menu/mic-services.js');

  assert.match(menuJs, /micServices:\s*\{\s*title:\s*'Microphone Services'/);
  assert.match(menuJs, /route:\s*'micServices'[\s\S]*title:\s*'Microphone Services'/);
  assert.match(adminHtml, /data-admin-route="micServices"/);
  assert.match(indexHtml, /\/menu\/mic-services\.js/);
  assert.match(pageHtml, /name="micTranscriptionProvider"[\s\S]*value="pipeline"/);
  assert.match(pageHtml, /name="micTranscriptionProvider"[\s\S]*value="auto"/);
  assert.match(pageHtml, /value="server"/);
  assert.match(pageHtml, /value="browser"/);
  assert.match(pageJs, /\/api\/admin\/mic-settings/);
  assert.match(pageJs, /provider === 'pipeline' \? \(data\.voicePipeline/);
  assert.match(pageJs, /stt\.model \|\| stt\.modelPath/);
});

test('mic settings are exposed through authenticated server endpoints', () => {
  const server = read('server/index.js');
  const compose = read('docker-compose.yml');

  assert.match(server, /const \{ createMicSettingsStore \} = require\('\.\/micSettings'\)/);
  assert.match(server, /app\.get\('\/api\/mic\/settings'/);
  assert.match(server, /app\.get\('\/api\/admin\/mic-settings', admin\.requireAdmin/);
  assert.match(server, /app\.post\('\/api\/admin\/mic-settings', admin\.requireAdmin/);
  assert.match(server, /voicePipeline: voicePipeline\.status\(\)/);
  assert.match(compose, /MIC_TRANSCRIPTION_PROVIDER: \$\{MIC_TRANSCRIPTION_PROVIDER:-pipeline\}/);
  assert.match(compose, /MIC_SETTINGS_PATH: \/data\/mic-settings\.json/);
});
