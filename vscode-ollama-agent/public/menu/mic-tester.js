let micTesterRuntime = null;
let micTesterChartSamples = [];
let micTesterRendererMode = 'scroll';
let micTesterMainThreadRecoveryTimer = null;
let micTesterEventLogLines = 0;
let micTesterLogRenderPending = false;
let micTesterAudioRenderPending = false;
let micTesterPendingAudioDetail = null;
let micTesterLastHealthUpdateAt = 0;
let micTesterLastChartRenderAt = 0;
const micTesterLogEntries = [];
const micTesterDiagnosticRecoveryTimers = {};
const MIC_TESTER_LOG_WARN_MS = 40;
const MIC_TESTER_LOG_LINE_WARN = 800;
const MIC_TESTER_LOG_MAX_LINES = 500;
const MIC_TESTER_HEALTH_UPDATE_MS = 250;
const MIC_TESTER_CHART_GAP_WARN_MS = 250;
const MIC_TESTER_CHART_DRAW_WARN_MS = 35;
const MIC_TESTER_DIAGNOSTIC_RECOVERY_MS = 2500;
const MIC_TESTER_SUBSYSTEM_KEY = 'bob.micTester.subsystems';
const MIC_TESTER_SUBSYSTEM_CONTROLS = {
  serverStt: 'micSubServerStt',
  audioWorklet: 'micSubAudioWorklet',
  browserStt: 'micSubBrowserStt',
  autoSubmit: 'micSubAutoSubmit',
  waveform: 'micSubWaveform',
  watchdog: 'micSubWatchdog',
  utteranceFlush: 'micSubFlush'
};

const MIC_TESTER_DIAGNOSTICS = {
  'audio-worklet': {
    light: 'micDiagWorkletLight',
    text: 'micDiagWorklet',
    good: 'Worklet good',
    bad: detail => `Worklet gap ${Math.round(Number(detail.gapMs || 0))}ms`
  },
  'stt-worker': {
    light: 'micDiagWorkerLight',
    text: 'micDiagWorker',
    good: 'Worker good',
    bad: detail => `Worker slow ${Math.round(Number(detail.processMs || detail.chunkGapMs || 0))}ms`
  },
  'stt-socket': {
    light: 'micDiagSocketLight',
    text: 'micDiagSocket',
    good: 'Socket good',
    bad: detail => `Socket buffer ${formatMicTesterBytes(detail.bufferedAmount || 0)}`
  },
  'pipecat-transport': {
    light: 'micDiagTransportLight',
    text: 'micDiagTransport',
    good: 'Transport good',
    bad: detail => detail.chunkGapMs
      ? `Transport gap ${Math.round(Number(detail.chunkGapMs || 0))}ms`
      : `Transport buffer ${formatMicTesterBytes(detail.bufferedAmount || 0)}`
  },
  'stt-recognizer': {
    light: 'micDiagRecognizerLight',
    text: 'micDiagRecognizer',
    good: 'Recognizer good',
    bad: detail => detail.maxInputGapMs
      ? `Recognizer gap ${Math.round(Number(detail.maxInputGapMs || 0))}ms`
      : `Recognizer ${Math.round(Number(detail.maxProcessMs || 0))}ms`
  },
  'chat-render': {
    light: 'micDiagChatRenderLight',
    text: 'micDiagChatRender',
    good: 'Chat render good',
    bad: detail => `Chat render ${Math.round(Number(detail.durationMs || 0))}ms`
  },
  'llm-stream': {
    light: 'micDiagStreamLight',
    text: 'micDiagStream',
    good: 'Stream good',
    bad: detail => `Stream ${Math.round(Number(detail.durationMs || 0))}ms`
  },
  'tester-chart': {
    light: 'micDiagChartLight',
    text: 'micDiagChart',
    good: 'Chart good',
    bad: detail => detail.gapMs
      ? `Chart gap ${Math.round(Number(detail.gapMs || 0))}ms`
      : `Chart draw ${Math.round(Number(detail.durationMs || 0))}ms`
  },
  'tester-log': {
    light: 'micDiagLogLight',
    text: 'micDiagLog',
    good: 'Log good',
    bad: detail => `Log ${Math.round(Number(detail.durationMs || 0))}ms`
  }
};

function isMicTesterMobileBrowser() {
  return /Android|iPad|iPhone|iPod|Mobile/i.test(navigator.userAgent || '')
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function initMicTester() {
  byId('micTesterStart')?.addEventListener('click', startMicTester);
  byId('micTesterStop')?.addEventListener('click', stopMicTester);
  byId('micTesterCopyDebug')?.addEventListener('click', copyMicTesterDebug);
  document.querySelectorAll('[data-mic-renderer]').forEach(button => {
    button.addEventListener('click', () => setMicTesterRendererMode(button.dataset.micRenderer || 'scroll'));
  });
  window.removeEventListener('bob:mic', handleMicTesterAppMicEvent);
  window.addEventListener('bob:mic', handleMicTesterAppMicEvent);
  window.removeEventListener('bob:app-diagnostic', handleMicTesterAppDiagnosticEvent);
  window.addEventListener('bob:app-diagnostic', handleMicTesterAppDiagnosticEvent);
  byId('micTesterInputDevice')?.addEventListener('change', saveMicTesterInputDevice);
  Object.values(MIC_TESTER_SUBSYSTEM_CONTROLS).forEach(id => {
    byId(id)?.addEventListener('change', saveMicTesterSubsystemOptions);
  });
  loadMicTesterInputDevices();
  loadMicTesterSubsystemOptions();
  loadMicTesterSttStatus();
  resetMicTesterDiagnosticLamps('idle');
  resetMicTesterChart();
}

function micTesterLog(message, data) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}${data ? ` ${JSON.stringify(data)}` : ''}`;
  console.info('[mic-tester]', message, data || '');
  micTesterLogEntries.unshift(line);
  if (micTesterLogEntries.length > MIC_TESTER_LOG_MAX_LINES) {
    micTesterLogEntries.length = MIC_TESTER_LOG_MAX_LINES;
  }
  micTesterEventLogLines += 1;
  scheduleMicTesterLogRender();
}

function scheduleMicTesterLogRender() {
  if (micTesterLogRenderPending) return;
  micTesterLogRenderPending = true;
  requestAnimationFrame(renderMicTesterLog);
}

function renderMicTesterLog() {
  micTesterLogRenderPending = false;
  const startedAt = performance.now();
  const events = byId('micTesterEvents');
  if (!events) return;
  events.textContent = micTesterLogEntries.length ? micTesterLogEntries.join('\n') : 'No events yet.';
  const durationMs = performance.now() - startedAt;
  if (durationMs > MIC_TESTER_LOG_WARN_MS || micTesterEventLogLines > MIC_TESTER_LOG_LINE_WARN) {
    markMicTesterDiagnostic('tester-log', {
      pressure: true,
      durationMs: Number(durationMs.toFixed(1)),
      lines: micTesterEventLogLines
    });
  } else {
    markMicTesterDiagnostic('tester-log', { pressure: false });
  }
}

function micTesterEventsText() {
  return micTesterLogEntries.length ? micTesterLogEntries.join('\n') : (byId('micTesterEvents')?.textContent || '');
}

async function copyMicTesterDebug() {
  const button = byId('micTesterCopyDebug');
  const inputSelect = byId('micTesterInputDevice');
  const selectedInput = inputSelect?.selectedOptions?.[0]?.textContent || 'Browser default microphone';
  const debug = [
    'MICROPHONE TEST DEBUG',
    `TIME: ${new Date().toISOString()}`,
    `URL: ${location.href}`,
    `USER AGENT: ${navigator.userAgent || 'unknown'}`,
    `SELECTED INPUT: ${selectedInput}`,
    `RENDERER MODE: ${micTesterRendererMode}`,
    `SUBSYSTEMS: ${JSON.stringify(readMicTesterSubsystemOptions())}`,
    `HEALTH: ${byId('micTesterHealth')?.textContent || ''}`,
    `MAIN THREAD: ${byId('micTesterMainThreadHealth')?.textContent || ''}`,
    `WORKLET: ${byId('micDiagWorklet')?.textContent || ''}`,
    `WORKER: ${byId('micDiagWorker')?.textContent || ''}`,
    `SOCKET: ${byId('micDiagSocket')?.textContent || ''}`,
    `TRANSPORT: ${byId('micDiagTransport')?.textContent || ''}`,
    `RECOGNIZER: ${byId('micDiagRecognizer')?.textContent || ''}`,
    `CHAT RENDER: ${byId('micDiagChatRender')?.textContent || ''}`,
    `STREAM: ${byId('micDiagStream')?.textContent || ''}`,
    `CHART: ${byId('micDiagChart')?.textContent || ''}`,
    `TESTER LOG: ${byId('micDiagLog')?.textContent || ''}`,
    `STATUS: ${byId('micTesterStatus')?.textContent || ''}`,
    `CAPTURE: ${byId('micTesterCaptureStatus')?.textContent || ''}`,
    `STT: ${byId('micTesterSttStatus')?.textContent || ''}`,
    `PROVIDER: ${byId('micTesterProviderStatus')?.textContent || ''}`,
    `SAMPLE RATE: ${byId('micTesterSampleRate')?.textContent || ''}`,
    `DETAILS: ${byId('micTesterDetails')?.textContent || ''}`,
    '',
    'TRANSCRIPT',
    byId('micTesterTranscript')?.textContent || '',
    '',
    'EVENTS',
    micTesterEventsText()
  ].join('\n');

  try {
    await copyMicTesterText(debug);
    if (button) {
      const previous = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = previous || 'Copy Debug'; }, 1200);
    }
    micTesterLog('debug copied', { length: debug.length });
  } catch (err) {
    micTesterLog('debug copy failed', { message: err.message });
    setMicTesterStatus(`Debug copy failed: ${err.message}`);
  }
}

async function copyMicTesterText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function setMicTesterStatus(message) {
  if (byId('micTesterStatus')) byId('micTesterStatus').textContent = message;
}

function setMicTesterHealth(state, label) {
  const light = byId('micTesterStatusLight');
  const text = byId('micTesterHealth');
  const normalized = ['good', 'bad', 'idle'].includes(state) ? state : 'idle';
  if (light) {
    light.classList.remove('mic-status-light-good', 'mic-status-light-bad', 'mic-status-light-idle');
    light.classList.add(`mic-status-light-${normalized}`);
    light.setAttribute('aria-label', `Mic status: ${label || normalized}`);
  }
  if (text) text.textContent = label || normalized;
}

function setMicTesterMainThreadHealth(state, label) {
  const light = byId('micTesterMainThreadLight');
  const text = byId('micTesterMainThreadHealth');
  const normalized = ['good', 'bad', 'idle'].includes(state) ? state : 'idle';
  if (light) {
    light.classList.remove('mic-status-light-good', 'mic-status-light-bad', 'mic-status-light-idle');
    light.classList.add(`mic-status-light-${normalized}`);
    light.setAttribute('aria-label', `Main thread status: ${label || normalized}`);
  }
  if (text) text.textContent = label || normalized;
}

function markMicTesterMainThreadStalled(detail = {}) {
  clearTimeout(micTesterMainThreadRecoveryTimer);
  const blockedMs = Number(detail.blockedMs || 0);
  setMicTesterMainThreadHealth('bad', blockedMs ? `Thread stalled ${blockedMs}ms` : 'Thread stalled');
  micTesterMainThreadRecoveryTimer = setTimeout(() => {
    setMicTesterMainThreadHealth('good', 'Thread good');
  }, 2500);
}

function setMicTesterDiagnosticHealth(area, state, label) {
  const config = MIC_TESTER_DIAGNOSTICS[area];
  if (!config) return;
  const light = byId(config.light);
  const text = byId(config.text);
  const normalized = ['good', 'bad', 'idle'].includes(state) ? state : 'idle';
  if (light) {
    light.classList.remove('mic-status-light-good', 'mic-status-light-bad', 'mic-status-light-idle');
    light.classList.add(`mic-status-light-${normalized}`);
    light.setAttribute('aria-label', `${area} status: ${label || normalized}`);
  }
  if (text) text.textContent = label || normalized;
}

function markMicTesterDiagnostic(area, detail = {}) {
  const config = MIC_TESTER_DIAGNOSTICS[area];
  if (!config) return;
  clearTimeout(micTesterDiagnosticRecoveryTimers[area]);
  const isPressure = Boolean(detail.pressure);
  const label = isPressure
    ? (typeof config.bad === 'function' ? config.bad(detail) : config.bad)
    : config.good;
  setMicTesterDiagnosticHealth(area, isPressure ? 'bad' : 'good', label);
  if (isPressure) {
    micTesterDiagnosticRecoveryTimers[area] = setTimeout(() => {
      setMicTesterDiagnosticHealth(area, 'good', config.good);
    }, MIC_TESTER_DIAGNOSTIC_RECOVERY_MS);
  }
}

function resetMicTesterDiagnosticLamps(state = 'idle') {
  Object.keys(micTesterDiagnosticRecoveryTimers).forEach(area => {
    clearTimeout(micTesterDiagnosticRecoveryTimers[area]);
    delete micTesterDiagnosticRecoveryTimers[area];
  });
  Object.entries(MIC_TESTER_DIAGNOSTICS).forEach(([area, config]) => {
    const label = state === 'good' ? config.good : `${config.good.replace(' good', '')} idle`;
    setMicTesterDiagnosticHealth(area, state, label);
  });
}

function handleMicTesterDiagnosticEvent(detail = {}) {
  if (!detail.area) return;
  if (detail.area === 'stt-worker') {
    markMicTesterDiagnostic('stt-worker', detail);
    markMicTesterDiagnostic('stt-socket', { ...detail, pressure: Boolean(detail.socketPressure) });
    return;
  }
  markMicTesterDiagnostic(detail.area, detail);
}

function handleMicTesterAppDiagnosticEvent(event) {
  handleMicTesterDiagnosticEvent(event.detail || {});
}

function formatMicTesterBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function setMicTesterTranscript(text) {
  if (byId('micTesterTranscript')) byId('micTesterTranscript').textContent = text || 'Listening...';
}

function setMicTesterRunning(isRunning) {
  byId('micTesterStart')?.toggleAttribute('disabled', isRunning);
  byId('micTesterStop')?.toggleAttribute('disabled', !isRunning);
}

function micTesterCaptureConstraints(mode, deviceId = '') {
  const device = deviceId ? { deviceId: { exact: deviceId } } : {};
  if (mode === 'default') return deviceId ? device : true;
  if (mode === 'raw') {
    return { ...device, echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  }
  return { ...device, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
}

function setMicTesterRendererMode(mode) {
  micTesterRendererMode = ['scroll', 'waveform', 'power'].includes(mode) ? mode : 'scroll';
  document.querySelectorAll('[data-mic-renderer]').forEach(button => {
    const isActive = button.dataset.micRenderer === micTesterRendererMode;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
  resetMicTesterChart();
  micTesterLog('renderer mode changed', { mode: micTesterRendererMode });
}

async function loadMicTesterSttStatus() {
  try {
    const response = await fetch('/api/stt/status', { cache: 'no-store' });
    const json = await response.json();
    const data = json.data || {};
    if (byId('micTesterSttStatus')) byId('micTesterSttStatus').textContent = data.ok ? 'ready' : (data.state || 'unavailable');
    if (byId('micTesterSampleRate')) byId('micTesterSampleRate').textContent = data.sampleRate ? `${data.sampleRate} Hz` : 'Unknown';
    if (byId('micTesterDetails')) byId('micTesterDetails').textContent = data.error || data.modelPath || 'Server STT status loaded.';
  } catch (err) {
    if (byId('micTesterSttStatus')) byId('micTesterSttStatus').textContent = 'error';
    if (byId('micTesterDetails')) byId('micTesterDetails').textContent = err.message;
  }
}

async function loadMicTesterInputDevices() {
  const select = byId('micTesterInputDevice');
  if (!select || !navigator.mediaDevices?.enumerateDevices) return;

  const selected = window.__mic?.selectedMicInputDeviceId?.() || '';
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter(device => device.kind === 'audioinput');
    select.innerHTML = [
      '<option value="">Browser default microphone</option>',
      ...inputs.map((device, index) => {
        const label = escapeMicTesterOption(device.label || `Microphone ${index + 1}`);
        return `<option value="${escapeMicTesterOption(device.deviceId)}">${label}</option>`;
      })
    ].join('');
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
    micTesterLog('app input devices', { count: inputs.length, labelsVisible: inputs.some(device => Boolean(device.label)) });
  } catch (err) {
    micTesterLog('app input device list failed', { message: err.message });
  }
}

function saveMicTesterInputDevice() {
  const value = byId('micTesterInputDevice')?.value || '';
  window.__mic?.setSelectedMicInputDeviceId?.(value);
  micTesterLog('app input device saved', { inputDevice: value ? 'selected' : 'browser-default' });
}

function defaultMicTesterSubsystemOptions() {
  return window.__mic?.defaultDiagnosticOptions?.() || {
    serverStt: true,
    audioWorklet: true,
    browserStt: true,
    autoSubmit: true,
    waveform: true,
    watchdog: true,
    utteranceFlush: true
  };
}

function normalizeMicTesterSubsystemOptions(options = {}) {
  const defaults = defaultMicTesterSubsystemOptions();
  return Object.fromEntries(
    Object.entries(defaults).map(([key, defaultValue]) => [key, options[key] === undefined ? defaultValue : Boolean(options[key])])
  );
}

function readMicTesterSubsystemOptions() {
  const defaults = defaultMicTesterSubsystemOptions();
  const options = {};
  Object.entries(MIC_TESTER_SUBSYSTEM_CONTROLS).forEach(([key, id]) => {
    const input = byId(id);
    options[key] = input ? Boolean(input.checked) : defaults[key];
  });
  return normalizeMicTesterSubsystemOptions(options);
}

function applyMicTesterSubsystemOptions(options = readMicTesterSubsystemOptions()) {
  const normalized = normalizeMicTesterSubsystemOptions(options);
  Object.entries(MIC_TESTER_SUBSYSTEM_CONTROLS).forEach(([key, id]) => {
    const input = byId(id);
    if (input) input.checked = Boolean(normalized[key]);
  });
  window.__mic?.setDiagnosticOptions?.(normalized);
  return normalized;
}

function loadMicTesterSubsystemOptions() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(MIC_TESTER_SUBSYSTEM_KEY) || 'null');
  } catch (err) {
    saved = null;
  }
  const options = applyMicTesterSubsystemOptions(saved || window.__mic?.getDiagnosticOptions?.() || defaultMicTesterSubsystemOptions());
  micTesterLog('subsystem toggles loaded', options);
}

function saveMicTesterSubsystemOptions() {
  const options = applyMicTesterSubsystemOptions();
  localStorage.setItem(MIC_TESTER_SUBSYSTEM_KEY, JSON.stringify(options));
  micTesterLog('subsystem toggles saved', options);
}

function escapeMicTesterOption(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function startMicTester() {
  const subsystemOptions = applyMicTesterSubsystemOptions();
  setMicTesterRunning(true);
  setMicTesterHealth('idle', 'Starting');
  setMicTesterMainThreadHealth('idle', 'Thread starting');
  setMicTesterStatus('Starting app microphone path...');
  setMicTesterTranscript('');
  resetMicTesterDiagnosticLamps('good');
  resetMicTesterChart();
  micTesterLog('starting app mic path', { source: 'window.__mic.startFromUserButton', subsystemOptions });

  try {
    if (!window.__mic?.startFromUserButton) throw new Error('The app microphone controller is unavailable.');
    await window.__mic.startFromUserButton();
  } catch (err) {
    micTesterLog('start failed', { name: err.name, message: err.message });
    setMicTesterStatus(`Mic start failed: ${err.name || err.message}`);
    setMicTesterRunning(false);
    setMicTesterHealth('bad', 'Start failed');
  }
}

function stopMicTester() {
  try { window.__mic?.stopFromUserButton?.(); } catch (err) {}
  setMicTesterRunning(false);
  setMicTesterStatus('Stopped.');
  setMicTesterHealth('idle', 'Idle');
  clearTimeout(micTesterMainThreadRecoveryTimer);
  setMicTesterMainThreadHealth('idle', 'Thread idle');
  resetMicTesterDiagnosticLamps('idle');
  resetMicTesterChart();
  micTesterLog('stopped');
}

function handleMicTesterAppMicEvent(event) {
  const detail = event.detail || {};
  if (detail.type !== 'audio-pump') {
    micTesterLog(`app mic ${detail.type || 'event'}`, detail);
  }

  if (detail.type === 'starting') {
    setMicTesterRunning(true);
    setMicTesterHealth('idle', 'Starting');
    setMicTesterStatus('Starting app microphone path...');
  }
  if (detail.type === 'track-settings' || detail.type === 'stream') {
    setMicTesterStatus(`Using ${detail.label || 'selected microphone'}.`);
    loadMicTesterInputDevices();
  }
  if (detail.type === 'listening' || detail.type === 'server-ready') {
    setMicTesterRunning(true);
    setMicTesterHealth('bad', 'Waiting for audio');
    setMicTesterMainThreadHealth('good', 'Thread good');
    setMicTesterStatus('Listening through app microphone path.');
  }
  if (detail.type === 'debug' && detail.message === 'main thread stall detected') {
    markMicTesterMainThreadStalled(detail);
  }
  if (detail.type === 'diagnostic') {
    handleMicTesterDiagnosticEvent(detail);
  }
  if (detail.type === 'audio-pump') {
    queueMicTesterAudioRender(detail);
  }
  if (detail.type === 'audio-pump-summary') {
    updateMicTesterAudioHealth(detail, true);
  }
  if (detail.type === 'audio-pump-mode') {
    setMicTesterStatus(`Audio capture mode: ${detail.mode || 'unknown'}.`);
  }
  if (detail.type === 'audio-worklet-fallback') {
    setMicTesterStatus(`AudioWorklet fallback: ${detail.message || 'using compatibility processor'}.`);
  }
  if (detail.type === 'partial') {
    setMicTesterTranscript(detail.text || '');
  }
  if (detail.type === 'final') {
    appendMicTesterFinalTranscript(detail.text || '');
  }
  if (detail.type === 'fallback-browser') {
    setMicTesterStatus(detail.reason || 'Falling back to browser speech recognition.');
  }
  if (detail.type === 'silent-input') {
    setMicTesterHealth('bad', 'Silent input');
    setMicTesterStatus(detail.hint || 'The microphone track is live but silent.');
  }
  if (detail.type === 'error') {
    setMicTesterRunning(false);
    setMicTesterHealth('bad', 'Error');
    setMicTesterStatus(detail.display || detail.message || 'Microphone error.');
  }
  if (detail.type === 'stopped') {
    setMicTesterRunning(false);
    setMicTesterHealth('idle', 'Idle');
    clearTimeout(micTesterMainThreadRecoveryTimer);
    setMicTesterMainThreadHealth('idle', 'Thread idle');
    resetMicTesterDiagnosticLamps('idle');
  }
}

function drawMicTesterWaveform() {
  const runtime = micTesterRuntime;
  const canvas = byId('micTesterWaveform');
  if (!runtime || !canvas) return;

  runtime.analyser.getByteTimeDomainData(runtime.dataArray);
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * ratio));
  const height = Math.max(1, Math.floor(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.clearRect(0, 0, width, height);
  ctx.beginPath();
  ctx.lineWidth = 2 * ratio;
  ctx.strokeStyle = '#00e0ff';
  const step = Math.max(1, Math.floor(runtime.dataArray.length / width));
  let x = 0;
  for (let index = 0; index < runtime.dataArray.length; index += step) {
    const y = (runtime.dataArray[index] / 255) * height;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    x += 1;
  }
  ctx.stroke();
  runtime.animationId = requestAnimationFrame(drawMicTesterWaveform);
}

function resetMicTesterChart() {
  micTesterChartSamples = [];
  micTesterPendingAudioDetail = null;
  micTesterAudioRenderPending = false;
  micTesterLastChartRenderAt = 0;
  const canvas = byId('micTesterWaveform');
  if (!canvas) return;
  const ctx = prepareMicTesterCanvas(canvas);
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawMicTesterChartGrid(ctx, canvas.width, canvas.height);
}

function queueMicTesterAudioRender(detail) {
  micTesterPendingAudioDetail = detail;
  if (micTesterAudioRenderPending) return;
  micTesterAudioRenderPending = true;
  requestAnimationFrame(renderQueuedMicTesterAudio);
}

function renderQueuedMicTesterAudio() {
  micTesterAudioRenderPending = false;
  const detail = micTesterPendingAudioDetail;
  micTesterPendingAudioDetail = null;
  if (!detail) return;
  const now = performance.now();
  const gapMs = micTesterLastChartRenderAt ? now - micTesterLastChartRenderAt : 0;
  micTesterLastChartRenderAt = now;
  const startedAt = performance.now();
  drawMicTesterAudio(detail);
  const durationMs = performance.now() - startedAt;
  if (gapMs > MIC_TESTER_CHART_GAP_WARN_MS || durationMs > MIC_TESTER_CHART_DRAW_WARN_MS) {
    markMicTesterDiagnostic('tester-chart', {
      pressure: true,
      gapMs: Number(gapMs.toFixed(1)),
      durationMs: Number(durationMs.toFixed(1))
    });
  } else {
    markMicTesterDiagnostic('tester-chart', { pressure: false });
  }
  updateMicTesterAudioHealth(detail, false);
}

function updateMicTesterAudioHealth(detail, force = false) {
  const now = performance.now();
  if (!force && now - micTesterLastHealthUpdateAt < MIC_TESTER_HEALTH_UPDATE_MS) return;
  micTesterLastHealthUpdateAt = now;
  if (detail.recentAudio || Number(detail.peak || 0) > 0.0001) setMicTesterHealth('good', 'Audio good');
  else setMicTesterHealth('bad', 'No audio');
}

function drawMicTesterAudio(detail) {
  if (micTesterRendererMode === 'waveform') {
    drawMicTesterSharedWaveform();
    return;
  }
  if (micTesterRendererMode === 'power') {
    drawMicTesterPowerBar(detail);
    return;
  }
  drawMicTesterPumpChart(detail);
}

function drawMicTesterSharedWaveform() {
  const canvas = byId('micTesterWaveform');
  if (!canvas) return;
  const renderedLevel = window.__mic?.renderWaveformToCanvas?.(canvas);
  if (!renderedLevel) {
    const ctx = prepareMicTesterCanvas(canvas);
    if (ctx) drawMicTesterChartGrid(ctx, canvas.width, canvas.height);
  }
}

function drawMicTesterPumpChart(detail) {
  const canvas = byId('micTesterWaveform');
  if (!canvas) return;
  const ctx = prepareMicTesterCanvas(canvas);
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  const sample = {
    level: scaleMicTesterAudioLevel(Number(detail.level || 0)),
    peak: scaleMicTesterAudioLevel(Number(detail.peak || 0)),
    recentAudio: Boolean(detail.recentAudio)
  };
  micTesterChartSamples.push(sample);
  const maxSamples = Math.max(16, Math.floor(width / 5));
  if (micTesterChartSamples.length > maxSamples) {
    micTesterChartSamples = micTesterChartSamples.slice(-maxSamples);
  }

  ctx.clearRect(0, 0, width, height);
  drawMicTesterChartGrid(ctx, width, height);

  const barWidth = Math.max(2, Math.floor(width / maxSamples) - 1);
  micTesterChartSamples.forEach((item, index) => {
    const ageIndex = micTesterChartSamples.length - 1 - index;
    const x = ageIndex * (barWidth + 1);
    const peakHeight = Math.max(1, Math.round(item.peak * height));
    const levelHeight = Math.max(1, Math.round(item.level * height));
    ctx.fillStyle = item.recentAudio ? 'rgba(0,224,255,0.26)' : 'rgba(255,77,97,0.22)';
    ctx.fillRect(x, height - peakHeight, barWidth, peakHeight);
    ctx.fillStyle = item.recentAudio ? '#47f27a' : '#ff4d61';
    ctx.fillRect(x, height - levelHeight, barWidth, levelHeight);
  });
}

function drawMicTesterPowerBar(detail) {
  const canvas = byId('micTesterWaveform');
  if (!canvas) return;
  const ctx = prepareMicTesterCanvas(canvas);
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  const level = scaleMicTesterAudioLevel(Number(detail.level || 0));
  const peak = scaleMicTesterAudioLevel(Number(detail.peak || 0));
  const padding = Math.max(12, Math.floor(height * 0.16));
  const barHeight = Math.max(10, height - padding * 2);
  const barWidth = Math.max(2, Math.round(width * level));
  const peakX = Math.min(width - 2, Math.max(1, Math.round(width * peak)));

  ctx.clearRect(0, 0, width, height);
  drawMicTesterChartGrid(ctx, width, height);
  ctx.fillStyle = 'rgba(0,224,255,0.12)';
  ctx.fillRect(0, padding, width, barHeight);
  ctx.fillStyle = detail.recentAudio ? '#47f27a' : '#ff4d61';
  ctx.fillRect(0, padding, barWidth, barHeight);
  ctx.fillStyle = '#00e0ff';
  ctx.fillRect(peakX, padding - 4, Math.max(2, window.devicePixelRatio || 1), barHeight + 8);
}

function scaleMicTesterAudioLevel(value) {
  const clamped = Math.max(0, Math.min(1, Number(value || 0)));
  if (!clamped) return 0;
  return Math.max(0.02, Math.min(1, Math.log10(1 + clamped * 80) / Math.log10(81)));
}

function prepareMicTesterCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * ratio));
  const height = Math.max(1, Math.floor(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return ctx;
}

function drawMicTesterChartGrid(ctx, width, height) {
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(0,224,255,0.08)';
  ctx.lineWidth = Math.max(1, (window.devicePixelRatio || 1));
  for (let row = 1; row < 4; row += 1) {
    const y = Math.round((height / 4) * row);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function logMicTesterTrackSettings(stream) {
  const [track] = stream?.getAudioTracks?.() || [];
  if (!track) {
    micTesterLog('track settings', { error: 'no audio track' });
    return;
  }

  const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};
  track.onmute = () => micTesterLog('track muted', { label: track.label || '' });
  track.onunmute = () => micTesterLog('track unmuted', { label: track.label || '' });
  track.onended = () => micTesterLog('track ended', { label: track.label || '' });
  micTesterLog('track settings', {
    label: track.label || '',
    enabled: track.enabled,
    muted: track.muted,
    readyState: track.readyState,
    deviceId: settings.deviceId ? 'set' : 'unset',
    sampleRate: settings.sampleRate || null,
    channelCount: settings.channelCount || null,
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl
  });
}

function micTesterServerUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/api/stt/stream`;
}

async function micTesterServerSocketUrl() {
  const response = await fetch('/api/stt/token', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }
  });
  const json = await response.json();
  if (!json.ok || !json.data?.token) throw new Error(json.error || 'STT socket token unavailable.');
  return `${micTesterServerUrl()}?token=${encodeURIComponent(json.data.token)}`;
}

async function startMicTesterServerStt(provider) {
  const runtime = micTesterRuntime;
  if (!runtime || !window.WebSocket) {
    if (provider === 'server') setMicTesterStatus('WebSocket is unavailable for server STT.');
    else startMicTesterBrowserStt();
    return;
  }

  let socketUrl;
  try {
    socketUrl = await micTesterServerSocketUrl();
  } catch (err) {
    micTesterLog('server stt token failed', { message: err.message });
    if (provider === 'server') {
      setMicTesterStatus(`Server STT auth failed: ${err.message}`);
    } else {
      startMicTesterFallback(err.message);
    }
    return;
  }

  if (!micTesterRuntime || runtime.stopped) return;
  runtime.socket = new WebSocket(socketUrl);
  runtime.socket.binaryType = 'arraybuffer';
  runtime.socket.onopen = () => micTesterLog('server stt socket opened');
  runtime.socket.onmessage = event => handleMicTesterServerMessage(event.data, provider);
  runtime.socket.onerror = () => {
    micTesterLog('server stt socket error');
    if (provider === 'server') setMicTesterStatus('Server STT socket error.');
    else startMicTesterFallback('Server STT socket error.');
  };
  runtime.socket.onclose = event => {
    micTesterLog('server stt socket closed', { code: event.code, reason: event.reason });
    if (!runtime.stopped && provider !== 'server' && event.code !== 1000) {
      startMicTesterFallback(`Server STT socket closed: ${event.reason || event.code}`);
    }
  };
}

function handleMicTesterServerMessage(raw, provider) {
  let message = {};
  try {
    message = JSON.parse(String(raw || '{}'));
  } catch (err) {
    micTesterLog('bad server stt message', { raw: String(raw || '') });
    return;
  }
  micTesterLog(`server ${message.type || 'message'}`, message);

  if (message.type === 'ready') {
    setMicTesterStatus('Server STT ready.');
    startMicTesterServerPump();
    return;
  }
  if (message.type === 'partial') {
    setMicTesterTranscript(message.text || '');
    return;
  }
  if (message.type === 'final') {
    appendMicTesterFinalTranscript(message.text || '');
    return;
  }
  if (message.type === 'unavailable' || message.type === 'error') {
    setMicTesterStatus(message.error || 'Server STT unavailable.');
    if (message.state && byId('micTesterSttStatus')) byId('micTesterSttStatus').textContent = message.state;
    if (message.sampleRate && byId('micTesterSampleRate')) byId('micTesterSampleRate').textContent = `${message.sampleRate} Hz`;
    if (byId('micTesterDetails')) byId('micTesterDetails').textContent = message.error || 'Server STT unavailable.';
    if (provider !== 'server') startMicTesterFallback(message.error || 'Server STT unavailable.');
  }
}

function startMicTesterFallback(reason) {
  const runtime = micTesterRuntime;
  if (!runtime || runtime.fallbackStarted) return;
  runtime.fallbackStarted = true;
  micTesterLog('falling back to browser stt', { reason });
  startMicTesterBrowserStt();
}

function startMicTesterServerPump() {
  const runtime = micTesterRuntime;
  if (!runtime || !runtime.socket || runtime.socket.readyState !== WebSocket.OPEN) return;
  stopMicTesterServerPump(runtime);
  runtime.pumpStats = {
    chunks: 0,
    lastChunkAt: Date.now(),
    lastLogAt: 0,
    level: 0,
    peak: 0,
    silentSince: Date.now(),
    silentLogged: false
  };
  runtime.processor = runtime.audioContext.createScriptProcessor(4096, 1, 1);
  runtime.silenceGain = runtime.audioContext.createGain();
  runtime.silenceGain.gain.value = 0;
  runtime.processor.onaudioprocess = event => {
    if (!micTesterRuntime || runtime.socket.readyState !== WebSocket.OPEN) return;
    const input = event.inputBuffer.getChannelData(0);
    const pcm = micTesterDownsamplePcm(input, runtime.audioContext.sampleRate, 16000);
    if (pcm.byteLength) {
      runtime.pumpStats.chunks += 1;
      runtime.pumpStats.lastChunkAt = Date.now();
      const levels = micTesterInputLevels(input);
      runtime.pumpStats.level = levels.average;
      runtime.pumpStats.peak = levels.peak;
      if (levels.peak > 0.0001) {
        runtime.heardInput = true;
        setMicTesterHealth('good', 'Audio good');
        runtime.pumpStats.silentSince = Date.now();
        runtime.pumpStats.silentLogged = false;
      } else if (!runtime.pumpStats.silentLogged && Date.now() - runtime.pumpStats.silentSince > 3000) {
        runtime.pumpStats.silentLogged = true;
        setMicTesterHealth('bad', 'No audio');
        micTesterLog('silent input detected', {
          chunks: runtime.pumpStats.chunks,
          hint: 'The selected input device is delivering all-zero samples.'
        });
      }
      micTesterMaybeRecoverSilentInput(runtime);
      runtime.socket.send(pcm.buffer);
      micTesterMaybeLogPumpStats(runtime);
    }
  };
  runtime.source.connect(runtime.processor);
  runtime.processor.connect(runtime.silenceGain);
  runtime.silenceGain.connect(runtime.audioContext.destination);
  runtime.pumpWatchdog = setInterval(() => micTesterWatchServerPump(runtime), 1000);
}

function stopMicTesterServerPump(runtime) {
  if (!runtime) return;
  if (runtime.pumpWatchdog) {
    clearInterval(runtime.pumpWatchdog);
    runtime.pumpWatchdog = null;
  }
  if (runtime.processor) {
    try { runtime.processor.disconnect(); } catch (err) {}
    runtime.processor.onaudioprocess = null;
    runtime.processor = null;
  }
  if (runtime.silenceGain) {
    try { runtime.silenceGain.disconnect(); } catch (err) {}
    runtime.silenceGain = null;
  }
}

function micTesterWatchServerPump(runtime) {
  if (!micTesterRuntime || runtime.stopped || runtime.socket?.readyState !== WebSocket.OPEN) return;
  if (runtime.audioContext?.state === 'suspended') {
    runtime.audioContext.resume().catch(err => micTesterLog('audio context resume failed', { message: err.message }));
  }
  const elapsed = Date.now() - (runtime.pumpStats?.lastChunkAt || 0);
  if (elapsed <= 2500) return;
  micTesterLog('audio pump stalled; rebuilding', {
    elapsedMs: elapsed,
    chunks: runtime.pumpStats?.chunks || 0,
    audioState: runtime.audioContext?.state || 'unknown'
  });
  startMicTesterServerPump();
}

function micTesterMaybeLogPumpStats(runtime) {
  const now = Date.now();
  if (!runtime.pumpStats || now - runtime.pumpStats.lastLogAt < 1000) return;
  runtime.pumpStats.lastLogAt = now;
  micTesterLog('audio pump', {
    chunks: runtime.pumpStats.chunks,
    level: Number(runtime.pumpStats.level.toFixed(6)),
    peak: Number(runtime.pumpStats.peak.toFixed(6)),
    sampleRate: runtime.audioContext.sampleRate
  });
}

function micTesterMaybeRecoverSilentInput(runtime) {
  if (!runtime?.heardInput || runtime.restartingInput || !runtime.pumpStats) return;
  const now = Date.now();
  const silentMs = now - runtime.pumpStats.silentSince;
  if (silentMs < 8000 || now - runtime.lastInputRestartAt < 15000) return;

  if (isMicTesterMobileBrowser()) {
    runtime.restartingInput = true;
    micTesterLog('silent input restart skipped', {
      silentMs,
      reason: 'Mobile browsers require microphone restarts from a user tap.'
    });
    setMicTesterHealth('bad', 'Tap Start again');
    return;
  }

  runtime.restartingInput = true;
  runtime.lastInputRestartAt = now;
  micTesterLog('restarting silent input', {
    silentMs,
    hint: 'The browser kept the track live but delivered digital silence after previously hearing audio.'
  });
  setTimeout(() => {
    if (micTesterRuntime === runtime && !runtime.stopped) startMicTester();
  }, 0);
}

function micTesterInputLevels(input) {
  if (!input?.length) return { average: 0, peak: 0 };
  let sum = 0;
  let peak = 0;
  for (let index = 0; index < input.length; index += 1) {
    const value = Math.abs(input[index] || 0);
    sum += value;
    if (value > peak) peak = value;
  }
  return { average: sum / input.length, peak };
}

function startMicTesterBrowserStt() {
  const runtime = micTesterRuntime;
  if (!runtime) return;
  if (runtime.browserSttStarted) {
    micTesterLog('browser stt already started');
    return;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setMicTesterStatus('Browser SpeechRecognition is not supported here.');
    micTesterLog('browser stt unsupported');
    return;
  }

  if (runtime.recognition) {
    try { runtime.recognition.abort(); } catch (err) {}
  }
  runtime.recognition = new SpeechRecognition();
  runtime.browserSttStarted = true;
  runtime.recognition.continuous = true;
  runtime.recognition.interimResults = true;
  runtime.recognition.lang = 'en-US';
  runtime.recognition.onstart = () => {
    runtime.browserSttActive = true;
    setMicTesterStatus('Browser STT listening.');
    micTesterLog('browser stt started');
  };
  runtime.recognition.onresult = event => {
    let interim = '';
    let final = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const text = event.results[index][0].transcript;
      if (event.results[index].isFinal) final += text;
      else interim += text;
    }
    if (final.trim()) appendMicTesterFinalTranscript(final);
    else setMicTesterTranscript(interim.trim());
  };
  runtime.recognition.onerror = event => {
    if (event.error === 'no-speech') {
      setMicTesterStatus('Browser STT listening.');
      setMicTesterTranscript('Listening...');
      micTesterLog('browser stt no-speech');
      return;
    }
    setMicTesterStatus(`Browser STT error: ${event.error || 'unknown'}`);
    micTesterLog('browser stt error', { error: event.error, message: event.message });
  };
  runtime.recognition.onend = () => {
    if (!micTesterRuntime || micTesterRuntime.stopped) return;
    runtime.browserSttActive = false;
    clearTimeout(runtime.browserSttRestartTimer);
    runtime.browserSttRestartTimer = setTimeout(() => {
      if (micTesterRuntime !== runtime || runtime.stopped || runtime.browserSttActive) return;
      micTesterStartBrowserRecognition(runtime, 'restart');
    }, 300);
  };
  micTesterStartBrowserRecognition(runtime, 'start');
}

function micTesterStartBrowserRecognition(runtime, mode) {
  if (!runtime?.recognition || runtime.browserSttActive) return;
  try {
    runtime.recognition.start();
  } catch (err) {
    setMicTesterStatus(`Browser STT start failed: ${err.message}`);
    micTesterLog('browser stt start failed', { mode, name: err.name, message: err.message });
  }
}

function appendMicTesterFinalTranscript(text) {
  const runtime = micTesterRuntime;
  const cleaned = String(text || '').replace(/[^\S\r\n]+/g, ' ').trim();
  if (!runtime || !cleaned) return;
  runtime.finalTranscript = `${runtime.finalTranscript} ${cleaned}`.trim();
  setMicTesterTranscript(runtime.finalTranscript);
  micTesterLog('final transcript', { text: cleaned });
}

function micTesterDownsamplePcm(input, inputSampleRate, outputSampleRate) {
  if (!input || inputSampleRate <= outputSampleRate) return micTesterFloatToPcm(input || new Float32Array());
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);
  let inputOffset = 0;
  for (let outputOffset = 0; outputOffset < outputLength; outputOffset += 1) {
    const nextInputOffset = Math.round((outputOffset + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let index = inputOffset; index < nextInputOffset && index < input.length; index += 1) {
      sum += input[index];
      count += 1;
    }
    output[outputOffset] = count ? sum / count : 0;
    inputOffset = nextInputOffset;
  }
  return micTesterFloatToPcm(output);
}

function micTesterFloatToPcm(input) {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] || 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}
