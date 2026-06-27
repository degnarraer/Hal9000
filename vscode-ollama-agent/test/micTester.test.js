const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Tests menu exposes Microphone Tester page', () => {
  const menuJs = read('public/menu.js');
  const testsHtml = read('public/menu-pages/tests.html');
  const indexHtml = read('public/index.html');

  assert.match(menuJs, /micTester:\s*\{\s*title:\s*'Microphone Tester'/);
  assert.match(menuJs, /route:\s*'micTester'[\s\S]*title:\s*'Microphone Tester'/);
  assert.doesNotMatch(menuJs, /__micTesterStop/);
  assert.match(testsHtml, /data-admin-route="micTester"/);
  assert.match(indexHtml, /\/menu\/mic-tester\.js/);
});

test('Microphone Tester shows diagnostics while using the app microphone process', () => {
  const pageHtml = read('public/menu-pages/mic-tester.html');
  const pageJs = read('public/menu/mic-tester.js');

  assert.match(pageHtml, /App microphone path/);
  assert.match(pageHtml, /id="micTesterInputDevice"/);
  assert.match(pageHtml, /id="micTesterCopyDebug"/);
  assert.match(pageHtml, /Browser default microphone/);
  assert.match(pageHtml, /id="micTesterTranscript"/);
  assert.match(pageHtml, /id="micTesterEvents"/);
  assert.match(pageHtml, /id="micTesterStatusLight"/);
  assert.match(pageHtml, /id="micTesterHealth"/);
  assert.match(pageHtml, /id="micTesterMainThreadLight"/);
  assert.match(pageHtml, /id="micTesterMainThreadHealth"/);
  assert.match(pageHtml, /id="micDiagWorkletLight"/);
  assert.match(pageHtml, /id="micDiagWorkerLight"/);
  assert.match(pageHtml, /id="micDiagSocketLight"/);
  assert.match(pageHtml, /id="micDiagTransportLight"/);
  assert.match(pageHtml, /id="micDiagRecognizerLight"/);
  assert.match(pageHtml, /id="micDiagChatRenderLight"/);
  assert.match(pageHtml, /id="micDiagStreamLight"/);
  assert.match(pageHtml, /id="micDiagChartLight"/);
  assert.match(pageHtml, /id="micDiagLogLight"/);
  assert.match(pageHtml, /id="micSubServerStt"/);
  assert.match(pageHtml, /id="micSubAudioWorklet"/);
  assert.match(pageHtml, /id="micSubBrowserStt"/);
  assert.match(pageHtml, /id="micSubAutoSubmit"/);
  assert.match(pageHtml, /id="micSubWaveform"/);
  assert.match(pageHtml, /id="micSubWatchdog"/);
  assert.match(pageHtml, /id="micSubFlush"/);
  assert.match(pageHtml, /data-mic-renderer="scroll"/);
  assert.match(pageHtml, /data-mic-renderer="waveform"/);
  assert.match(pageHtml, /data-mic-renderer="power"/);
  assert.match(pageJs, /function setMicTesterHealth\(state, label\)/);
  assert.match(pageJs, /function setMicTesterMainThreadHealth\(state, label\)/);
  assert.match(pageJs, /function markMicTesterMainThreadStalled\(detail = \{\}\)/);
  assert.match(pageJs, /function setMicTesterDiagnosticHealth\(area, state, label\)/);
  assert.match(pageJs, /function markMicTesterDiagnostic\(area, detail = \{\}\)/);
  assert.match(pageJs, /'pipecat-transport': \{/);
  assert.match(pageJs, /'stt-recognizer': \{/);
  assert.match(pageJs, /function handleMicTesterAppDiagnosticEvent\(event\)/);
  assert.match(pageJs, /window\.addEventListener\('bob:app-diagnostic', handleMicTesterAppDiagnosticEvent\)/);
  assert.match(pageJs, /detail\.type === 'debug' && detail\.message === 'main thread stall detected'/);
  assert.match(pageJs, /detail\.type === 'diagnostic'/);
  assert.match(pageJs, /setMicTesterMainThreadHealth\('bad'/);
  assert.match(pageJs, /setMicTesterMainThreadHealth\('good', 'Thread good'\)/);
  assert.match(pageJs, /function setMicTesterRendererMode\(mode\)/);
  assert.match(pageJs, /window\.addEventListener\('bob:mic', handleMicTesterAppMicEvent\)/);
  assert.match(pageJs, /function loadMicTesterInputDevices\(\)/);
  assert.match(pageJs, /function saveMicTesterInputDevice\(\)/);
  assert.match(pageJs, /const MIC_TESTER_SUBSYSTEM_CONTROLS = \{/);
  assert.match(pageJs, /function loadMicTesterSubsystemOptions\(\)/);
  assert.match(pageJs, /function saveMicTesterSubsystemOptions\(\)/);
  assert.match(pageJs, /window\.__mic\?\.setDiagnosticOptions\?\.\(normalized\)/);
  assert.match(pageJs, /window\.__mic\.startFromUserButton\(\)/);
  assert.match(pageJs, /window\.__mic\?\.stopFromUserButton\?\.\(\)/);
  assert.match(pageJs, /\/api\/stt\/status/);
});

test('Microphone Tester consumes app microphone diagnostics instead of duplicating STT', () => {
  const pageJs = read('public/menu/mic-tester.js');
  const micJs = read('public/mic.js');

  assert.match(pageJs, /function handleMicTesterAppMicEvent\(event\)/);
  assert.match(pageJs, /const micTesterLogEntries = \[\]/);
  assert.match(pageJs, /const MIC_TESTER_LOG_MAX_LINES = 500/);
  assert.match(pageJs, /console\.info\('\[mic-tester\]'/);
  assert.match(pageJs, /function scheduleMicTesterLogRender\(\)/);
  assert.match(pageJs, /requestAnimationFrame\(renderMicTesterLog\)/);
  assert.match(pageJs, /function renderMicTesterLog\(\)/);
  assert.match(pageJs, /micTesterLogEntries\.join\('\\n'\)/);
  assert.match(pageJs, /function queueMicTesterAudioRender\(detail\)/);
  assert.match(pageJs, /requestAnimationFrame\(renderQueuedMicTesterAudio\)/);
  assert.match(pageJs, /function renderQueuedMicTesterAudio\(\)/);
  assert.match(pageJs, /function updateMicTesterAudioHealth\(detail, force = false\)/);
  assert.match(pageJs, /MIC_TESTER_CHART_GAP_WARN_MS/);
  assert.match(pageJs, /MIC_TESTER_CHART_DRAW_WARN_MS/);
  assert.match(pageJs, /markMicTesterDiagnostic\('tester-chart'/);
  assert.match(pageJs, /detail\.type !== 'audio-pump'/);
  assert.match(pageJs, /detail\.type === 'audio-pump'/);
  assert.match(pageJs, /queueMicTesterAudioRender\(detail\)/);
  assert.match(pageJs, /detail\.type === 'audio-pump-summary'/);
  assert.match(pageJs, /detail\.type === 'audio-pump-mode'/);
  assert.match(pageJs, /detail\.type === 'audio-worklet-fallback'/);
  assert.match(pageJs, /detail\.recentAudio/);
  assert.match(pageJs, /function drawMicTesterAudio\(detail\)/);
  assert.match(pageJs, /function drawMicTesterSharedWaveform\(\)/);
  assert.match(pageJs, /window\.__mic\?\.renderWaveformToCanvas\?\.\(canvas\)/);
  assert.match(pageJs, /function drawMicTesterPumpChart\(detail\)/);
  assert.match(pageJs, /function drawMicTesterPowerBar\(detail\)/);
  assert.match(pageJs, /function scaleMicTesterAudioLevel\(value\)/);
  assert.match(pageJs, /Math\.log10\(1 \+ clamped \* 80\)/);
  assert.match(pageJs, /micTesterChartSamples\.push\(sample\)/);
  assert.match(pageJs, /const ageIndex = micTesterChartSamples\.length - 1 - index/);
  assert.match(pageJs, /const x = ageIndex \* \(barWidth \+ 1\)/);
  assert.match(pageJs, /detail\.type === 'partial'/);
  assert.match(pageJs, /detail\.type === 'final'/);
  assert.match(pageJs, /setMicTesterHealth\('good', 'Audio good'\)/);
  assert.match(pageJs, /setMicTesterHealth\('bad', 'No audio'\)/);
  assert.doesNotMatch(pageJs, /window\.__micTesterStop/);

  assert.match(micJs, /function emitMicEvent\(type, data = \{\}\)/);
  assert.match(micJs, /MIC_INPUT_DEVICE_KEY/);
  assert.match(micJs, /deviceId: \{ exact: inputDeviceId \}/);
  assert.match(micJs, /function emitMicPumpSample\(levels\)/);
  assert.match(micJs, /emitMicEvent\('audio-pump-mode'/);
  assert.match(micJs, /emitMicEvent\('audio-worklet-fallback'/);
  assert.match(micJs, /emitMicEvent\('audio-pump'/);
  assert.match(micJs, /emitMicEvent\('audio-pump-summary'/);
  assert.match(micJs, /windowPeak/);
  assert.match(micJs, /recentAudio/);
  assert.match(micJs, /expectedChunkMs/);
  assert.match(micJs, /maxChunkGapMs/);
  assert.match(micJs, /emitMicEvent\('partial'/);
  assert.match(micJs, /emitMicEvent\('final'/);
  assert.match(micJs, /setSelectedMicInputDeviceId/);
});

test('Microphone Tester can copy current debug information', () => {
  const pageHtml = read('public/menu-pages/mic-tester.html');
  const pageJs = read('public/menu/mic-tester.js');

  assert.match(pageHtml, /id="micTesterCopyDebug"/);
  assert.match(pageJs, /function copyMicTesterDebug\(\)/);
  assert.match(pageJs, /MICROPHONE TEST DEBUG/);
  assert.match(pageJs, /SELECTED INPUT:/);
  assert.match(pageJs, /RENDERER MODE:/);
  assert.match(pageJs, /SUBSYSTEMS:/);
  assert.match(pageJs, /MAIN THREAD:/);
  assert.match(pageJs, /WORKLET:/);
  assert.match(pageJs, /WORKER:/);
  assert.match(pageJs, /SOCKET:/);
  assert.match(pageJs, /TRANSPORT:/);
  assert.match(pageJs, /RECOGNIZER:/);
  assert.match(pageJs, /CHAT RENDER:/);
  assert.match(pageJs, /STREAM:/);
  assert.match(pageJs, /CHART:/);
  assert.match(pageJs, /TESTER LOG:/);
  assert.match(pageJs, /TRANSCRIPT/);
  assert.match(pageJs, /EVENTS/);
  assert.match(pageJs, /micTesterEventsText\(\)/);
  assert.match(pageJs, /navigator\.clipboard\?\.writeText/);
  assert.match(pageJs, /document\.execCommand\('copy'\)/);
});
