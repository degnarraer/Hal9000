const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

test('Ollama default model residency is driven by authenticated user presence', () => {
  const server = read('server/index.js');
  const app = read('public/app.js');
  const modelsPage = read('public/menu-pages/models.html');
  const modelsMenu = read('public/menu/models.js');

  assert.match(server, /app\.post\('\/api\/ollama\/presence'/);
  assert.match(server, /function defaultOllamaModel\(\)/);
  assert.match(server, /function requireDefaultOllamaModel\(\)/);
  assert.match(server, /ollamaConfig\.current\(\)\.defaultModel/);
  assert.doesNotMatch(server, /const DEFAULT_MODEL/);
  assert.doesNotMatch(server, /'llama2'/);
  assert.match(server, /markOllamaUserPresence\(req\)/);
  assert.match(server, /async function resolvePresenceOllamaModel\(\)/);
  assert.doesNotMatch(server, /warming an installed AUTO-selected model instead/);
  assert.match(server, /Default model warm skipped because configured default model/);
  assert.match(server, /warmDefaultOllamaModel\(reason\)/);
  assert.match(server, /unloadDefaultOllamaModel\('presence-idle'\)/);
  assert.match(server, /ollamaKeepAlivePayload/);
  assert.match(server, /keep_alive: keepAliveForActiveUsers\(\)/);
  assert.match(server, /const keepAlive = ollamaKeepAlivePayload\(ollamaConfig\.current\(\)\.activeKeepAlive\)/);
  assert.match(server, /const OLLAMA_LOAD_PROMPT = 'Return OK\.'/);
  assert.match(server, /const OLLAMA_LOAD_OPTIONS = Object\.freeze\(\{ num_predict: 1, temperature: 0 \}\)/);
  assert.match(server, /lastOllamaPresenceError/);
  assert.match(server, /prompt:\s*OLLAMA_LOAD_PROMPT/);
  assert.match(server, /options:\s*OLLAMA_LOAD_OPTIONS/);
  assert.match(server, /unloadNonDefaultOllamaModels\(model, 'presence-default-reconcile'\)/);
  assert.match(server, /function unloadNonDefaultOllamaModels\(defaultModel/);
  assert.match(server, /\/api\/ps/);
  assert.match(app, /fetch\('\/api\/ollama\/presence'/);
  assert.match(app, /setInterval\(sendOllamaPresence, 15000\)/);
  assert.match(modelsPage, /id="ollamaActiveKeepAlive"/);
  assert.match(modelsPage, /id="ollamaIdleUnloadDelayMs"/);
  assert.match(modelsMenu, /activeKeepAlive/);
  assert.match(modelsMenu, /idleUnloadDelayMs/);
});

test('served app assets and menu partials use server-start cache busting', () => {
  const server = read('server/index.js');
  const menu = read('public/menu.js');

  assert.match(server, /const ASSET_VERSION = String\(Date\.now\(\)\)/);
  assert.match(server, /window\.__assetVersion/);
  assert.match(server, /injectServerStartAssetVersions/);
  assert.match(menu, /window\.__assetVersion/);
  assert.match(menu, /pageUrl\.searchParams\.set\('v', window\.__assetVersion\)/);
});

test('Models admin page sets default model from installed model rows', () => {
  const modelsPage = read('public/menu-pages/models.html');
  const modelsMenu = read('public/menu/models.js');
  const css = read('public/style.css');

  assert.doesNotMatch(modelsPage, /id="ollamaDefaultModel"/);
  assert.match(modelsMenu, /data-default-model/);
  assert.match(modelsMenu, /function saveDefaultModel\(model\)/);
  assert.match(modelsMenu, /const defaultModel = currentOllamaConfig\?\.defaultModel \|\| ''/);
  assert.match(modelsMenu, /defaultModel: name/);
  assert.match(modelsMenu, /await fetchOllamaConfig\(\)/);
  assert.match(modelsMenu, /configPath/);
  assert.match(modelsMenu, /Make default/);
  assert.match(modelsMenu, /Default/);
  assert.match(css, /\.model-default-toggle/);
});

test('Ollama config path is persistent in docker deployments', () => {
  const compose = read('docker-compose.yml');
  const config = read('server/ollamaConfig.js');
  const server = read('server/index.js');

  assert.match(config, /process\.env\.OLLAMA_CONFIG_PATH/);
  assert.match(server, /configPath: ollamaConfig\.configPath/);
  assert.match(config, /fs\.mkdirSync\(path\.dirname\(configPath\), \{ recursive: true \}\)/);
  assert.match(compose, /OLLAMA_CONFIG_PATH: \/data\/ollama\.config\.json/);
  assert.doesNotMatch(compose, /OLLAMA_MODEL: \$\{OLLAMA_MODEL:-llama2\}/);
  assert.match(compose, /- app_data:\/data/);
  assert.match(compose, /app_data:/);
});

test('Bob chat tester can select installed models while production chat uses default model', () => {
  const tester = read('public/menu/bob-chat-tester.js');
  const app = read('public/app.js');
  const monitor = read('public/menu/monitor.js');
  const webSearch = read('public/menu/web-search.js');
  const server = read('server/index.js');

  assert.match(tester, /option\.textContent = model === configuredDefault \? `\$\{model\} \(default\)` : model/);
  assert.match(tester, /body: JSON\.stringify\(\{ model, prompt, modelRules: readModelRules\(\) \}\)/);
  assert.doesNotMatch(tester, /AUTO \(router chooses\)/);
  assert.doesNotMatch(tester, /bobChatTesterSelectedModel/);
  assert.doesNotMatch(tester, /localStorage\.setItem\(selectedModelKey/);
  assert.doesNotMatch(monitor, /localStorage\.getItem\('selectedModel'\)/);
  assert.doesNotMatch(webSearch, /localStorage\.getItem\('selectedModel'\)/);
  assert.doesNotMatch(app, /model=\$\{encodeURIComponent\(model\)\}/);
  assert.match(server, /app\.post\('\/api\/chat'[\s\S]*?const model = await requireInstalledDefaultOllamaModel\(\)/);
  assert.match(server, /app\.get\('\/api\/stream'[\s\S]*?const model = await requireInstalledDefaultOllamaModel\(\)/);
  assert.doesNotMatch(server, /requestedModel:\s*model \|\| defaultOllamaModel\(\)/);
});

test('Bob chat tester speaks final web-search responses when no stream speech arrives', () => {
  const tester = read('public/menu/bob-chat-tester.js');

  assert.match(tester, /let testerSpeechReceivedStream = false/);
  assert.match(tester, /if \(!testerSpeechReceivedStream && data\.data\?\.response\)/);
  assert.match(tester, /queueTesterStreamingSpeech\(data\.data\.response\)/);
  assert.match(tester, /function testerSpeakableText\(text\)/);
  assert.match(tester, /\.replace\(\/\\n\\s\*Sources:/);
  assert.match(tester, /\.replace\(\/\\\[\(\[\^\\\]\]\+\)\\\]\\\(\(\[\^\)\]\+\)\\\)\/g, '\$1'\)/);
});

test('Ollama strict JSON requests disable thinking with retry fallback', () => {
  const server = read('server/index.js');

  assert.match(server, /think: false/);
  assert.match(server, /shouldRetryWithoutThinkFalse/);
  assert.match(server, /retrying without think flag/);
  assert.match(server, /parseJsonObject\(thinkingText\)/);
  assert.match(server, /reason: 'router-stage', think: false/);
  assert.match(server, /reason: 'bob-chat-response'[\s\S]*?think: false/);
  assert.match(server, /async function getErrorTextAsync\(err\)/);
});
