let voicePipelineRuntime = null;
const voicePipelineLogEntries = [];
let voicePipelineChartSamples = [];
let voicePipelineChartRenderPending = false;
let voicePipelineChartAnimationId = null;
let voicePipelineLatestChartDetail = null;
let voicePipelineLastChartStatusAt = 0;
let voicePipelineLastChartPressureAt = 0;
let voicePipelineRendererMode = 'scroll';
let voicePipelineDeviceRefreshTimer = null;
let voicePipelineDeferredDeviceRefresh = false;
let voicePipelinePcmSignalProblem = false;
let voicePipelineLastTrackSettings = null;
const VOICE_PIPELINE_LOG_MAX_LINES = 500;
const VOICE_PIPELINE_CHART_DRAW_WARN_MS = 24;
const VOICE_PIPELINE_CHART_STATUS_MS = 250;
const VOICE_PIPELINE_CHART_PRESSURE_LOG_MS = 1000;
const VOICE_PIPELINE_SOCKET_PRESSURE_WARN_BYTES = 64 * 1024;

function initVoicePipelineTester() {
  byId('voicePipelineStart')?.addEventListener('click', startVoicePipelineTester);
  byId('voicePipelineStop')?.addEventListener('click', stopVoicePipelineTester);
  byId('voicePipelineCopyDebug')?.addEventListener('click', copyVoicePipelineDebug);
  byId('voicePipelineInputDevice')?.addEventListener('change', saveVoicePipelineInputDevice);
  document.querySelectorAll('[data-voice-pipeline-toggle], .voice-pipeline-tester-view input[id^="voicePipelineToggle"]').forEach(input => {
    input.addEventListener('change', () => voicePipelineLog('stage toggles changed', getVoicePipelineStageOptions()));
  });
  document.querySelectorAll('[data-voice-pipeline-renderer]').forEach(button => {
    button.addEventListener('click', () => setVoicePipelineRendererMode(button.dataset.voicePipelineRenderer));
  });

  window.addEventListener('bob:mic', handleVoicePipelineMicEvent);
  navigator.mediaDevices?.addEventListener?.('devicechange', () => queueVoicePipelineInputDeviceRefresh({ reason: 'devicechange' }));

  queueVoicePipelineInputDeviceRefresh();
  loadVoicePipelineStatus();
  resetVoicePipelineLamps();
  setVoicePipelineRunning(false);
  setVoicePipelineRendererMode(voicePipelineRendererMode, { quiet: true });
  resetVoicePipelineChart();
}

function voicePipelineLog(message, data) {
  if (!getVoicePipelineUiOptions().events && message.startsWith('app mic ')) return;
  const suffix = data === undefined ? '' : ` ${JSON.stringify(data)}`;
  const line = `[${new Date().toLocaleTimeString()}] ${message}${suffix}`;
  voicePipelineLogEntries.unshift(line);
  if (voicePipelineLogEntries.length > VOICE_PIPELINE_LOG_MAX_LINES) voicePipelineLogEntries.length = VOICE_PIPELINE_LOG_MAX_LINES;
  const events = byId('voicePipelineEvents');
  if (events) events.textContent = voicePipelineLogEntries.join('\n');
  console.info('[voice-pipeline-tester]', message, data || '');
}

function voicePipelineToggle(id, fallback = true) {
  const input = byId(id);
  return input ? Boolean(input.checked) : fallback;
}

function getVoicePipelineStageOptions() {
  return {
    vad: voicePipelineToggle('voicePipelineToggleVad'),
    stt: voicePipelineToggle('voicePipelineToggleStt'),
    llm: voicePipelineToggle('voicePipelineToggleLlm'),
    tts: voicePipelineToggle('voicePipelineToggleTts'),
    audioOutput: voicePipelineToggle('voicePipelineToggleAudio')
  };
}

function getVoicePipelineUiOptions() {
  return {
    chart: voicePipelineToggle('voicePipelineToggleChart'),
    events: voicePipelineToggle('voicePipelineToggleEvents')
  };
}

function getVoicePipelineAudioConstraintsOverride() {
  if (!voicePipelineToggle('voicePipelineToggleRawMic')) return null;
  return {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  };
}

function setVoicePipelineRendererMode(mode, options = {}) {
  const nextMode = ['scroll', 'waveform', 'power'].includes(mode) ? mode : 'scroll';
  voicePipelineRendererMode = nextMode;
  document.querySelectorAll('[data-voice-pipeline-renderer]').forEach(button => {
    const active = button.dataset.voicePipelineRenderer === nextMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  resetVoicePipelineChart();
  if (!options.quiet) voicePipelineLog('chart renderer changed', { mode: nextMode });
}

function setVoicePipelineRunning(isRunning) {
  byId('voicePipelineStart')?.toggleAttribute('disabled', isRunning);
  byId('voicePipelineStop')?.toggleAttribute('disabled', !isRunning);
  setVoicePipelineCaptureControlsLocked(isRunning);
}

function setVoicePipelineCaptureControlsLocked(isLocked) {
  [
    'voicePipelineInputDevice',
    'voicePipelineToggleRawMic',
    'voicePipelineToggleVad',
    'voicePipelineToggleStt',
    'voicePipelineToggleLlm',
    'voicePipelineToggleTts',
    'voicePipelineToggleAudio'
  ].forEach(id => byId(id)?.toggleAttribute('disabled', isLocked));
}

function setVoicePipelineLamp(name, state, label) {
  const light = byId(`voicePipeline${name}Light`);
  const text = byId(`voicePipeline${name}`);
  if (light) {
    light.classList.remove('mic-status-light-idle', 'mic-status-light-good', 'mic-status-light-bad');
    light.classList.add(`mic-status-light-${state}`);
    light.setAttribute('aria-label', `${name}: ${label}`);
  }
  if (text) text.textContent = label;
}

function resetVoicePipelineLamps() {
  voicePipelinePcmSignalProblem = false;
  setVoicePipelineLamp('Mic', 'idle', 'Mic idle');
  setVoicePipelineLamp('MicAudio', 'idle', 'Mic audio idle');
  setVoicePipelineLamp('Pcm', 'idle', 'PCM pump idle');
  setVoicePipelineLamp('Transport', 'idle', 'Transport idle');
  setVoicePipelineLamp('Pressure', 'idle', 'Back pressure idle');
  setVoicePipelineLamp('Vad', 'idle', 'VAD idle');
  setVoicePipelineLamp('Stt', 'idle', 'STT idle');
  setVoicePipelineLamp('Ollama', 'idle', 'Ollama idle');
  setVoicePipelineLamp('Tts', 'idle', 'Kokoro idle');
  setVoicePipelineLamp('Audio', 'idle', 'Audio output idle');
}

function resetVoicePipelineChart() {
  voicePipelineChartSamples = [];
  voicePipelineChartRenderPending = false;
  voicePipelineLatestChartDetail = null;
  voicePipelineLastChartStatusAt = 0;
  voicePipelineLastChartPressureAt = 0;
  const status = byId('voicePipelineChartStatus');
  if (status) status.textContent = 'Waiting for mic samples.';
  const canvas = byId('voicePipelineMicChart');
  const ctx = canvas?.getContext?.('2d');
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function startVoicePipelineChartLoop() {
  stopVoicePipelineChartLoop();
  const tick = () => {
    if (!voicePipelineRuntime?.running) {
      voicePipelineChartAnimationId = null;
      return;
    }
    const options = getVoicePipelineUiOptions();
    const snapshot = window.__mic?.getAudioLevelSnapshot?.();
    if (snapshot?.running) {
      const detail = {
        type: 'analyser-snapshot',
        level: Number(snapshot.level || 0),
        peak: Number(snapshot.peak || 0),
        currentPeak: Number(snapshot.peak || 0),
        sampleRate: snapshot.sampleRate || null,
        expectedChunkMs: 0,
        chunkGapMs: 0
      };
      updateVoicePipelineMicAudioLamp(detail);
      if (options.chart) {
        appendVoicePipelineChartSample(detail);
        voicePipelineLatestChartDetail = detail;
        drawVoicePipelineMicChart();
      }
    }
    voicePipelineChartAnimationId = requestAnimationFrame(tick);
  };
  voicePipelineChartAnimationId = requestAnimationFrame(tick);
}

function stopVoicePipelineChartLoop() {
  if (voicePipelineChartAnimationId) cancelAnimationFrame(voicePipelineChartAnimationId);
  voicePipelineChartAnimationId = null;
  voicePipelineChartRenderPending = false;
}

async function loadVoicePipelineInputDevices() {
  const select = byId('voicePipelineInputDevice');
  if (!select || !navigator.mediaDevices?.enumerateDevices) return;

  const selected = window.__mic?.selectedMicInputDeviceId?.() || select.value || '';
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = uniqueVoicePipelineInputDevices(devices.filter(device => device.kind === 'audioinput'));
    select.innerHTML = '<option value="">Browser default microphone</option>';
    inputs.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Microphone ${index + 1}`;
      select.appendChild(option);
    });
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
    voicePipelineLog('input devices loaded', { count: inputs.length, labelsVisible: inputs.some(device => Boolean(device.label)) });
  } catch (err) {
    voicePipelineLog('input device list failed', { message: err.message });
  }
}

function queueVoicePipelineInputDeviceRefresh(options = {}) {
  if (voicePipelineRuntime?.running && !options.force) {
    voicePipelineDeferredDeviceRefresh = true;
    voicePipelineLog('input device refresh deferred during active capture', { reason: options.reason || 'requested' });
    return;
  }
  voicePipelineDeferredDeviceRefresh = false;
  clearTimeout(voicePipelineDeviceRefreshTimer);
  voicePipelineDeviceRefreshTimer = setTimeout(loadVoicePipelineInputDevices, 150);
}

function uniqueVoicePipelineInputDevices(devices = []) {
  const seen = new Set();
  return devices.filter(device => {
    const id = String(device.deviceId || '');
    if (!id || id === 'default') return false;
    const key = id || String(device.label || '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function saveVoicePipelineInputDevice() {
  const value = byId('voicePipelineInputDevice')?.value || '';
  window.__mic?.setSelectedMicInputDeviceId?.(value);
  voicePipelineLog('input device saved', { inputDevice: value ? 'selected' : 'browser-default' });
}

async function loadVoicePipelineStatus() {
  try {
    const response = await fetch('/api/voice/pipeline/status', { cache: 'no-store' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Pipeline status unavailable');
    const data = json.data || {};
    byId('voicePipelineSttStatus') && (byId('voicePipelineSttStatus').textContent = [data.stt || data.provider || 'unknown', data.state].filter(Boolean).join(' - '));
    byId('voicePipelineSampleRate') && (byId('voicePipelineSampleRate').textContent = data.sampleRate ? `${data.sampleRate} Hz` : 'Unknown');
    byId('voicePipelineVadStatus') && (byId('voicePipelineVadStatus').textContent = data.vad ? 'configured' : 'unknown');
    byId('voicePipelineDetails') && (byId('voicePipelineDetails').textContent = data.error || data.model || data.modelPath || 'Pipeline status loaded.');
  } catch (err) {
    byId('voicePipelineSttStatus') && (byId('voicePipelineSttStatus').textContent = 'error');
    byId('voicePipelineDetails') && (byId('voicePipelineDetails').textContent = err.message);
    voicePipelineLog('pipeline status failed', { message: err.message });
  }

  try {
    const response = await fetch('/api/tts/status', { cache: 'no-store' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'TTS status unavailable');
    byId('voicePipelineTtsStatus') && (byId('voicePipelineTtsStatus').textContent = json.data?.provider || json.data?.kokoro?.state || 'unknown');
  } catch (err) {
    byId('voicePipelineTtsStatus') && (byId('voicePipelineTtsStatus').textContent = 'error');
  }
}

async function startVoicePipelineTester() {
  if (voicePipelineRuntime?.running) return;
  if (!window.__mic?.startFromUserButton) {
    voicePipelineLog('start failed', { message: 'The app microphone controller is unavailable.' });
    return;
  }

  const previousDiagnostics = window.__mic.getDiagnosticOptions?.() || {};
  const previousSettingsOverride = window.__mic.getSettingsOverride?.() || null;
  const audioConstraints = getVoicePipelineAudioConstraintsOverride();
  voicePipelineRuntime = {
    running: true,
    previousDiagnostics,
    previousSettingsOverride,
    activeCaptureMode: audioConstraints ? 'raw' : 'browser-processed'
  };
  resetVoicePipelineLamps();
  resetVoicePipelineChart();
  setVoicePipelineRunning(true);
  setVoicePipelineLamp('Mic', 'idle', 'Mic starting');
  setVoicePipelineLamp('MicAudio', 'idle', 'Mic audio waiting');
  setVoicePipelineLamp('Pcm', 'idle', 'PCM pump waiting');
  byId('voicePipelineTranscript') && (byId('voicePipelineTranscript').textContent = 'Listening...');
  byId('voicePipelineResponse') && (byId('voicePipelineResponse').textContent = 'No response yet.');

  const stageOptions = getVoicePipelineStageOptions();
  const needsPipelineTransport = Object.values(stageOptions).some(Boolean);
  voicePipelineLastTrackSettings = null;
  window.__mic.setSettingsOverride?.({
    transcriptionProvider: 'pipeline',
    ...(audioConstraints ? { audioConstraints } : {})
  });
  window.__mic.setDiagnosticOptions?.({
    ...previousDiagnostics,
    serverStt: needsPipelineTransport,
    audioWorklet: true,
    browserStt: false,
    autoSubmit: false,
    waveform: false,
    watchdog: true,
    utteranceFlush: true,
    voicePipelineVad: stageOptions.vad,
    voicePipelineStt: stageOptions.stt,
    voicePipelineLlm: stageOptions.llm,
    voicePipelineTts: stageOptions.tts,
    voicePipelineAudioOutput: stageOptions.audioOutput
  });

  voicePipelineLog('starting app mic pipeline path', {
    source: 'window.__mic.startFromUserButton',
    providerOverride: 'pipeline',
    serverTransport: needsPipelineTransport ? 'enabled' : 'disabled',
    chartSource: 'analyser',
    audioConstraints: audioConstraints || 'browser-processed',
    activeCaptureMode: audioConstraints ? 'raw' : 'browser-processed',
    stageOptions,
    uiOptions: getVoicePipelineUiOptions()
  });

  try {
    await window.__mic.startFromUserButton();
    startVoicePipelineChartLoop();
  } catch (err) {
    voicePipelineLog('start failed', { name: err.name, message: err.message });
    stopVoicePipelineTester();
  }
}

function stopVoicePipelineTester() {
  const runtime = voicePipelineRuntime;
  stopVoicePipelineChartLoop();
  try { window.__mic?.stopFromUserButton?.(); } catch (err) {}
  if (runtime) {
    window.__mic?.setDiagnosticOptions?.(runtime.previousDiagnostics || {});
    window.__mic?.setSettingsOverride?.(runtime.previousSettingsOverride || null);
  } else {
    window.__mic?.setSettingsOverride?.(null);
  }
  voicePipelineRuntime = null;
  setVoicePipelineRunning(false);
  resetVoicePipelineLamps();
  if (voicePipelineDeferredDeviceRefresh) queueVoicePipelineInputDeviceRefresh({ force: true });
  voicePipelineLog('stopped');
}

function handleVoicePipelineMicEvent(event) {
  if (!voicePipelineRuntime?.running) return;
  const detail = event.detail || {};
  if (detail.type !== 'audio-pump') {
    voicePipelineLog(`app mic ${detail.type || 'event'}`, detail);
  }

  if (detail.type === 'stream' || detail.type === 'track-settings') {
    voicePipelineLastTrackSettings = detail;
    setVoicePipelineLamp('Mic', 'good', 'Mic track live');
    return;
  }

  if (detail.type === 'media-device-change') {
    voicePipelineLastTrackSettings = detail.track || voicePipelineLastTrackSettings;
    return;
  }

  if (detail.type === 'audio-pump' || detail.type === 'audio-pump-summary') {
    updateVoicePipelinePcmLamp(detail);
    return;
  }

  if (detail.type === 'mic-signal-dropout' || detail.type === 'silent-input') {
    voicePipelinePcmSignalProblem = true;
    setVoicePipelineLamp('MicAudio', 'bad', 'Mic audio is 0');
    setVoicePipelineLamp('Pcm', 'bad', detail.type === 'silent-input' ? 'PCM delivering silence' : 'PCM audio interrupted');
    return;
  }

  if (detail.type === 'mic-signal-recovered') {
    voicePipelinePcmSignalProblem = false;
    setVoicePipelineLamp('Pcm', 'good', 'PCM audio recovered');
    return;
  }

  if (detail.type === 'stream-track-event') {
    const badTrack = detail.eventType === 'mute' || detail.eventType === 'ended';
    setVoicePipelineLamp('Mic', badTrack ? 'bad' : 'good', badTrack ? `Mic track ${detail.eventType}` : 'Mic track unmuted');
    return;
  }

  if (detail.type === 'audio-context-state') {
    const badState = detail.state === 'suspended' || detail.state === 'closed';
    setVoicePipelineLamp('Mic', badState ? 'bad' : 'good', badState ? `Audio context ${detail.state}` : 'Audio context running');
    return;
  }

  if (detail.type === 'stage-options') {
    voicePipelineLog('server stage options applied', detail.options || {});
    return;
  }

  if (detail.type === 'stage-skipped') {
    const stage = String(detail.stage || '').toLowerCase();
    if (stage === 'stt') setVoicePipelineLamp('Stt', 'idle', 'STT disabled');
    if (stage === 'llm') setVoicePipelineLamp('Ollama', 'idle', 'Ollama disabled');
    if (stage === 'tts') setVoicePipelineLamp('Tts', 'idle', 'Kokoro disabled');
    return;
  }

  if (detail.type === 'server-open') {
    setVoicePipelineLamp('Transport', 'good', 'Transport connected');
    return;
  }

  if (detail.type === 'server-ready') {
    setVoicePipelineLamp('Transport', 'good', 'Pipecat ready');
    setVoicePipelineLamp('Vad', 'good', 'VAD ready');
    setVoicePipelineLamp('Stt', 'good', 'STT ready');
    return;
  }

  if (detail.type === 'vad-start') {
    setVoicePipelineLamp('Vad', 'good', 'Speech started');
    return;
  }

  if (detail.type === 'vad-end') {
    setVoicePipelineLamp('Vad', 'good', 'Turn ended');
    setVoicePipelineLamp('Stt', 'idle', 'STT processing');
    return;
  }

  if (detail.type === 'stt-start') {
    setVoicePipelineLamp('Stt', 'idle', `${detail.provider || 'STT'} transcribing`);
    return;
  }

  if (detail.type === 'stt-complete') {
    setVoicePipelineLamp('Stt', 'good', `${detail.provider || 'STT'} complete`);
    return;
  }

  if (detail.type === 'partial') {
    setVoicePipelineLamp('Stt', 'good', 'STT partial');
    byId('voicePipelineTranscript') && (byId('voicePipelineTranscript').textContent = detail.text || 'Listening...');
    return;
  }

  if (detail.type === 'final') {
    setVoicePipelineLamp('Stt', 'good', 'STT final');
    setVoicePipelineLamp('Ollama', 'idle', 'Ollama processing');
    byId('voicePipelineTranscript') && (byId('voicePipelineTranscript').textContent = detail.text || 'No transcript.');
    return;
  }

  if (detail.type === 'assistant-text') {
    setVoicePipelineLamp('Ollama', 'good', 'Ollama response');
    setVoicePipelineLamp('Tts', 'idle', 'Kokoro speaking');
    byId('voicePipelineResponse') && (byId('voicePipelineResponse').textContent = detail.text || 'No response text.');
    return;
  }

  if (detail.type === 'audio-output') {
    setVoicePipelineLamp('Tts', 'good', 'Kokoro audio ready');
    setVoicePipelineLamp('Audio', 'good', 'Audio playing');
    return;
  }

  if (detail.type === 'voice-pipeline-audio-playback') {
    const state = String(detail.state || '');
    if (state === 'start') setVoicePipelineLamp('Audio', 'good', 'Audio playing');
    if (state === 'end') setVoicePipelineLamp('Audio', 'good', 'Audio output complete');
    if (state === 'error') setVoicePipelineLamp('Audio', 'bad', 'Audio output failed');
    return;
  }

  if (detail.type === 'audio-output-error') {
    setVoicePipelineLamp('Audio', 'bad', 'Audio output failed');
    return;
  }

  if (detail.type === 'turn-complete') {
    setVoicePipelineLamp('Vad', 'good', 'Turn complete');
    setVoicePipelineLamp('Audio', 'good', 'Audio output complete');
    return;
  }

  if (detail.type === 'diagnostic') {
    handleVoicePipelineDiagnostic(detail);
    return;
  }

  if (['error', 'server-error', 'server-unavailable', 'worker-error'].includes(detail.type)) {
    setVoicePipelineLamp('Transport', 'bad', detail.error || 'Pipeline error');
  }
}

function queueVoicePipelineMicChart(detail) {
  if (!getVoicePipelineUiOptions().chart) return;
  appendVoicePipelineChartSample(detail);
  voicePipelineLatestChartDetail = detail;
  if (voicePipelineChartRenderPending) return;
  voicePipelineChartRenderPending = true;
  requestAnimationFrame(drawVoicePipelineMicChart);
}

function appendVoicePipelineChartSample(detail) {
  const canvas = byId('voicePipelineMicChart');
  const width = canvas?.width || 720;
  const barWidth = 4;
  const gap = 1;
  const maxSamples = Math.max(1, Math.floor(width / (barWidth + gap)));
  const peak = Number(detail.peak || detail.currentPeak || 0);
  const level = Number(detail.level || 0);
  const chunkGapMs = Number(detail.chunkGapMs || 0);
  const expectedChunkMs = Number(detail.expectedChunkMs || 0);
  const stalled = expectedChunkMs > 0 && chunkGapMs > expectedChunkMs * 2.5;

  voicePipelineChartSamples.unshift({
    level,
    peak,
    stalled,
    chunkGapMs
  });
  if (voicePipelineChartSamples.length > maxSamples) voicePipelineChartSamples.length = maxSamples;
}

function drawVoicePipelineMicChart() {
  voicePipelineChartRenderPending = false;
  if (voicePipelineRendererMode === 'waveform') {
    drawVoicePipelineSharedWaveform();
    return;
  }
  if (voicePipelineRendererMode === 'power') {
    drawVoicePipelinePowerBar();
    return;
  }
  drawVoicePipelineScrollChart();
}

function drawVoicePipelineScrollChart() {
  const canvas = byId('voicePipelineMicChart');
  const ctx = canvas?.getContext?.('2d');
  if (!canvas || !ctx) return;

  const startedAt = performance.now();
  const width = canvas.width;
  const height = canvas.height;
  const barWidth = 4;
  const gap = 1;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(0,224,255,0.08)';
  ctx.lineWidth = 1;
  for (let y = 28; y < height; y += 36) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  voicePipelineChartSamples.forEach((sample, index) => {
    const x = index * (barWidth + gap);
    const scaledLevel = scaleVoicePipelineAudioLevel(sample.level);
    const scaledPeak = scaleVoicePipelineAudioLevel(sample.peak);
    const levelHeight = Math.max(1, Math.round(scaledLevel * (height - 12)));
    const peakHeight = Math.max(levelHeight, Math.round(scaledPeak * (height - 12)));
    ctx.fillStyle = sample.stalled ? '#ff4d61' : 'rgba(0,224,255,0.28)';
    ctx.fillRect(x, height - peakHeight, barWidth, peakHeight);
    ctx.fillStyle = sample.stalled ? '#ff9aaa' : '#47f27a';
    ctx.fillRect(x, height - levelHeight, barWidth, levelHeight);
  });

  const detail = voicePipelineLatestChartDetail || {};
  const peak = Number(detail.peak || detail.currentPeak || 0);
  const level = Number(detail.level || 0);
  const chunkGapMs = Number(detail.chunkGapMs || 0);
  updateVoicePipelineChartStatus(
    `Scroll | samples ${voicePipelineChartSamples.length} | level ${level.toFixed(6)} | peak ${peak.toFixed(6)} | chunk gap ${chunkGapMs || 0} ms`
  );
  logVoicePipelineChartPressure(performance.now() - startedAt);
}

function drawVoicePipelineSharedWaveform() {
  const canvas = byId('voicePipelineMicChart');
  if (!canvas) return;
  const startedAt = performance.now();
  const renderedLevel = window.__mic?.renderWaveformToCanvas?.(canvas);
  const detail = voicePipelineLatestChartDetail || {};
  const level = Number.isFinite(Number(renderedLevel)) ? Number(renderedLevel) : Number(detail.level || 0);
  const peak = Number(detail.peak || detail.currentPeak || 0);
  updateVoicePipelineChartStatus(`Wave | level ${level.toFixed(6)} | peak ${peak.toFixed(6)}`);
  logVoicePipelineChartPressure(performance.now() - startedAt);
}

function drawVoicePipelinePowerBar() {
  const canvas = byId('voicePipelineMicChart');
  const ctx = canvas?.getContext?.('2d');
  if (!canvas || !ctx) return;

  const startedAt = performance.now();
  const width = canvas.width;
  const height = canvas.height;
  const detail = voicePipelineLatestChartDetail || {};
  const peak = Number(detail.peak || detail.currentPeak || 0);
  const level = Number(detail.level || 0);
  const scaledLevel = scaleVoicePipelineAudioLevel(level);
  const scaledPeak = scaleVoicePipelineAudioLevel(peak);
  const meterX = 16;
  const meterY = Math.round(height / 2) - 18;
  const meterWidth = Math.max(1, width - 32);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(0,224,255,0.12)';
  ctx.strokeRect(meterX, meterY, meterWidth, 36);
  ctx.fillStyle = 'rgba(0,224,255,0.26)';
  ctx.fillRect(meterX, meterY, Math.round(meterWidth * scaledPeak), 36);
  ctx.fillStyle = '#47f27a';
  ctx.fillRect(meterX, meterY + 7, Math.round(meterWidth * scaledLevel), 22);
  ctx.fillStyle = 'rgba(215,226,255,0.72)';
  ctx.font = '12px sans-serif';
  ctx.fillText(`level ${level.toFixed(6)}  peak ${peak.toFixed(6)}`, meterX, meterY + 58);

  updateVoicePipelineChartStatus(`Power | level ${level.toFixed(6)} | peak ${peak.toFixed(6)}`);
  logVoicePipelineChartPressure(performance.now() - startedAt);
}

function updateVoicePipelineChartStatus(text) {
  const now = performance.now();
  if (now - voicePipelineLastChartStatusAt < VOICE_PIPELINE_CHART_STATUS_MS) return;
  voicePipelineLastChartStatusAt = now;
  const status = byId('voicePipelineChartStatus');
  if (status) status.textContent = text;
}

function logVoicePipelineChartPressure(durationMs) {
  const now = performance.now();
  if (durationMs <= VOICE_PIPELINE_CHART_DRAW_WARN_MS || now - voicePipelineLastChartPressureAt < VOICE_PIPELINE_CHART_PRESSURE_LOG_MS) {
    return;
  }
  voicePipelineLastChartPressureAt = now;
  voicePipelineLog('chart draw pressure', {
    durationMs: Number(durationMs.toFixed(1)),
    mode: voicePipelineRendererMode,
    samples: voicePipelineChartSamples.length,
    thresholdMs: VOICE_PIPELINE_CHART_DRAW_WARN_MS
  });
}

function scaleVoicePipelineAudioLevel(value) {
  const clamped = Math.max(0, Math.min(1, Number(value) || 0));
  return Math.log10(1 + clamped * 80) / Math.log10(81);
}

function updateVoicePipelineMicAudioLamp(detail = {}) {
  const peak = Number(detail.peak || detail.currentPeak || 0);
  setVoicePipelineLamp('MicAudio', peak > 0 ? 'good' : 'bad', peak > 0 ? 'Mic producing audio' : 'Mic audio is 0');
}

function updateVoicePipelinePcmLamp(detail = {}) {
  const peak = Number(detail.currentPeak || detail.peak || detail.windowPeak || 0);
  if (peak > 0) {
    voicePipelinePcmSignalProblem = false;
    setVoicePipelineLamp('Pcm', 'good', 'PCM producing audio');
    return;
  }

  voicePipelinePcmSignalProblem = true;
  setVoicePipelineLamp('Pcm', 'bad', 'PCM audio is 0');
}

function handleVoicePipelineDiagnostic(detail) {
  const area = detail.area || '';
  const stalled = detail.state === 'bad' || detail.stalled || detail.pressure === true || detail.pressure === 'high';
  const socketPressure = detail.socketPressure === true
    || Number(detail.bufferedAmount || 0) > VOICE_PIPELINE_SOCKET_PRESSURE_WARN_BYTES;
  const pressure = stalled || socketPressure;
  const pressureReason = voicePipelinePressureReason(detail);
  if (['pipecat-transport', 'stt-worker', 'voice-pipeline', 'stt-recognizer', 'audio-worklet'].includes(area)) {
    const label = pressure
      ? `Back pressure ${pressureReason}`
      : 'Back pressure normal';
    setVoicePipelineLamp('Pressure', pressure ? 'bad' : 'good', label);
  }
  if (area === 'pipecat-transport') {
    setVoicePipelineLamp('Transport', pressure ? 'bad' : 'good', pressure ? `Transport ${pressureReason}` : 'Transport good');
  }
  if (area === 'voice-pipeline') {
    setVoicePipelineLamp('Vad', stalled ? 'bad' : 'good', stalled ? 'Pipeline stalled' : 'Pipeline flowing');
  }
  if (area === 'stt-recognizer') {
    setVoicePipelineLamp('Stt', stalled ? 'bad' : 'good', stalled ? 'STT stalled' : 'STT good');
  }
}

function voicePipelinePressureReason(detail = {}) {
  const buffered = Number(detail.bufferedAmount || 0);
  const gap = Number(detail.chunkGapMs || detail.maxGapMs || detail.gapMs || detail.maxInputGapMs || 0);
  const processMs = Number(detail.processMs || detail.maxProcessMs || 0);
  if (detail.socketPressure === true || buffered > VOICE_PIPELINE_SOCKET_PRESSURE_WARN_BYTES) return `${formatVoicePipelineBytes(buffered)} queued`;
  if (gap > 0) return `${Math.round(gap)} ms gap`;
  if (processMs > 0) return `${Math.round(processMs)} ms work`;
  return 'detected';
}

function formatVoicePipelineBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${Math.round(value)}B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}

function copyVoicePipelineDebug() {
  const activeCaptureMode = voicePipelineRuntime?.activeCaptureMode
    || (voicePipelineToggle('voicePipelineToggleRawMic') ? 'raw-requested' : 'browser-processed-requested');
  const track = voicePipelineLastTrackSettings || {};
  const debug = [
    `VOICE PIPELINE TEST DEBUG`,
    `TIME: ${new Date().toISOString()}`,
    `URL: ${window.location.href}`,
    `SELECTED INPUT: ${byId('voicePipelineInputDevice')?.selectedOptions?.[0]?.textContent || 'Browser default microphone'}`,
    `RAW MIC CAPTURE CHECKBOX: ${voicePipelineToggle('voicePipelineToggleRawMic') ? 'enabled' : 'disabled'}`,
    `ACTIVE CAPTURE MODE: ${activeCaptureMode}`,
    `ACTIVE TRACK: label=${track.label || ''} muted=${track.muted} readyState=${track.readyState || ''} sampleRate=${track.sampleRate || ''} echoCancellation=${track.echoCancellation} noiseSuppression=${track.noiseSuppression} autoGainControl=${track.autoGainControl}`,
    `MIC: ${byId('voicePipelineMic')?.textContent || ''}`,
    `MIC AUDIO: ${byId('voicePipelineMicAudio')?.textContent || ''}`,
    `TRANSPORT: ${byId('voicePipelineTransport')?.textContent || ''}`,
    `BACK PRESSURE: ${byId('voicePipelinePressure')?.textContent || ''}`,
    `VAD: ${byId('voicePipelineVad')?.textContent || ''}`,
    `STT: ${byId('voicePipelineStt')?.textContent || ''}`,
    `OLLAMA: ${byId('voicePipelineOllama')?.textContent || ''}`,
    `KOKORO: ${byId('voicePipelineTts')?.textContent || ''}`,
    `AUDIO OUTPUT: ${byId('voicePipelineAudio')?.textContent || ''}`,
    `CHART MODE: ${voicePipelineRendererMode}`,
    `CHART: ${byId('voicePipelineChartStatus')?.textContent || ''}`,
    '',
    'TRANSCRIPT',
    byId('voicePipelineTranscript')?.textContent || '',
    '',
    'RESPONSE',
    byId('voicePipelineResponse')?.textContent || '',
    '',
    'EVENTS',
    voicePipelineLogEntries.join('\n')
  ].join('\n');

  const button = byId('voicePipelineCopyDebug');
  const finish = ok => {
    if (button) button.textContent = ok ? 'Copied' : 'Copy Failed';
    setTimeout(() => {
      if (button) button.innerHTML = '<i data-lucide="copy"></i> Copy Debug';
      window.lucide?.createIcons?.();
    }, 1200);
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(debug).then(() => finish(true)).catch(() => finish(false));
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = debug;
  document.body.appendChild(textarea);
  textarea.select();
  try { finish(document.execCommand('copy')); } catch (err) { finish(false); }
  textarea.remove();
}
