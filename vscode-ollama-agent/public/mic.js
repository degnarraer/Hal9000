// mic.js
// Captures microphone audio, draws a fixed-size waveform, and uses Web Speech API for voice-to-text.

let audioCtx, analyser, dataArray, sourceNode, mediaStream;
let animationId;
let finalTranscriptBuffer = '';
let recognition;
let recognitionRestartTimer;
let manuallyStoppingRecognition = false;
let speechRecognitionFailed = false;
let detectedAudioWhileSpeechFailed = false;
let serverSttWorker;
let serverSttWorkerState = 'idle';
let serverSttWorkerKind = 'stt';
let serverSttWorkerAudioPort;
let serverSttWorkletAudioPort;
let serverSttProcessor;
let serverSttWorkletNode;
let serverSttSilenceGain;
let serverSttSinkDestination;
let serverSttActive = false;
let serverSttFallbackStarted = false;
let serverSttWatchdogTimer;
let serverSttPumpStats = null;
let serverSttWorkletModuleLoaded = false;
let composerDraftBeforeMic = '';
let startingMic = false;
let micStartToken = 0;
let micSettings = { transcriptionProvider: 'auto' };
let micSettingsOverride = null;
let micMainThreadStallTimer;
let micMainThreadLastTick = 0;
let micMainThreadLastReportAt = 0;
let micDeviceChangeListenerAttached = false;
let micDeviceChangeCount = 0;
let micDiagnosticOptions = defaultMicDiagnosticOptions();
const MAX_TRANSCRIPT_DISPLAY = 180;
const SERVER_STT_SAMPLE_RATE = 16000;
const SERVER_STT_PROCESSOR_SIZE = 2048;
const MIC_MAIN_THREAD_STALL_INTERVAL_MS = 250;
const MIC_MAIN_THREAD_STALL_THRESHOLD_MS = 200;
const MIC_MAIN_THREAD_STALL_REPORT_MS = 1000;
const AUDIO_WORKLET_GAP_WARN_MS = 120;
const MIC_SIGNAL_ACTIVE_PEAK = 0.004;
const MIC_SIGNAL_DROPOUT_PEAK = 0.001;
const MIC_SIGNAL_DROPOUT_MS = 2500;

const canvas = document.getElementById('waveform');
const vttOutput = document.getElementById('vttOutput');
const micToggle = document.getElementById('micToggle');
const composerInput = document.getElementById('input');
const inputSection = document.querySelector('.input-section');
const micAudioConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
};
const MIC_INPUT_DEVICE_KEY = 'bob.mic.inputDeviceId';

function emitMicEvent(type, data = {}) {
  window.dispatchEvent(new CustomEvent('bob:mic', {
    detail: { type, ...data }
  }));
}

function micRuntimeSnapshot() {
  const tracks = mediaStream?.getAudioTracks?.() || [];
  return {
    running: isMicRunning(),
    starting: startingMic,
    audioState: audioCtx?.state || 'none',
    hasStream: Boolean(mediaStream),
    trackCount: tracks.length,
    tracks: tracks.map(track => ({
      label: track.label || '',
      enabled: track.enabled,
      muted: track.muted,
      readyState: track.readyState
    })),
    sttActive: serverSttActive,
    sttWorkerState: serverSttWorkerState
  };
}

function emitMicDebug(message, data = {}) {
  const detail = { message, ...data, runtime: micRuntimeSnapshot() };
  console.debug('mic debug', detail);
  emitMicEvent('debug', detail);
}

function defaultMicDiagnosticOptions() {
  return {
    serverStt: true,
    audioWorklet: true,
    browserStt: true,
    autoSubmit: true,
    waveform: true,
    watchdog: true,
    utteranceFlush: true,
    voicePipelineVad: true,
    voicePipelineStt: true,
    voicePipelineLlm: true,
    voicePipelineTts: true,
    voicePipelineAudioOutput: true
  };
}

function normalizeMicDiagnosticOptions(options = {}) {
  const defaults = defaultMicDiagnosticOptions();
  return Object.fromEntries(
    Object.entries(defaults).map(([key, defaultValue]) => [key, options[key] === undefined ? defaultValue : Boolean(options[key])])
  );
}

function setMicDiagnosticOptions(options = {}) {
  micDiagnosticOptions = normalizeMicDiagnosticOptions(options);
  emitMicEvent('diagnostic-options', { options: micDiagnosticOptions });
}

function getMicDiagnosticOptions() {
  return { ...micDiagnosticOptions };
}

function setMicSettingsOverride(settings = null) {
  micSettingsOverride = settings && typeof settings === 'object' ? { ...settings } : null;
  emitMicEvent('settings-override', { settings: micSettingsOverride ? { ...micSettingsOverride } : null });
}

function getMicSettingsOverride() {
  return micSettingsOverride ? { ...micSettingsOverride } : null;
}

function micNow() {
  return window.performance?.now?.() || Date.now();
}

function startMicMainThreadStallDetector(reason = 'mic-running') {
  stopMicMainThreadStallDetector();
  micMainThreadLastTick = micNow();
  micMainThreadLastReportAt = 0;
  micMainThreadStallTimer = setInterval(() => {
    const now = micNow();
    const elapsedMs = now - micMainThreadLastTick;
    const blockedMs = elapsedMs - MIC_MAIN_THREAD_STALL_INTERVAL_MS;
    micMainThreadLastTick = now;
    if (blockedMs < MIC_MAIN_THREAD_STALL_THRESHOLD_MS) return;
    if (now - micMainThreadLastReportAt < MIC_MAIN_THREAD_STALL_REPORT_MS) return;

    micMainThreadLastReportAt = now;
    emitMicDebug('main thread stall detected', {
      reason,
      elapsedMs: Math.round(elapsedMs),
      blockedMs: Math.round(blockedMs),
      thresholdMs: MIC_MAIN_THREAD_STALL_THRESHOLD_MS
    });
  }, MIC_MAIN_THREAD_STALL_INTERVAL_MS);
}

function stopMicMainThreadStallDetector() {
  clearInterval(micMainThreadStallTimer);
  micMainThreadStallTimer = null;
  micMainThreadLastTick = 0;
}

function attachMicStreamDiagnostics(stream) {
  const tracks = stream?.getAudioTracks?.() || [];
  tracks.forEach((track, index) => {
    const emitTrackEvent = eventType => {
      if (micToggle?.dataset.running !== '1') return;
      const detail = micTrackDetails(stream);
      emitMicEvent('stream-track-event', {
        eventType,
        trackIndex: index,
        ...detail
      });
      if (eventType === 'mute' || eventType === 'ended') {
        emitMicEvent('diagnostic', {
          area: 'mic-track',
          pressure: true,
          state: 'bad',
          eventType,
          trackIndex: index,
          readyState: track.readyState,
          muted: track.muted
        });
      }
    };
    track.addEventListener?.('mute', () => emitTrackEvent('mute'));
    track.addEventListener?.('unmute', () => emitTrackEvent('unmute'));
    track.addEventListener?.('ended', () => emitTrackEvent('ended'));
  });
}

function attachMicAudioContextDiagnostics(context) {
  if (!context) return;
  context.onstatechange = () => {
    if (micToggle?.dataset.running !== '1') return;
    const state = context.state || 'unknown';
    emitMicEvent('audio-context-state', { state });
    if (state === 'suspended' || state === 'closed') {
      emitMicEvent('diagnostic', {
        area: 'audio-context',
        pressure: true,
        state: 'bad',
        audioState: state
      });
    }
  };
}

function attachMicDeviceChangeDiagnostics() {
  if (micDeviceChangeListenerAttached || !navigator.mediaDevices?.addEventListener) return;
  micDeviceChangeListenerAttached = true;
  navigator.mediaDevices.addEventListener('devicechange', () => {
    micDeviceChangeCount += 1;
    if (!isMicRunning()) return;
    emitMicEvent('media-device-change', {
      count: micDeviceChangeCount,
      track: micTrackDetails(mediaStream)
    });
  });
}

attachMicDeviceChangeDiagnostics();

function currentMicAudioConstraints() {
  const override = micSettingsOverride?.audioConstraints;
  if (!override || typeof override !== 'object') return { ...micAudioConstraints };
  return { ...micAudioConstraints, ...override };
}

function isLikelyIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent || '')
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function requestMicrophoneStream() {
  const inputDeviceId = selectedMicInputDeviceId();
  const baseAudioConstraints = currentMicAudioConstraints();
  const audioConstraints = inputDeviceId
    ? { ...baseAudioConstraints, deviceId: { exact: inputDeviceId } }
    : baseAudioConstraints;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints
    });
    emitMicEvent('stream', micTrackDetails(stream));
    return stream;
  } catch (err) {
    console.warn('Preferred microphone constraints failed; retrying with audio:true', err);
    emitMicEvent('stream-retry', { name: err.name, message: err.message });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    emitMicEvent('stream', micTrackDetails(stream));
    return stream;
  }
}

function selectedMicInputDeviceId() {
  try {
    return String(localStorage.getItem(MIC_INPUT_DEVICE_KEY) || '').trim();
  } catch (err) {
    return '';
  }
}

function setSelectedMicInputDeviceId(deviceId = '') {
  try {
    const value = String(deviceId || '').trim();
    if (value) localStorage.setItem(MIC_INPUT_DEVICE_KEY, value);
    else localStorage.removeItem(MIC_INPUT_DEVICE_KEY);
  } catch (err) {}
}

function isMicRunning() {
  return micToggle?.dataset.running === '1';
}

async function startMic(reason = 'internal') {
  console.log('startMic called');
  emitMicDebug('mic start requested', { reason });
  if (startingMic || micToggle?.dataset.running === '1') {
    emitMicDebug('mic start ignored', { reason, ignoredBecause: startingMic ? 'start-already-pending' : 'already-running' });
    return;
  }
  startingMic = true;
  const startToken = ++micStartToken;
  emitMicDebug('mic start accepted', { reason, startToken });
  startMicMainThreadStallDetector(reason);

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    emitMicDebug('mic start unsupported', { reason, startToken });
    await window.__dialog.alert({
      title: 'Microphone Unsupported',
      message: 'getUserMedia is not supported in this browser.'
    });
    startingMic = false;
    stopMicMainThreadStallDetector();
    return;
  }

  try {
    finalTranscriptBuffer = '';
    speechRecognitionFailed = false;
    detectedAudioWhileSpeechFailed = false;
    emitMicEvent('starting');
    setMicButtonState(true);
    setMicTranscript('Starting microphone...');

    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    attachMicAudioContextDiagnostics(audioCtx);
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    mediaStream = await requestMicrophoneStream();
    attachMicStreamDiagnostics(mediaStream);

    if (startToken !== micStartToken) {
      emitMicDebug('mic start abandoned', { reason, startToken, activeToken: micStartToken });
      mediaStream.getTracks().forEach(t => t.stop());
      return;
    }

    logAppliedMicSettings(mediaStream);
    setMicTranscript('Listening...');

    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    sourceNode = audioCtx.createMediaStreamSource(mediaStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    const bufferLength = analyser.fftSize; // use full fftSize for time-domain
    dataArray = new Uint8Array(bufferLength);
    sourceNode.connect(analyser);

    console.log('audio started, bufferLength=', bufferLength);
    emitMicEvent('listening', { sampleRate: audioCtx.sampleRate });
    if (micDiagnosticOptions.waveform) drawWaveform();
    else emitMicEvent('subsystem-disabled', { subsystem: 'waveform' });
    micSettings = await loadMicSettings();
    startConfiguredTranscription();
    emitMicDebug('mic start complete', { reason, startToken });
  } catch (e) {
    emitMicDebug('mic start failed', { reason, startToken, name: e.name, error: e.message });
    stopMic('start-failure');
    const message = micStartErrorMessage(e);
    emitMicEvent('error', { name: e.name, message: e.message, display: message });
    setMicTranscript(message);
    if (composerInput) composerInput.placeholder = message;
    throw e;
  } finally {
    startingMic = false;
  }
}

function micStartErrorMessage(error = {}) {
  const name = error.name || error.code || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Microphone permission was denied. Enable microphone access for this site in Safari settings.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone was found for this browser.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The microphone is busy or unavailable. Close other apps or tabs using it, then try again.';
  }
  if (name === 'OverconstrainedError') {
    return 'The microphone did not support the requested settings.';
  }
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    return 'Microphone access requires HTTPS on mobile browsers.';
  }
  return 'Microphone could not start on this browser.';
}

function stopMic(reason = 'internal') {
  console.log('stopMic called');
  emitMicDebug('mic stop requested', { reason });
  stopMicMainThreadStallDetector();
  micStartToken += 1;
  startingMic = false;
  setMicButtonState(false);
  mediaStream && mediaStream.getTracks().forEach(t => t.stop());
  animationId && cancelAnimationFrame(animationId);
  animationId = null;
  audioCtx && audioCtx.close().catch(err => console.warn('AudioContext close failed', err));
  mediaStream = null;
  audioCtx = null;
  sourceNode = null;
  analyser = null;
  dataArray = null;
  finalTranscriptBuffer = '';
  speechRecognitionFailed = false;
  detectedAudioWhileSpeechFailed = false;
  stopServerStt();
  stopSpeechRecognition();
  setMicTranscript('');
  emitMicEvent('stopped');
  emitMicDebug('mic stop complete', { reason });
}

async function startMicFromUserButton() {
  window.__chat?.unlockAudio?.();
  await startMic('gui-button');
}

function stopMicFromUserButton() {
  stopMic('gui-button');
}

function renderIcons() {
  window.__icons?.render?.();
}

function setMicButtonState(isRunning) {
  if (!micToggle) return;

  if (isRunning) {
    composerDraftBeforeMic = composerInput?.value || '';
    setComposerMicMode(true);
  } else {
    setComposerMicMode(false);
  }

  micToggle.dataset.running = isRunning ? '1' : '0';
  micToggle.innerHTML = `<i data-lucide="${isRunning ? 'square' : 'mic'}"></i>`;
  micToggle.setAttribute('aria-label', isRunning ? 'Stop voice input' : 'Start voice input');
  micToggle.setAttribute('title', isRunning ? 'Stop voice input' : 'Start voice input');
  micToggle.classList.toggle('active', isRunning);
  renderIcons();
}

function setComposerMicMode(isRunning) {
  if (!composerInput) return;

  composerInput.readOnly = isRunning;
  composerInput.classList.toggle('mic-live', isRunning);
  inputSection?.classList.toggle('mic-active', isRunning);
  composerInput.placeholder = isRunning ? 'Listening...' : 'Ask Bob';
  if (isRunning) window.__bob?.listen?.();
  else window.__bob?.idle?.();

  if (isRunning) {
    composerInput.value = '';
    return;
  }

  composerInput.value = composerDraftBeforeMic;
  composerDraftBeforeMic = '';
}

function logAppliedMicSettings(stream) {
  const [track] = stream.getAudioTracks();
  if (!track?.getSettings) return;

  const settings = track.getSettings();
  console.log('mic audio settings', {
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    deviceId: settings.deviceId ? 'set' : 'unset'
  });
  emitMicEvent('track-settings', micTrackDetails(stream));
}

function micTrackDetails(stream) {
  const [track] = stream?.getAudioTracks?.() || [];
  const settings = typeof track?.getSettings === 'function' ? track.getSettings() : {};
  return {
    label: track?.label || '',
    enabled: track?.enabled,
    muted: track?.muted,
    readyState: track?.readyState,
    deviceId: settings.deviceId ? 'set' : 'unset',
    sampleRate: settings.sampleRate || null,
    channelCount: settings.channelCount || null,
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl
  };
}

function drawWaveform() {
  if (!analyser || !canvas) return;
  if (audioCtx?.state === 'suspended') {
    audioCtx.resume().catch(err => console.warn('AudioContext resume failed', err));
  }

  analyser.getByteTimeDomainData(dataArray);
  const averageLevel = renderMicWaveform(canvas, dataArray);

  if (speechRecognitionFailed && averageLevel > 4 && !detectedAudioWhileSpeechFailed) {
    detectedAudioWhileSpeechFailed = true;
    setMicTranscript('Mic audio detected. Browser speech recognition service is unavailable.');
  }

  animationId = requestAnimationFrame(drawWaveform);
}

function renderMicWaveform(targetCanvas, samples = dataArray) {
  if (!targetCanvas || !samples?.length) return 0;

  const rect = targetCanvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * ratio));
  const height = Math.max(1, Math.floor(rect.height * ratio));
  if (targetCanvas.width !== width || targetCanvas.height !== height) {
    targetCanvas.width = width;
    targetCanvas.height = height;
  }

  const ctx = targetCanvas.getContext('2d');
  if (!ctx) return 0;

  ctx.clearRect(0, 0, width, height);
  ctx.beginPath();
  ctx.lineWidth = 2 * ratio;
  ctx.strokeStyle = '#00e0ff';

  const step = Math.max(1, Math.floor(samples.length / width));
  let x = 0;
  let level = 0;
  for (let i = 0; i < samples.length; i += step) {
    level += Math.abs(samples[i] - 128);
    const y = (samples[i] / 255) * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    x += 1;
  }
  ctx.stroke();

  return level / Math.max(1, x);
}

function renderWaveformToCanvas(targetCanvas) {
  if (!analyser || !dataArray || !targetCanvas) return 0;
  analyser.getByteTimeDomainData(dataArray);
  return renderMicWaveform(targetCanvas, dataArray);
}

function getMicAudioLevelSnapshot() {
  if (!analyser || !dataArray) {
    return {
      running: isMicRunning(),
      level: 0,
      peak: 0,
      sampleRate: audioCtx?.sampleRate || null
    };
  }

  analyser.getByteTimeDomainData(dataArray);
  let sum = 0;
  let peak = 0;
  for (let index = 0; index < dataArray.length; index += 1) {
    const value = Math.abs((dataArray[index] || 128) - 128) / 128;
    sum += value;
    if (value > peak) peak = value;
  }

  return {
    running: isMicRunning(),
    level: sum / Math.max(1, dataArray.length),
    peak,
    sampleRate: audioCtx?.sampleRate || null
  };
}

async function loadMicSettings() {
  if (micSettingsOverride) {
    return {
      transcriptionProvider: normalizeMicProvider(micSettingsOverride.transcriptionProvider),
      stt: micSettingsOverride.stt || null
    };
  }

  try {
    const response = await fetch('/api/mic/settings', { cache: 'no-store' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Mic settings unavailable');
    return {
      transcriptionProvider: normalizeMicProvider(json.data?.transcriptionProvider),
      stt: json.data?.stt || null
    };
  } catch (err) {
    console.warn('Mic settings unavailable; using auto transcription', err);
    return { transcriptionProvider: 'auto', stt: null };
  }
}

function normalizeMicProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  return ['pipeline', 'auto', 'server', 'browser'].includes(provider) ? provider : 'pipeline';
}

function startConfiguredTranscription() {
  const provider = normalizeMicProvider(micSettings.transcriptionProvider);
  if (provider === 'browser') {
    if (micDiagnosticOptions.browserStt) startSpeechRecognition();
    else {
      emitMicEvent('subsystem-disabled', { subsystem: 'browser-stt' });
      setMicTranscript('Mic is active. Browser STT is disabled for this test.');
    }
    return;
  }
  if (!micDiagnosticOptions.serverStt) {
    emitMicEvent('subsystem-disabled', { subsystem: 'server-stt' });
    if (provider === 'auto' && micDiagnosticOptions.browserStt) startSpeechRecognition();
    else setMicTranscript('Mic is active. Server STT is disabled for this test.');
    return;
  }
  startServerStt(provider);
}

async function startServerStt(provider = normalizeMicProvider(micSettings.transcriptionProvider)) {
  stopServerStt();
  serverSttFallbackStarted = false;

  if (!window.Worker || !audioCtx || !sourceNode) {
    if (provider === 'server') setMicTranscript('Server speech recognition is unavailable in this browser.');
    else maybeFallbackToBrowserSpeechRecognition('Server speech recognition is unavailable in this browser.');
    return;
  }

  try {
    serverSttWorkerState = 'connecting';
    serverSttWorkerKind = provider === 'pipeline' ? 'pipeline' : 'stt';
    const workerPath = serverSttWorkerKind === 'pipeline'
      ? '/audio/pipecat-transport-worker.js'
      : '/audio/stt-worker.js';
    serverSttWorker = new Worker(workerPath);
    serverSttWorker.onmessage = event => handleServerSttWorkerMessage(event.data || {}, provider);
    serverSttWorker.onerror = event => {
      serverSttWorkerState = 'error';
      emitMicEvent('server-error', { message: event.message || 'Server speech worker failed.' });
      maybeFallbackToBrowserSpeechRecognition('Server speech worker failed.');
    };
    startServerSttWorkerAudioPort();
    serverSttWorker.postMessage({
      type: 'connect',
      inputSampleRate: audioCtx.sampleRate,
      outputSampleRate: SERVER_STT_SAMPLE_RATE,
      pipelineOptions: {
        vad: micDiagnosticOptions.voicePipelineVad,
        stt: micDiagnosticOptions.voicePipelineStt,
        llm: micDiagnosticOptions.voicePipelineLlm,
        tts: micDiagnosticOptions.voicePipelineTts
      }
    });
  } catch (err) {
    console.warn('Server STT connection failed', err);
    if (provider === 'server') setMicTranscript('Server speech recognition unavailable.');
    else maybeFallbackToBrowserSpeechRecognition('Server speech recognition unavailable.');
  }
}

function startServerSttWorkerAudioPort() {
  closeServerSttWorkerAudioPort();
  const channel = new MessageChannel();
  serverSttWorkerAudioPort = channel.port1;
  serverSttWorkletAudioPort = channel.port2;
  serverSttWorker.postMessage({ type: 'audio-port' }, [serverSttWorkerAudioPort]);
}

function closeServerSttWorkerAudioPort() {
  if (serverSttWorkerAudioPort) {
    try { serverSttWorkerAudioPort.close(); } catch (err) {}
    serverSttWorkerAudioPort = null;
  }
  if (serverSttWorkletAudioPort) {
    try { serverSttWorkletAudioPort.close(); } catch (err) {}
    serverSttWorkletAudioPort = null;
  }
}

function handleServerSttWorkerMessage(message, provider) {
  if (message.type === 'server-open') {
    serverSttWorkerState = 'open';
    emitMicEvent('server-open', { provider, workerKind: serverSttWorkerKind });
    setMicTranscript('Listening...');
    return;
  }
  if (message.type === 'server-message') {
    handleServerSttMessage(message.message || {});
    return;
  }
  if (message.type === 'server-error') {
    serverSttWorkerState = 'error';
    emitMicEvent('server-error', { message: message.error || 'Server speech recognition connection failed.' });
    maybeFallbackToBrowserSpeechRecognition(message.error || 'Server speech recognition connection failed.');
    return;
  }
  if (message.type === 'server-close') {
    serverSttWorkerState = 'closed';
    emitMicEvent('server-close', { code: message.code, reason: message.reason });
    serverSttActive = false;
    cleanupServerSttAudioNodes();
    if (!serverSttFallbackStarted && micToggle?.dataset.running === '1' && message.code !== 1000) {
      if (provider === 'server') setMicTranscript('Server speech recognition unavailable.');
      else maybeFallbackToBrowserSpeechRecognition('Server speech recognition unavailable.');
    }
    return;
  }
  if (message.type === 'worker-audio-port-ready') {
    emitMicEvent('audio-worker-ready');
    return;
  }
  if (message.type === 'diagnostic') {
    emitMicEvent('diagnostic', message);
  }
}

function handleServerSttMessage(raw) {
  const message = typeof raw === 'object' && raw ? raw : parseServerSttMessage(raw);
  if (message.type === 'diagnostic') {
    emitMicEvent('diagnostic', message);
    return;
  }
  if (message.type === 'ready') {
    serverSttActive = true;
    emitMicEvent('server-ready', message);
    setMicTranscript('Listening...');
    startServerSttAudioPump();
    return;
  }
  if (message.type === 'stage-options') {
    emitMicEvent('stage-options', message);
    return;
  }
  if (message.type === 'stage-skipped') {
    emitMicEvent('stage-skipped', message);
    return;
  }
  if (message.type === 'vad-start') {
    emitMicEvent('vad-start', message);
    setMicTranscript('Listening...');
    return;
  }
  if (message.type === 'vad-end') {
    emitMicEvent('vad-end', message);
    setMicTranscript('Thinking...');
    return;
  }
  if (message.type === 'stt-start') {
    emitMicEvent('stt-start', message);
    setMicTranscript('Transcribing...');
    return;
  }
  if (message.type === 'stt-complete') {
    emitMicEvent('stt-complete', message);
    return;
  }
  if (message.type === 'transcript') {
    const text = String(message.text || '').trim();
    emitMicEvent(message.final ? 'final' : 'partial', { text, provider: 'pipeline', pipeline: true });
    if (text) setMicTranscript(text);
    return;
  }
  if (message.type === 'assistant-text') {
    emitMicEvent('assistant-text', { text: message.text || '', metadata: message.metadata || {} });
    setMicTranscript('Speaking...');
    return;
  }
  if (message.type === 'audio') {
    emitMicEvent('audio-output', { provider: message.provider, contentType: message.contentType, text: message.text || '' });
    if (!micDiagnosticOptions.voicePipelineAudioOutput) {
      emitMicEvent('subsystem-disabled', { subsystem: 'voice-pipeline-audio-output' });
      setMicTranscript('Listening...');
      return;
    }
    playVoicePipelineAudio(message);
    return;
  }
  if (message.type === 'turn-complete') {
    emitMicEvent('turn-complete', message);
    setMicTranscript('Listening...');
    return;
  }
  if (message.type === 'turn-empty') {
    emitMicEvent('turn-empty', message);
    setMicTranscript('Listening...');
    return;
  }
  if (message.type === 'partial') {
    emitMicEvent('partial', { text: message.text || '', provider: 'server' });
    setMicTranscript(message.text || '');
    return;
  }
  if (message.type === 'final') {
    const text = String(message.text || '').trim();
    emitMicEvent('final', { text, provider: 'server' });
    if (text) submitVoicePrompt(text);
    setMicTranscript('Listening...');
    return;
  }
  if (message.type === 'unavailable' || message.type === 'error') {
    const provider = normalizeMicProvider(micSettings.transcriptionProvider);
    if (provider === 'server') {
      emitMicEvent('server-unavailable', message);
      setMicTranscript(message.error || 'Server speech recognition unavailable.');
      return;
    }
    maybeFallbackToBrowserSpeechRecognition(message.error || 'Server speech recognition unavailable.');
  }
}

function playVoicePipelineAudio(message = {}) {
  const base64 = String(message.audioBase64 || '');
  if (!base64) return;
  const chatPlayback = window.__chat?.playAudioDataUrl?.({
    audioBase64: base64,
    contentType: message.contentType || 'audio/wav',
    text: message.text || ''
  });
  if (typeof chatPlayback?.then === 'function') {
    emitMicEvent('voice-pipeline-audio-playback', { state: 'start', path: 'chat' });
    chatPlayback
      .then(() => emitMicEvent('voice-pipeline-audio-playback', { state: 'end', path: 'chat' }))
      .catch(err => {
        emitMicEvent('voice-pipeline-audio-playback', { state: 'error', path: 'chat', message: err.message || 'Audio playback failed' });
        emitMicEvent('audio-output-error', { message: err.message || 'Audio playback failed' });
        playVoicePipelineAudioFallback(message);
      });
    return;
  }
  if (chatPlayback) {
    emitMicEvent('voice-pipeline-audio-playback', { state: 'start', path: 'chat' });
    emitMicEvent('voice-pipeline-audio-playback', { state: 'end', path: 'chat' });
    return;
  }
  playVoicePipelineAudioFallback(message);
}

function playVoicePipelineAudioFallback(message = {}) {
  const base64 = String(message.audioBase64 || '');
  if (!base64) return;
  try {
    const audio = new Audio(`data:${message.contentType || 'audio/wav'};base64,${base64}`);
    audio.playbackRate = window.__chat?.playbackRate || 1;
    emitMicEvent('voice-pipeline-audio-playback', { state: 'start', path: 'fallback' });
    audio.addEventListener?.('ended', () => emitMicEvent('voice-pipeline-audio-playback', { state: 'end', path: 'fallback' }), { once: true });
    audio.addEventListener?.('error', () => emitMicEvent('voice-pipeline-audio-playback', { state: 'error', path: 'fallback', message: 'Audio playback failed' }), { once: true });
    audio.play().catch(err => {
      emitMicEvent('voice-pipeline-audio-playback', { state: 'error', path: 'fallback', message: err.message || 'Audio playback failed' });
      emitMicEvent('audio-output-error', { message: err.message || 'Audio playback failed' });
    });
  } catch (err) {
    emitMicEvent('voice-pipeline-audio-playback', { state: 'error', path: 'fallback', message: err.message || 'Audio playback failed' });
    emitMicEvent('audio-output-error', { message: err.message || 'Audio playback failed' });
  }
}

function parseServerSttMessage(raw) {
  try {
    return JSON.parse(String(raw || '{}'));
  } catch (err) {
    return {};
  }
}

async function startServerSttAudioPump() {
  if (!serverSttWorker || !serverSttActive || !audioCtx || !sourceNode) return;
  cleanupServerSttAudioNodes();

  resetServerSttPumpStats();

  if (micDiagnosticOptions.audioWorklet && audioCtx.audioWorklet && window.AudioWorkletNode) {
    try {
      if (!serverSttWorkletModuleLoaded) {
        await audioCtx.audioWorklet.addModule('/audio/stt-capture-worklet.js');
        serverSttWorkletModuleLoaded = true;
      }
      if (!serverSttActive || !serverSttWorker || !sourceNode) return;
      startServerSttAudioWorkletPump();
      return;
    } catch (err) {
      console.warn('AudioWorklet STT pump failed; falling back to ScriptProcessor', err);
      emitMicEvent('audio-worklet-fallback', { message: err.message || 'AudioWorklet unavailable' });
      cleanupServerSttAudioNodes();
      resetServerSttPumpStats();
    }
  } else if (!micDiagnosticOptions.audioWorklet) {
    emitMicEvent('subsystem-disabled', { subsystem: 'audio-worklet' });
  }

  startServerSttScriptProcessorPump();
}

function resetServerSttPumpStats() {
  serverSttPumpStats = {
    chunks: 0,
    pumpStartedAt: Date.now(),
    firstChunkDelayMs: null,
    lastChunkAt: 0,
    lastChunkGapMs: 0,
    maxChunkGapMs: 0,
    lastWatchdogLogAt: 0,
    lastLogAt: 0,
    lastAudioAt: 0,
    lastSpeechAt: 0,
    lastFlushAt: 0,
    speechActive: false,
    heardInput: false,
    silentSince: Date.now(),
    silentLogged: false,
    level: 0,
    peak: 0,
    windowChunks: 0,
    windowLevelTotal: 0,
    windowPeak: 0,
    lastStrongAudioAt: 0,
    signalDropoutActive: false
  };
}

function startServerSttAudioWorkletPump() {
  serverSttWorkletNode = new AudioWorkletNode(audioCtx, 'bob-stt-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1]
  });
  serverSttWorkletNode.port.onmessage = event => {
    if (!serverSttActive || !serverSttWorker) return;
    handleServerSttWorkletMessage(event.data);
  };
  if (serverSttWorkletAudioPort) {
    serverSttWorkletNode.port.postMessage({ type: 'worker-port' }, [serverSttWorkletAudioPort]);
    serverSttWorkletAudioPort = null;
  }
  sourceNode.connect(serverSttWorkletNode);
  connectServerSttPumpSink(serverSttWorkletNode);
  emitMicEvent('audio-pump-mode', { mode: 'audio-worklet' });
  if (micDiagnosticOptions.watchdog) startServerSttWatchdog();
  else emitMicEvent('subsystem-disabled', { subsystem: 'watchdog' });
}

function handleServerSttWorkletMessage(message) {
  if (message?.type === 'metrics') {
    const gapMs = Number(message.gapMs || 0);
    const expectedGapMs = Number(message.expectedGapMs || 0);
    if (gapMs > AUDIO_WORKLET_GAP_WARN_MS) {
      emitMicEvent('diagnostic', {
        area: 'audio-worklet',
        pressure: true,
        gapMs: Number(gapMs.toFixed(1)),
        expectedGapMs: Number(expectedGapMs.toFixed(1)),
        sequence: message.sequence || 0
      });
    }
    handleServerSttChunkMetrics({ average: message.level || 0, peak: message.peak || 0 });
    return;
  }
  if (message?.type === 'chunk') {
    handleServerSttInputChunk(message.input);
  }
}

function startServerSttScriptProcessorPump() {
  serverSttProcessor = audioCtx.createScriptProcessor(SERVER_STT_PROCESSOR_SIZE, 1, 1);
  serverSttProcessor.onaudioprocess = event => {
    if (!serverSttActive || !serverSttWorker) return;
    handleServerSttInputChunk(event.inputBuffer.getChannelData(0));
  };
  sourceNode.connect(serverSttProcessor);
  connectServerSttPumpSink(serverSttProcessor);
  emitMicEvent('audio-pump-mode', { mode: 'script-processor' });
  if (micDiagnosticOptions.watchdog) startServerSttWatchdog();
  else emitMicEvent('subsystem-disabled', { subsystem: 'watchdog' });
}

function connectServerSttPumpSink(node) {
  serverSttSilenceGain = audioCtx.createGain();
  serverSttSilenceGain.gain.value = 0;
  node.connect(serverSttSilenceGain);

  if (typeof audioCtx.createMediaStreamDestination === 'function') {
    serverSttSinkDestination = audioCtx.createMediaStreamDestination();
    serverSttSilenceGain.connect(serverSttSinkDestination);
    emitMicEvent('audio-pump-sink', { sink: 'media-stream-destination' });
    return;
  }

  serverSttSilenceGain.connect(audioCtx.destination);
  emitMicEvent('audio-pump-sink', { sink: 'audio-context-destination' });
}

function handleServerSttInputChunk(input) {
  if (!input?.length || !serverSttPumpStats || !serverSttWorker) return;

  const levels = micInputLevels(input);
  handleServerSttChunkMetrics(levels);
  const chunk = new Float32Array(input);
  serverSttWorker.postMessage({
    type: 'chunk',
    input: chunk,
    inputSampleRate: audioCtx.sampleRate,
    outputSampleRate: SERVER_STT_SAMPLE_RATE
  }, [chunk.buffer]);
}

function handleServerSttChunkMetrics(levels) {
  if (!serverSttPumpStats || !serverSttWorker) return;

  const now = Date.now();
  const previousChunkAt = serverSttPumpStats.lastChunkAt;
  const chunkGapMs = previousChunkAt ? now - previousChunkAt : 0;
  if (!previousChunkAt) {
    serverSttPumpStats.firstChunkDelayMs = now - (serverSttPumpStats.pumpStartedAt || now);
  }
  serverSttPumpStats.chunks += 1;
  serverSttPumpStats.lastChunkAt = now;
  serverSttPumpStats.lastChunkGapMs = chunkGapMs;
  if (previousChunkAt) {
    serverSttPumpStats.maxChunkGapMs = Math.max(serverSttPumpStats.maxChunkGapMs, chunkGapMs);
  }
  serverSttPumpStats.level = levels.average;
  serverSttPumpStats.peak = levels.peak;
  serverSttPumpStats.windowChunks += 1;
  serverSttPumpStats.windowLevelTotal += levels.average;
  serverSttPumpStats.windowPeak = Math.max(serverSttPumpStats.windowPeak, levels.peak);
  if (levels.peak > 0.0001) serverSttPumpStats.lastAudioAt = now;
  trackMicSignalContinuity(levels, now);
  emitMicPumpSample(levels);
  maybeEmitMicPumpStats();
  maybeFlushServerSttUtterance(levels.peak);
  maybeReportSilentServerSttInput(levels);
}

function trackMicSignalContinuity(levels, now = Date.now()) {
  if (!serverSttPumpStats) return;

  const peak = Number(levels.peak || 0);
  const strongSignal = peak >= MIC_SIGNAL_ACTIVE_PEAK;
  if (strongSignal) {
    const wasDropped = serverSttPumpStats.signalDropoutActive;
    serverSttPumpStats.lastStrongAudioAt = now;
    serverSttPumpStats.signalDropoutActive = false;
    if (wasDropped) {
      emitMicEvent('mic-signal-recovered', {
        peak: Number(peak.toFixed(6)),
        threshold: MIC_SIGNAL_ACTIVE_PEAK
      });
    }
    return;
  }

  const lastStrongAudioAt = serverSttPumpStats.lastStrongAudioAt;
  if (!lastStrongAudioAt || peak > MIC_SIGNAL_DROPOUT_PEAK) return;

  const silentMs = now - lastStrongAudioAt;
  if (silentMs < MIC_SIGNAL_DROPOUT_MS || serverSttPumpStats.signalDropoutActive) return;

  serverSttPumpStats.signalDropoutActive = true;
  emitMicEvent('mic-signal-dropout', {
    silentMs,
    peak: Number(peak.toFixed(6)),
    level: Number((levels.average || 0).toFixed(6)),
    activePeakThreshold: MIC_SIGNAL_ACTIVE_PEAK,
    dropoutPeakThreshold: MIC_SIGNAL_DROPOUT_PEAK
  });
  emitMicEvent('diagnostic', {
    area: 'mic-signal',
    pressure: true,
    state: 'bad',
    silentMs,
    peak: Number(peak.toFixed(6))
  });
}

function maybeReportSilentServerSttInput(levels) {
  if (!serverSttPumpStats) return;

  const now = Date.now();
  if (levels.peak > 0.00001) {
    serverSttPumpStats.heardInput = true;
    serverSttPumpStats.silentSince = now;
    serverSttPumpStats.silentLogged = false;
    return;
  }

  if (!serverSttPumpStats.heardInput || serverSttPumpStats.silentLogged) return;

  const silentMs = now - serverSttPumpStats.silentSince;
  if (silentMs <= 3000) return;

  serverSttPumpStats.silentLogged = true;
  emitMicEvent('silent-input', {
    silentMs,
    chunks: serverSttPumpStats.chunks,
    hint: 'The microphone track is live but delivering digital silence.'
  });
}

function emitMicPumpSample(levels) {
  if (!serverSttPumpStats) return;
  const now = Date.now();
  const recentAudioMs = serverSttPumpStats.lastAudioAt ? now - serverSttPumpStats.lastAudioAt : null;
  emitMicEvent('audio-pump', {
    chunks: serverSttPumpStats.chunks,
    level: Number((levels.average || 0).toFixed(6)),
    peak: Number((levels.peak || 0).toFixed(6)),
    currentPeak: Number(serverSttPumpStats.peak.toFixed(6)),
    chunkGapMs: serverSttPumpStats.lastChunkGapMs,
    maxChunkGapMs: serverSttPumpStats.maxChunkGapMs,
    firstChunkDelayMs: serverSttPumpStats.firstChunkDelayMs,
    expectedChunkMs: Math.round((SERVER_STT_PROCESSOR_SIZE / (audioCtx?.sampleRate || 48000)) * 1000),
    recentAudio: recentAudioMs !== null && recentAudioMs < 4000,
    recentAudioMs,
    sampleRate: audioCtx?.sampleRate || null
  });
}

function maybeFlushServerSttUtterance(peak) {
  if (!serverSttPumpStats || !serverSttWorker) return;
  if (!micDiagnosticOptions.utteranceFlush) return;

  const now = Date.now();
  if (peak > 0.004) {
    serverSttPumpStats.speechActive = true;
    serverSttPumpStats.lastSpeechAt = now;
    return;
  }

  if (!serverSttPumpStats.speechActive) return;
  if (now - serverSttPumpStats.lastSpeechAt < 900) return;
  if (now - serverSttPumpStats.lastFlushAt < 1500) return;

  serverSttPumpStats.speechActive = false;
  serverSttPumpStats.lastFlushAt = now;
  emitMicEvent('flush', { reason: 'speech-silence', silenceMs: now - serverSttPumpStats.lastSpeechAt });
  serverSttWorker.postMessage({ type: 'flush' });
}

function maybeEmitMicPumpStats() {
  const now = Date.now();
  if (!serverSttPumpStats || now - serverSttPumpStats.lastLogAt < 1000) return;
  const windowChunks = Math.max(1, serverSttPumpStats.windowChunks);
  const level = serverSttPumpStats.windowLevelTotal / windowChunks;
  const peak = serverSttPumpStats.windowPeak;
  const recentAudioMs = serverSttPumpStats.lastAudioAt ? now - serverSttPumpStats.lastAudioAt : null;
  serverSttPumpStats.lastLogAt = now;
  emitMicEvent('audio-pump-summary', {
    chunks: serverSttPumpStats.chunks,
    windowChunks: serverSttPumpStats.windowChunks,
    level: Number(level.toFixed(6)),
    peak: Number(peak.toFixed(6)),
    currentPeak: Number(serverSttPumpStats.peak.toFixed(6)),
    chunkGapMs: serverSttPumpStats.lastChunkGapMs,
    maxChunkGapMs: serverSttPumpStats.maxChunkGapMs,
    firstChunkDelayMs: serverSttPumpStats.firstChunkDelayMs,
    expectedChunkMs: Math.round((SERVER_STT_PROCESSOR_SIZE / (audioCtx?.sampleRate || 48000)) * 1000),
    recentAudio: recentAudioMs !== null && recentAudioMs < 4000,
    recentAudioMs,
    sampleRate: audioCtx?.sampleRate || null
  });
  serverSttPumpStats.windowChunks = 0;
  serverSttPumpStats.windowLevelTotal = 0;
  serverSttPumpStats.windowPeak = 0;
}

function micInputLevels(input) {
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

function startServerSttWatchdog() {
  clearInterval(serverSttWatchdogTimer);
  serverSttWatchdogTimer = setInterval(() => {
    if (!serverSttActive || micToggle?.dataset.running !== '1') return;
    if (!serverSttWorker) return;

    if (audioCtx?.state === 'suspended') {
      audioCtx.resume().catch(err => console.warn('Server STT AudioContext resume failed', err));
    }

    const stats = serverSttPumpStats;
  const elapsed = Date.now() - (stats?.lastChunkAt || stats?.pumpStartedAt || 0);
    if (elapsed <= 2500) return;

    const now = Date.now();
    if (!stats || now - stats.lastWatchdogLogAt > 2500) {
      if (stats) stats.lastWatchdogLogAt = now;
      console.warn('Server STT audio pump stalled; rebuilding processor', {
        elapsedMs: elapsed,
        chunks: stats?.chunks || 0,
        audioState: audioCtx?.state || 'unknown'
      });
    }

    startServerSttAudioPump();
  }, 1000);
}

function cleanupServerSttAudioNodes() {
  clearInterval(serverSttWatchdogTimer);
  serverSttWatchdogTimer = null;
  if (serverSttWorkletNode) {
    try { serverSttWorkletNode.port.onmessage = null; } catch (err) {}
    try { serverSttWorkletNode.disconnect(); } catch (err) {}
    serverSttWorkletNode = null;
  }
  if (serverSttProcessor) {
    try { serverSttProcessor.disconnect(); } catch (err) {}
    serverSttProcessor.onaudioprocess = null;
    serverSttProcessor = null;
  }
  if (serverSttSilenceGain) {
    try { serverSttSilenceGain.disconnect(); } catch (err) {}
    serverSttSilenceGain = null;
  }
  if (serverSttSinkDestination) {
    try { serverSttSinkDestination.disconnect(); } catch (err) {}
    try { serverSttSinkDestination.stream?.getTracks?.().forEach(track => track.stop()); } catch (err) {}
    serverSttSinkDestination = null;
  }
  serverSttPumpStats = null;
}

function stopServerStt() {
  serverSttActive = false;
  cleanupServerSttAudioNodes();
  closeServerSttWorkerAudioPort();
  if (serverSttWorker) {
    try { serverSttWorker.postMessage({ type: 'stop' }); } catch (err) {}
    try { serverSttWorker.terminate(); } catch (err) {}
    serverSttWorker = null;
  }
  serverSttWorkerState = 'idle';
  serverSttWorkerKind = 'stt';
}

function fallbackToBrowserSpeechRecognition(reason) {
  if (serverSttFallbackStarted || micToggle?.dataset.running !== '1') return;
  serverSttFallbackStarted = true;
  serverSttActive = false;
  cleanupServerSttAudioNodes();
  console.warn(reason);
  emitMicEvent('fallback-browser', { reason });
  setMicTranscript(reason);
  startSpeechRecognition();
}

function maybeFallbackToBrowserSpeechRecognition(reason) {
  if (micDiagnosticOptions.browserStt) {
    fallbackToBrowserSpeechRecognition(reason);
    return;
  }
  emitMicEvent('subsystem-disabled', { subsystem: 'browser-stt', reason });
  setMicTranscript(reason);
}

function startSpeechRecognition() {
  if (!micDiagnosticOptions.browserStt) {
    emitMicEvent('subsystem-disabled', { subsystem: 'browser-stt' });
    setMicTranscript('Mic is active. Browser STT is disabled for this test.');
    return;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    speechRecognitionFailed = true;
    setMicTranscript('Mic is active. Browser speech recognition is not supported here.');
    return;
  }
  clearTimeout(recognitionRestartTimer);
  manuallyStoppingRecognition = false;
  if (recognition) {
    try { recognition.abort(); } catch (e) { console.warn('Speech recognition abort failed', e); }
  }
  recognition = new SpeechRecognition();
  recognition.continuous = !isLikelyIOS();
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    let interim = '';
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += transcript;
      else interim += transcript;
    }
    if (final.trim()) {
      finalTranscriptBuffer = (finalTranscriptBuffer + ' ' + final).trim();
      emitMicEvent('final', { text: finalTranscriptBuffer, provider: 'browser' });
      if (micDiagnosticOptions.autoSubmit) submitVoicePrompt(finalTranscriptBuffer);
      finalTranscriptBuffer = '';
    }

    if (interim.trim()) emitMicEvent('partial', { text: interim.trim(), provider: 'browser' });
    setMicTranscript([final, interim].filter(Boolean).join(' ').trim());
  };
  recognition.onerror = (e) => {
    if (e.error === 'no-speech') {
      setMicTranscript('Listening...');
      return;
    }

    if (e.error === 'network' || e.error === 'service-not-allowed') {
      speechRecognitionFailed = true;
      setMicTranscript('Mic is active. Browser speech recognition is unavailable on this device.');
      console.warn('Speech recognition service unavailable', e);
      return;
    }

    if (e.error === 'not-allowed') {
      speechRecognitionFailed = true;
      setMicTranscript('Mic is active. Speech recognition permission was blocked by the browser.');
      console.warn('Speech recognition permission blocked', e);
      return;
    }

    const recoverable = ['aborted', 'audio-capture'].includes(e.error);
    const message = e.message || e.error || 'Speech recognition failed';
    if (recoverable) {
      console.warn('Speech recognition warning', e);
      setMicTranscript('Listening...');
    } else {
      console.error('Speech recognition error', e);
      setMicTranscript(`Mic is active. Speech recognition unavailable: ${message}`);
    }
  };
  recognition.onend = () => {
    queueSpeechRecognitionRestart();
  };
  try {
    recognition.start();
  } catch (e) {
    console.warn('Speech recognition start failed', e);
    queueSpeechRecognitionRestart();
  }
}

function stopSpeechRecognition() {
  manuallyStoppingRecognition = true;
  clearTimeout(recognitionRestartTimer);
  if (recognition) {
    try { recognition.stop(); } catch (e) { console.warn('Speech recognition stop failed', e); }
  }
  recognition = null;
}

function queueSpeechRecognitionRestart() {
  clearTimeout(recognitionRestartTimer);
  if (manuallyStoppingRecognition || micToggle?.dataset.running !== '1') return;

  recognitionRestartTimer = setTimeout(() => {
    if (manuallyStoppingRecognition || micToggle?.dataset.running !== '1') return;
    try {
      recognition?.start();
    } catch (e) {
      console.warn('Speech recognition restart failed', e);
      queueSpeechRecognitionRestart();
    }
  }, 700);
}

function submitVoicePrompt(prompt) {
  const text = prompt.trim();
  if (!text) return;
  if (!micDiagnosticOptions.autoSubmit) {
    emitMicEvent('subsystem-disabled', { subsystem: 'auto-submit', text });
    return;
  }

  if (window.__chat?.sendPrompt) {
    window.__chat.sendPrompt(text);
  } else {
    const input = document.getElementById('input');
    const send = document.getElementById('send');
    if (input && send) {
      input.value = text;
      send.click();
    }
  }
}

function setMicTranscript(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const displayText = clean.length > MAX_TRANSCRIPT_DISPLAY
    ? `...${clean.slice(-MAX_TRANSCRIPT_DISPLAY)}`
    : clean;

  if (vttOutput) vttOutput.textContent = displayText;

  if (composerInput && micToggle?.dataset.running === '1') {
    composerInput.value = displayText;
  }
}

if (micToggle) {
  micToggle.addEventListener('click', async () => {
    if (micToggle.dataset.running === '1' || startingMic) {
      stopMicFromUserButton();
    } else {
      try {
        await startMicFromUserButton();
      } catch (e) {
        console.error(e);
      }
    }
  });
}

// expose functions for debugging
window.__mic = {
  startFromUserButton: startMicFromUserButton,
  stopFromUserButton: stopMicFromUserButton,
  isMicRunning,
  renderWaveformToCanvas,
  getAudioLevelSnapshot: getMicAudioLevelSnapshot,
  selectedMicInputDeviceId,
  setSelectedMicInputDeviceId,
  getSettingsOverride: getMicSettingsOverride,
  setSettingsOverride: setMicSettingsOverride,
  getDiagnosticOptions: getMicDiagnosticOptions,
  setDiagnosticOptions: setMicDiagnosticOptions,
  defaultDiagnosticOptions: defaultMicDiagnosticOptions
};
