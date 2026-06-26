const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('mic button primes audio playback before starting microphone', () => {
  const micJs = read('public/mic.js');
  const clickHandler = micJs.match(/micToggle\.addEventListener\('click', async \(\) => \{([\s\S]*?)\n  \}\);/);

  assert.ok(clickHandler, 'mic click handler should be present');
  assert.match(clickHandler[1], /window\.__chat\?\.unlockAudio\?\.\(\)/);
  assert.match(clickHandler[1], /await startMic\(\)/);
  assert.ok(
    clickHandler[1].indexOf('window.__chat?.unlockAudio?.()') < clickHandler[1].indexOf('await startMic()'),
    'audio unlock should happen before the async microphone start'
  );
});

test('main chat primes mobile audio from the first user gesture', () => {
  const appJs = read('public/app.js');

  assert.match(appJs, /function primeAudioFromUserGesture\(\)/);
  assert.match(appJs, /document\.addEventListener\('pointerdown', primeAudioFromUserGesture, true\)/);
  assert.match(appJs, /document\.addEventListener\('touchend', primeAudioFromUserGesture, true\)/);
  assert.match(appJs, /unlockedSpeechAudio\.volume = 0/);
  assert.match(appJs, /unlockedSpeechAudio\.volume = 1/);
});

test('main chat defaults to AUTO model selection across devices', () => {
  const appJs = read('public/app.js');

  assert.match(appJs, /const defaultModel = 'AUTO'/);
  assert.match(appJs, /const selectedModelVersion = '2'/);
  assert.match(appJs, /localStorage\.getItem\(selectedModelVersionKey\) === selectedModelVersion/);
  assert.match(appJs, /autoOption\.value = 'AUTO'/);
  assert.match(appJs, /autoOption\.textContent = 'AUTO \(router chooses\)'/);
  assert.match(appJs, /previousValue === 'AUTO' \|\| models\.includes\(previousValue\) \? previousValue : 'AUTO'/);
  assert.match(appJs, /localStorage\.setItem\(selectedModelVersionKey, selectedModelVersion\)/);
});

test('mic active state reveals the voice card', () => {
  const micJs = read('public/mic.js');
  const css = read('public/style.css');

  assert.match(micJs, /inputSection\?\.classList\.toggle\('mic-active', isRunning\)/);
  assert.match(css, /\.input-section\.mic-active \.composer-voice\{[^}]*opacity:1/);
});

test('mic panel opens before mobile permission promise resolves', () => {
  const micJs = read('public/mic.js');
  const startMicBody = micJs.match(/async function startMic\(\) \{([\s\S]*?)\nfunction stopMic\(\)/);

  assert.ok(startMicBody, 'startMic body should be present');
  assert.ok(
    startMicBody[1].indexOf('setMicButtonState(true)') < startMicBody[1].indexOf('await navigator.mediaDevices.getUserMedia'),
    'mic UI should become active before awaiting mobile microphone permission'
  );
});

test('mobile mic card is viewport anchored above the input bar', () => {
  const css = read('public/style.css');
  const mobileRule = css.match(/@media \(max-width: 768px\) \{[\s\S]*?\.composer-voice\{([^}]*)\}/);

  assert.ok(mobileRule, 'mobile composer voice rule should be present');
  assert.match(mobileRule[1], /position:fixed/);
  assert.match(mobileRule[1], /bottom:calc\(84px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(mobileRule[1], /z-index:30005/);
});

test('mobile layout avoids fixed card and content limits', () => {
  const css = read('public/style.css');
  const mobileBlock = css.match(/@media \(max-width: 768px\) \{([\s\S]*)\n\}/);

  assert.ok(mobileBlock, 'mobile responsive block should be present');
  assert.doesNotMatch(mobileBlock[1], /\.voice-panel\{[^}]*height:150px/);
  assert.doesNotMatch(mobileBlock[1], /\.bob-chat-tester-grid\{[^}]*minmax\(320px/);
  assert.doesNotMatch(mobileBlock[1], /\.bob-chat-test-conversation\{[^}]*min-height:320px/);
  assert.doesNotMatch(mobileBlock[1], /\.bob-chat-trace-table\{[^}]*min-width:1040px/);
  assert.doesNotMatch(mobileBlock[1], /\.bob-chat-test-messages\{[^}]*min-height:220px/);
  assert.doesNotMatch(mobileBlock[1], /\.user-chat-people\{[^}]*max-height:220px/);
});

test('context usage chart fills the voice waveform column', () => {
  const css = read('public/style.css');
  const voicePanelRule = css.match(/\.voice-panel\.ai-voice\{([^}]*)\}/);
  const labelRule = css.match(/\.voice-panel\.ai-voice \.voice-label-row\{([^}]*)\}/);
  const controlsRule = css.match(/\.voice-panel\.ai-voice \.ai-card-controls\{([^}]*)\}/);
  const widgetRule = css.match(/\.bob-context-widget\{([^}]*)\}/);
  const canvasRule = css.match(/\.bob-context-widget canvas\{([^}]*)\}/);

  assert.ok(voicePanelRule, 'voice panel rule should be present');
  assert.ok(labelRule, 'voice label row rule should be present');
  assert.ok(controlsRule, 'voice controls rule should be present');
  assert.ok(widgetRule, 'context widget rule should be present');
  assert.ok(canvasRule, 'context canvas rule should be present');
  assert.match(voicePanelRule[1], /grid-template-columns:150px minmax\(0,1fr\)/);
  assert.match(voicePanelRule[1], /grid-template-rows:64px 64px/);
  assert.match(labelRule[1], /grid-column:1/);
  assert.match(labelRule[1], /grid-row:1 \/ 3/);
  assert.match(controlsRule[1], /width:150px/);
  assert.match(widgetRule[1], /grid-column:2/);
  assert.match(widgetRule[1], /grid-row:2/);
  assert.match(widgetRule[1], /width:100%/);
  assert.doesNotMatch(widgetRule[1], /grid-template-columns/);
  assert.match(canvasRule[1], /width:100%/);
});

test('Bob speech can be stopped and replayed from bot bubbles', () => {
  const html = read('public/index.html');
  const appJs = read('public/app.js');

  assert.match(html, /id="stopBobSpeech"/);
  assert.match(appJs, /const stopBobSpeech = document\.getElementById\('stopBobSpeech'\)/);
  assert.match(appJs, /function stopSpeechPlayback\(\)/);
  assert.match(appJs, /stopBobSpeech\?\.addEventListener\('click', stopSpeechPlayback\)/);
  assert.match(appJs, /div\.dataset\.speakText = text \|\| ''/);
  assert.match(appJs, /messagesEl\?\.addEventListener\('click'/);
  assert.match(appJs, /replayBobBubble\(bubble\)/);
});

test('touching Bob face toggles voice mute state', () => {
  const html = read('public/index.html');
  const appJs = read('public/app.js');
  const css = read('public/style.css');

  assert.match(html, /id="bobMuteToggle"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(appJs, /const bobMutedKey = 'bobVoiceMuted'/);
  assert.match(appJs, /function toggleBobMute\(\)/);
  assert.match(appJs, /bobMuteToggle\?\.addEventListener\('click', toggleBobMute\)/);
  assert.match(appJs, /currentAudio\.muted = bobVoiceMuted/);
  assert.match(appJs, /unlockedSpeechAudio\.muted = bobVoiceMuted/);
  assert.match(css, /\.bob-muted \.voice-panel\.ai-voice \.bob-voice-title/);
  assert.match(css, /\.bob-muted \.bob-face #bobMouth\{[^}]*stroke-dasharray:8 10/);
});
