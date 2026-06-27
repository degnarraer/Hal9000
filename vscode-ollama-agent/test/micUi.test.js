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
  assert.match(micJs, /async function startMicFromUserButton\(\)/);
  assert.match(micJs, /function stopMicFromUserButton\(\)/);
  assert.match(micJs, /function emitMicDebug\(message, data = \{\}\)/);
  assert.match(micJs, /function micRuntimeSnapshot\(\)/);
  assert.match(micJs, /function startMicMainThreadStallDetector\(reason = 'mic-running'\)/);
  assert.match(micJs, /function stopMicMainThreadStallDetector\(\)/);
  assert.match(micJs, /function attachMicDeviceChangeDiagnostics\(\)/);
  assert.match(micJs, /navigator\.mediaDevices\.addEventListener\('devicechange'/);
  assert.match(micJs, /emitMicEvent\('media-device-change'/);
  assert.match(micJs, /attachMicDeviceChangeDiagnostics\(\)/);
  assert.match(micJs, /const MIC_MAIN_THREAD_STALL_INTERVAL_MS = 250/);
  assert.match(micJs, /const MIC_MAIN_THREAD_STALL_THRESHOLD_MS = 200/);
  assert.match(micJs, /const AUDIO_WORKLET_GAP_WARN_MS = 120/);
  assert.match(micJs, /emitMicDebug\('main thread stall detected'/);
  assert.match(micJs, /emitMicEvent\('diagnostic'/);
  assert.match(micJs, /emitMicDebug\('mic start requested'/);
  assert.match(micJs, /emitMicDebug\('mic start complete'/);
  assert.match(micJs, /emitMicDebug\('mic stop requested'/);
  assert.match(micJs, /emitMicDebug\('mic stop complete'/);
  assert.ok(
    micJs.indexOf('startMicMainThreadStallDetector(reason)') < micJs.indexOf('await requestMicrophoneStream()'),
    'main thread stall detection should start before awaiting microphone permission'
  );
  const stopMicBody = micJs.match(/function stopMic\(reason = 'internal'\) \{([\s\S]*?)\nasync function startMicFromUserButton/);
  assert.ok(stopMicBody, 'stopMic body should be present');
  assert.ok(
    stopMicBody[1].indexOf("emitMicDebug('mic stop requested'") < stopMicBody[1].indexOf('stopMicMainThreadStallDetector()'),
    'stop should log the request before stopping stall detection'
  );
  assert.match(micJs, /window\.__chat\?\.unlockAudio\?\.\(\)/);
  assert.match(clickHandler[1], /await startMicFromUserButton\(\)/);
  assert.match(clickHandler[1], /stopMicFromUserButton\(\)/);
  assert.ok(
    micJs.indexOf('window.__chat?.unlockAudio?.()') < micJs.indexOf("await startMic('gui-button');"),
    'audio unlock should happen before the async microphone start in the user-button path'
  );
  const micExport = micJs.match(/window\.__mic = \{([\s\S]*?)\n\};/);
  assert.ok(micExport, 'mic debug API should be present');
  assert.match(micExport[1], /startFromUserButton: startMicFromUserButton/);
  assert.match(micExport[1], /stopFromUserButton: stopMicFromUserButton/);
  assert.match(micExport[1], /getDiagnosticOptions: getMicDiagnosticOptions/);
  assert.match(micExport[1], /setDiagnosticOptions: setMicDiagnosticOptions/);
  assert.match(micExport[1], /defaultDiagnosticOptions: defaultMicDiagnosticOptions/);
  assert.doesNotMatch(micExport[1], /\bstartMic\b/);
  assert.doesNotMatch(micExport[1], /\bstopMic\b/);
});

test('main chat primes mobile audio from the first user gesture', () => {
  const appJs = read('public/app.js');

  assert.match(appJs, /function primeAudioFromUserGesture\(\)/);
  assert.match(appJs, /document\.addEventListener\('pointerdown', primeAudioFromUserGesture, true\)/);
  assert.match(appJs, /document\.addEventListener\('touchend', primeAudioFromUserGesture, true\)/);
  assert.match(appJs, /unlockedSpeechAudio\.volume = 0/);
  assert.match(appJs, /unlockedSpeechAudio\.volume = 1/);
});

test('main chat uses the server default model instead of per-device AUTO selection', () => {
  const appJs = read('public/app.js');
  const indexHtml = read('public/index.html');
  const css = read('public/style.css');

  assert.doesNotMatch(appJs, /const defaultModel = 'AUTO'/);
  assert.doesNotMatch(appJs, /selectedModelVersion/);
  assert.doesNotMatch(appJs, /modelSelect/);
  assert.doesNotMatch(appJs, /refreshModels/);
  assert.doesNotMatch(appJs, /loadChatModels/);
  assert.doesNotMatch(appJs, /autoOption\.value = 'AUTO'/);
  assert.doesNotMatch(appJs, /router chooses/);
  assert.doesNotMatch(appJs, /localStorage\.setItem\(selectedModelKey/);
  assert.doesNotMatch(indexHtml, /id="model"/);
  assert.doesNotMatch(indexHtml, /id="refreshModels"/);
  assert.doesNotMatch(indexHtml, /model-picker/);
  assert.doesNotMatch(css, /\.model-picker/);
  assert.match(appJs, /const url = `\/api\/stream\?prompt=\$\{encodeURIComponent\(prompt\)\}`/);
});

test('main chat stream errors show the server error text', () => {
  const appJs = read('public/app.js');

  assert.match(appJs, /function formatStreamErrorMessage\(value\)/);
  assert.match(appJs, /value\.error \|\| value\.message/);
  assert.match(appJs, /setMessageText\(botEl, formatStreamErrorMessage\(JSON\.parse\(event\.data\)\)\)/);
});

test('main chat reports render and stream pressure diagnostics', () => {
  const appJs = read('public/app.js');

  assert.match(appJs, /const APP_DIAGNOSTIC_WARN_MS = 60/);
  assert.match(appJs, /function emitAppDiagnostic\(area, detail = \{\}\)/);
  assert.match(appJs, /new CustomEvent\('bob:app-diagnostic'/);
  assert.match(appJs, /function measureAppWork\(area, work\)/);
  assert.match(appJs, /measureAppWork\('chat-render'/);
  assert.match(appJs, /evt\.onmessage = \(e\) => measureAppWork\('llm-stream'/);
  assert.match(appJs, /evt\.addEventListener\('bob-response', \(event\) => measureAppWork\('llm-stream'/);
});

test('clear chat removes visible messages before waiting on memory merge', () => {
  const appJs = read('public/app.js');
  const clearBody = appJs.match(/async function clearVisibleChat\(\) \{([\s\S]*?)\n\}/);

  assert.ok(clearBody, 'clearVisibleChat should be present');
  assert.ok(
    clearBody[1].indexOf('messagesEl.innerHTML = \'\';') < clearBody[1].indexOf("await fetch('/api/memory/merge'"),
    'visible chat should clear immediately after confirmation, before memory merge completes'
  );
  assert.ok(
    clearBody[1].indexOf('localStorage.setItem(visibleChatClearedAtKey') < clearBody[1].indexOf("await fetch('/api/memory/merge'"),
    'clear timestamp should be recorded before memory merge completes'
  );
});

test('mic active state reveals the voice card', () => {
  const micJs = read('public/mic.js');
  const css = read('public/style.css');

  assert.match(micJs, /inputSection\?\.classList\.toggle\('mic-active', isRunning\)/);
  assert.match(css, /\.composer\{[^}]*position:static/);
  assert.match(css, /\.composer-voice\{[^}]*left:10px;right:10px/);
  assert.match(css, /\.input-section\.mic-active \.composer-voice\{[^}]*opacity:1/);
});

test('mic panel opens before mobile permission promise resolves', () => {
  const micJs = read('public/mic.js');
  const startMicBody = micJs.match(/async function startMic\(reason = 'internal'\) \{([\s\S]*?)\nfunction stopMic\(/);

  assert.ok(startMicBody, 'startMic body should be present');
  assert.ok(
    startMicBody[1].indexOf('setMicButtonState(true)') < startMicBody[1].indexOf('await requestMicrophoneStream()'),
    'mic UI should become active before awaiting mobile microphone permission'
  );
});

test('mobile mic separates capture failures from speech recognition failures', () => {
  const micJs = read('public/mic.js');

  assert.match(micJs, /function isLikelyIOS\(\)/);
  assert.match(micJs, /async function requestMicrophoneStream\(\)/);
  assert.match(micJs, /const inputDeviceId = selectedMicInputDeviceId\(\)/);
  assert.match(micJs, /function currentMicAudioConstraints\(\)/);
  assert.match(micJs, /micSettingsOverride\?\.audioConstraints/);
  assert.match(micJs, /const baseAudioConstraints = currentMicAudioConstraints\(\)/);
  assert.match(micJs, /deviceId: \{ exact: inputDeviceId \}/);
  assert.match(micJs, /getUserMedia\(\{\s*audio: audioConstraints\s*\}\)/);
  assert.match(micJs, /getUserMedia\(\{\s*audio: true\s*\}\)/);
  assert.match(micJs, /const message = micStartErrorMessage\(e\)/);
  assert.match(micJs, /composerInput\) composerInput\.placeholder = message/);
  assert.match(micJs, /recognition\.continuous = !isLikelyIOS\(\)/);
  assert.match(micJs, /service-not-allowed/);
  assert.match(micJs, /speech recognition is unavailable on this device/i);
  assert.match(micJs, /function isMicRunning\(\)/);
  assert.match(micJs, /function renderMicWaveform\(targetCanvas, samples = dataArray\)/);
  assert.match(micJs, /function renderWaveformToCanvas\(targetCanvas\)/);
  assert.match(micJs, /startFromUserButton: startMicFromUserButton/);
  assert.match(micJs, /stopFromUserButton: stopMicFromUserButton/);
  assert.doesNotMatch(micJs, /Voice input error/);
});

test('Bob speech playback is suppressed while voice input is running', () => {
  const appJs = read('public/app.js');
  const micJs = read('public/mic.js');

  assert.match(appJs, /function isVoiceInputRunning\(\)/);
  assert.match(appJs, /window\.__mic\?\.isMicRunning\?\.\(\)/);
  assert.match(appJs, /document\.getElementById\('micToggle'\)\?\.dataset\.running === '1'/);
  assert.match(appJs, /async function speakText\(text\)[\s\S]*if \(!clean\) return;\s*if \(isVoiceInputRunning\(\)\) return;/);
  assert.match(appJs, /async function speakQueuedText\(text, generation\)[\s\S]*if \(!clean \|\| generation !== streamingSpeechGeneration\) return;\s*if \(isVoiceInputRunning\(\)\) return;/);
  assert.match(appJs, /function speakWithBrowserVoice\(text\) \{\s*if \(isVoiceInputRunning\(\)\) return;/);
  assert.match(appJs, /function speakBrowserChunk\(text\) \{\s*if \(isVoiceInputRunning\(\)\) return null;/);
  assert.match(appJs, /function startStreamingSpeech\(\) \{\s*if \(isVoiceInputRunning\(\)\) return false;/);
  assert.match(appJs, /function playAudioUrls\(urls, index = 0, generation = speechPlaybackGeneration, spokenText = '', options = \{\}\) \{\s*if \(!options\.allowDuringVoiceInput && isVoiceInputRunning\(\)\) return Promise\.resolve\(\);/);
  assert.match(appJs, /async function playAudioDataUrl\(\{ audioBase64 = '', contentType = 'audio\/wav', text = '', visemes = \[\] \} = \{\}\)/);
  assert.match(appJs, /playAudioUrls\(\[\{ url, text, visemes \}\], 0, generation, text, \{ allowDuringVoiceInput: true \}\)/);
  assert.match(appJs, /playAudioDataUrl/);
  assert.match(micJs, /window\.__chat\?\.playAudioDataUrl\?\.\(\{/);
  assert.match(micJs, /emitMicEvent\('voice-pipeline-audio-playback', \{ state: 'start', path: 'chat' \}\)/);
  assert.match(micJs, /emitMicEvent\('voice-pipeline-audio-playback', \{ state: 'end', path: 'chat' \}\)/);
  assert.match(micJs, /emitMicEvent\('voice-pipeline-audio-playback', \{ state: 'start', path: 'fallback' \}\)/);
  assert.match(micJs, /function playVoicePipelineAudioFallback\(message = \{\}\)/);
});

test('mic streams continuous PCM to server STT before browser speech fallback', () => {
  const micJs = read('public/mic.js');

  assert.match(micJs, /function defaultMicDiagnosticOptions\(\)/);
  assert.match(micJs, /serverStt: true/);
  assert.match(micJs, /audioWorklet: true/);
  assert.match(micJs, /browserStt: true/);
  assert.match(micJs, /autoSubmit: true/);
  assert.match(micJs, /waveform: true/);
  assert.match(micJs, /watchdog: true/);
  assert.match(micJs, /utteranceFlush: true/);
  assert.match(micJs, /function setMicDiagnosticOptions\(options = \{\}\)/);
  assert.match(micJs, /function loadMicSettings\(\)/);
  assert.match(micJs, /\/api\/mic\/settings/);
  assert.match(micJs, /function startConfiguredTranscription\(\)/);
  assert.match(micJs, /'pipeline', 'auto', 'server', 'browser'/);
  assert.match(micJs, /serverSttWorkerKind = provider === 'pipeline' \? 'pipeline' : 'stt'/);
  assert.match(micJs, /voicePipelineVad: true/);
  assert.match(micJs, /voicePipelineStt: true/);
  assert.match(micJs, /voicePipelineLlm: true/);
  assert.match(micJs, /voicePipelineTts: true/);
  assert.match(micJs, /voicePipelineAudioOutput: true/);
  assert.match(micJs, /pipelineOptions: \{/);
  assert.match(micJs, /\/audio\/pipecat-transport-worker\.js/);
  assert.match(micJs, /if \(!micDiagnosticOptions\.serverStt\)/);
  assert.match(micJs, /if \(micDiagnosticOptions\.audioWorklet && audioCtx\.audioWorklet && window\.AudioWorkletNode\)/);
  assert.match(micJs, /if \(micDiagnosticOptions\.watchdog\) startServerSttWatchdog\(\)/);
  assert.match(micJs, /if \(!micDiagnosticOptions\.utteranceFlush\) return;/);
  assert.match(micJs, /if \(!micDiagnosticOptions\.autoSubmit\)/);
  assert.match(micJs, /if \(provider === 'browser'\)/);
  assert.match(micJs, /function startServerStt\(provider = normalizeMicProvider/);
  assert.match(micJs, /new Worker\(workerPath\)/);
  assert.match(micJs, /function handleServerSttWorkerMessage\(message, provider\)/);
  assert.match(micJs, /if \(message\.type === 'diagnostic'\) \{\s*emitMicEvent\('diagnostic', message\);\s*return;\s*\}/);
  assert.match(micJs, /message\.type === 'stt-start'/);
  assert.match(micJs, /message\.type === 'stt-complete'/);
  assert.match(micJs, /message\.type === 'stage-options'/);
  assert.match(micJs, /message\.type === 'stage-skipped'/);
  assert.match(micJs, /voicePipelineAudioOutput/);
  assert.match(micJs, /function startServerSttWorkerAudioPort\(\)/);
  assert.match(micJs, /const channel = new MessageChannel\(\)/);
  assert.match(micJs, /serverSttWorker\.postMessage\(\{ type: 'audio-port' \}, \[serverSttWorkerAudioPort\]\)/);
  assert.match(micJs, /serverSttWorker\.postMessage\(\{\s*type: 'connect'/);
  assert.match(micJs, /async function startServerSttAudioPump\(\)/);
  assert.match(micJs, /audioCtx\.audioWorklet\.addModule\('\/audio\/stt-capture-worklet\.js'\)/);
  assert.match(micJs, /new AudioWorkletNode\(audioCtx, 'bob-stt-capture'/);
  assert.match(micJs, /serverSttWorkletNode\.port\.postMessage\(\{ type: 'worker-port' \}, \[serverSttWorkletAudioPort\]\)/);
  assert.match(micJs, /function connectServerSttPumpSink\(node\)/);
  assert.match(micJs, /audioCtx\.createMediaStreamDestination\(\)/);
  assert.match(micJs, /emitMicEvent\('audio-pump-sink', \{ sink: 'media-stream-destination' \}\)/);
  assert.match(micJs, /function handleServerSttWorkletMessage\(message\)/);
  assert.match(micJs, /function handleServerSttChunkMetrics\(levels\)/);
  assert.match(micJs, /function startServerSttScriptProcessorPump\(\)/);
  assert.match(micJs, /const SERVER_STT_PROCESSOR_SIZE = 2048/);
  assert.match(micJs, /audioCtx\.createScriptProcessor\(SERVER_STT_PROCESSOR_SIZE, 1, 1\)/);
  assert.match(micJs, /function handleServerSttInputChunk\(input\)/);
  assert.match(micJs, /emitMicPumpSample\(levels\)/);
  assert.match(micJs, /emitMicEvent\('audio-pump'/);
  assert.match(micJs, /emitMicEvent\('audio-pump-summary'/);
  assert.match(micJs, /expectedChunkMs/);
  assert.match(micJs, /maxChunkGapMs/);
  assert.match(micJs, /firstChunkDelayMs/);
  assert.match(micJs, /lastChunkAt: 0/);
  assert.match(micJs, /if \(previousChunkAt\) \{\s*serverSttPumpStats\.maxChunkGapMs = Math\.max/);
  assert.match(micJs, /serverSttWorker\.postMessage\(\{\s*type: 'chunk'/);
  assert.match(micJs, /function maybeFlushServerSttUtterance\(peak\)/);
  assert.match(micJs, /serverSttWorker\.postMessage\(\{ type: 'flush' \}\)/);
  assert.match(micJs, /function maybeReportSilentServerSttInput\(levels\)/);
  assert.match(micJs, /emitMicEvent\('silent-input'/);
  assert.doesNotMatch(micJs, /silent-input-restart/);
  assert.doesNotMatch(micJs, /restartMicAfterSilentInput/);
  assert.doesNotMatch(micJs, /stopMic\(\);\s*await startMic\(\)/);
  assert.doesNotMatch(micJs, /new WebSocket/);
  assert.doesNotMatch(micJs, /downsampleFloatTo16BitPcm/);
  assert.match(micJs, /function startServerSttWatchdog\(\)/);
  assert.match(micJs, /Server STT audio pump stalled; rebuilding processor/);
  assert.match(micJs, /function fallbackToBrowserSpeechRecognition\(reason\)/);
  assert.ok(
    micJs.indexOf('startConfiguredTranscription();') < micJs.indexOf('function startSpeechRecognition()'),
    'configured STT should be started before browser SpeechRecognition is defined'
  );

  const workletJs = read('public/audio/stt-capture-worklet.js');
  assert.match(workletJs, /class BobSttCaptureProcessor extends AudioWorkletProcessor/);
  assert.match(workletJs, /this\.bufferSize = 2048/);
  assert.match(workletJs, /this\.workerPort = null/);
  assert.match(workletJs, /event\.data\?\.type === 'worker-port'/);
  assert.match(workletJs, /this\.port\.postMessage\(\{[\s\S]*type: 'metrics'/);
  assert.match(workletJs, /gapMs/);
  assert.match(workletJs, /sequence/);
  assert.match(workletJs, /this\.workerPort\.postMessage\(\{ type: 'chunk', input: chunk \}, \[chunk\.buffer\]\)/);
  assert.match(workletJs, /registerProcessor\('bob-stt-capture', BobSttCaptureProcessor\)/);

  const workerJs = read('public/audio/stt-worker.js');
  assert.match(workerJs, /async function fetchSttToken\(\)/);
  assert.match(workerJs, /function attachAudioPort\(port\)/);
  assert.match(workerJs, /post\('worker-audio-port-ready'\)/);
  assert.match(workerJs, /message\.type === 'audio-port'/);
  assert.match(workerJs, /fetch\('\/api\/stt\/token'/);
  assert.match(workerJs, /new WebSocket\(sttStreamUrl\(token\)\)/);
  assert.match(workerJs, /socket\.binaryType = 'arraybuffer'/);
  assert.match(workerJs, /const WORKER_CHUNK_PROCESS_WARN_MS = 40/);
  assert.match(workerJs, /const WORKER_CHUNK_GAP_WARN_MS = 180/);
  assert.match(workerJs, /const SOCKET_BUFFER_WARN_BYTES = 256 \* 1024/);
  assert.match(workerJs, /function maybePostWorkerDiagnostic/);
  assert.match(workerJs, /post\('diagnostic'/);
  assert.match(workerJs, /socketPressure/);
  assert.match(workerJs, /function downsampleFloatTo16BitPcm\(input, fromSampleRate, toSampleRate\)/);
  assert.match(workerJs, /socket\.send\(pcm\.buffer\)/);
  assert.match(workerJs, /socket\.send\(JSON\.stringify\(\{ type: 'flush' \}\)\)/);
  assert.match(workerJs, /self\.onmessage = event =>/);

  const transportJs = read('public/audio/pipecat-transport-worker.js');
  assert.match(transportJs, /function pipelineStreamUrl\(token\)/);
  assert.match(transportJs, /\/api\/voice\/pipeline\?token=/);
  assert.match(transportJs, /async function fetchPipelineToken\(\)/);
  assert.match(transportJs, /fetch\('\/api\/voice\/pipeline\/token'/);
  assert.match(transportJs, /post\('diagnostic'/);
  assert.match(transportJs, /area: 'pipecat-transport'/);
  assert.match(transportJs, /socket\.send\(pcm\.buffer\)/);
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
  assert.match(mobileBlock[1], /body\.bob-chat-tester-route \.main-content\{[^}]*overflow-y:auto/);
  assert.match(mobileBlock[1], /body\.bob-chat-tester-route \.main-content\{[^}]*overflow-x:hidden/);
  assert.match(mobileBlock[1], /body\.bob-chat-tester-route \.main-menu-page\{[^}]*overflow-x:hidden/);
  assert.match(mobileBlock[1], /\.bob-chat-tester-grid\{[^}]*display:flex;flex-direction:column/);
  assert.match(mobileBlock[1], /\.bob-chat-tester-grid\{[^}]*overflow-x:hidden/);
  assert.match(mobileBlock[1], /\.voice-panel\.ai-voice\{[^}]*height:104px/);
  assert.match(mobileBlock[1], /\.voice-panel\.ai-voice \.voice-label-row\{[^}]*grid-template-columns:80px 34px/);
  assert.match(mobileBlock[1], /\.ai-waveform-stack\{[^}]*grid-row:1/);
  assert.match(mobileBlock[1], /\.ai-waveform-stack\{[^}]*height:80px/);
  assert.match(mobileBlock[1], /\.ai-waveform-stack #aiWaveform\{[^}]*height:52px/);
  assert.match(mobileBlock[1], /\.bob-chat-tester-view \.bob-chat-face-card\{[^}]*min-height:220px/);
  assert.match(mobileBlock[1], /\.bob-chat-tester-view \.bob-chat-face-card \.tester-bob-face-shell\{[^}]*width:min\(180px,calc\(100vw - 128px\)\)/);
  assert.match(mobileBlock[1], /\.bob-chat-tester-view \.bob-chat-face-card \.tester-bob-ctx\{[^}]*height:min\(180px,calc\(100vw - 128px\)\)/);
});

test('context usage chart sits beside Bob face with brain control', () => {
  const css = read('public/style.css');
  const html = read('public/index.html');
  const appJs = read('public/app.js');
  const voicePanelRule = css.match(/\.voice-panel\.ai-voice\{([^}]*)\}/);
  const labelRule = css.match(/\.voice-panel\.ai-voice \.voice-label-row\{([^}]*)\}/);
  const widgetRule = css.match(/\.bob-context-widget\{([^}]*)\}/);
  const canvasRule = css.match(/\.bob-context-widget canvas\{([^}]*)\}/);
  const brainRule = css.match(/\.bob-context-widget \.bob-brain-btn\{([^}]*)\}/);
  const faceBrainRule = css.match(/\.bob-memory-face-indicator\{([^}]*)\}/);

  assert.ok(voicePanelRule, 'voice panel rule should be present');
  assert.ok(labelRule, 'voice label row rule should be present');
  assert.ok(widgetRule, 'context widget rule should be present');
  assert.ok(canvasRule, 'context canvas rule should be present');
  assert.ok(brainRule, 'context brain rule should be present');
  assert.ok(faceBrainRule, 'face brain indicator rule should be present');
  assert.match(html, /<div class="bob-context-widget"[\s\S]*id="bobContextChart"[\s\S]*id="bobMemoryBrain"/);
  assert.match(html, /<div class="ai-waveform-stack">[\s\S]*id="aiWaveform"[\s\S]*id="playbackSpeed"/);
  assert.doesNotMatch(html, /<div class="mic-control-stack">/);
  assert.match(voicePanelRule[1], /grid-template-columns:150px minmax\(0,1fr\)/);
  assert.match(voicePanelRule[1], /height:120px/);
  assert.match(voicePanelRule[1], /grid-template-rows:98px/);
  assert.match(labelRule[1], /grid-column:1/);
  assert.match(labelRule[1], /grid-row:1/);
  assert.match(labelRule[1], /grid-template-columns:minmax\(0,98px\) 42px/);
  assert.match(css, /\.ai-waveform-stack\{[^}]*height:98px/);
  assert.match(css, /\.ai-waveform-stack\{[^}]*max-height:98px/);
  assert.match(css, /\.ai-waveform-stack \.playback-speed\{[^}]*flex:0 0 28px/);
  assert.match(widgetRule[1], /grid-column:2/);
  assert.match(widgetRule[1], /grid-row:1/);
  assert.match(widgetRule[1], /width:42px/);
  assert.match(widgetRule[1], /height:98px/);
  assert.doesNotMatch(widgetRule[1], /grid-template-columns/);
  assert.match(canvasRule[1], /width:100%/);
  assert.match(brainRule[1], /order:3/);
  assert.match(faceBrainRule[1], /box-sizing:border-box/);
  assert.match(faceBrainRule[1], /width:28px/);
  assert.match(faceBrainRule[1], /height:28px/);
  assert.match(faceBrainRule[1], /padding:0/);
  assert.match(faceBrainRule[1], /border-radius:999px/);
  assert.match(faceBrainRule[1], /display:grid/);
  assert.match(faceBrainRule[1], /place-items:center/);
  assert.match(faceBrainRule[1], /line-height:0/);
  assert.match(css, /\.bob-memory-face-indicator svg\{[^}]*display:block/);
  assert.match(css, /\.bob-memory-face-indicator svg\{[^}]*margin:0/);
  assert.doesNotMatch(appJs, /Memory due/);
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

test('Bob speech falls back to Web Audio playback for mobile media restrictions', () => {
  const appJs = read('public/app.js');

  assert.match(appJs, /let currentAudioSource/);
  assert.match(appJs, /let aiMediaSources = new WeakMap\(\)/);
  assert.match(appJs, /async function playAudioUrlWithWebAudio\(url, mouthText = '', visemes = \[\], generation = speechPlaybackGeneration\)/);
  assert.match(appJs, /await fetch\(url, \{ cache: 'no-store' \}\)/);
  assert.match(appJs, /await decodeAudioBuffer\(arrayBuffer\)/);
  assert.match(appJs, /source\.connect\(aiAnalyser\)/);
  assert.match(appJs, /aiAnalyser\.connect\(aiAudioCtx\.destination\)/);
  assert.match(appJs, /await playAudioUrlWithWebAudio\(url, mouthText, visemes, generation\)/);
  assert.match(appJs, /currentAudioSource\.stop\(0\)/);
  assert.match(appJs, /let source = aiMediaSources\.get\(audio\)/);
  assert.match(appJs, /aiMediaSources\.set\(audio, source\)/);
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
