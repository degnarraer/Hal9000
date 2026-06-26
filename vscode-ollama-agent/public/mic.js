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
let composerDraftBeforeMic = '';
let startingMic = false;
let micStartToken = 0;
const MAX_TRANSCRIPT_DISPLAY = 180;

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

async function startMic() {
  console.log('startMic called');
  if (startingMic || micToggle?.dataset.running === '1') return;
  startingMic = true;
  const startToken = ++micStartToken;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    await window.__dialog.alert({
      title: 'Microphone Unsupported',
      message: 'getUserMedia is not supported in this browser.'
    });
    startingMic = false;
    return;
  }

  try {
    finalTranscriptBuffer = '';
    speechRecognitionFailed = false;
    detectedAudioWhileSpeechFailed = false;
    setMicButtonState(true);
    setMicTranscript('Starting microphone...');

    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: micAudioConstraints
    });

    if (startToken !== micStartToken) {
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
    drawWaveform();
    startSpeechRecognition();
  } catch (e) {
    stopMic();
    throw e;
  } finally {
    startingMic = false;
  }
}

function stopMic() {
  console.log('stopMic called');
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
  stopSpeechRecognition();
  setMicTranscript('');
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
}

function drawWaveform() {
  if (!analyser || !canvas) return;
  if (audioCtx?.state === 'suspended') {
    audioCtx.resume().catch(err => console.warn('AudioContext resume failed', err));
  }

  analyser.getByteTimeDomainData(dataArray);

  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * ratio));
  const height = Math.max(1, Math.floor(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.beginPath();
  ctx.lineWidth = 2 * ratio;
  ctx.strokeStyle = '#00e0ff';

  const step = Math.max(1, Math.floor(dataArray.length / width));
  let x = 0;
  let level = 0;
  for (let i = 0; i < dataArray.length; i += step) {
    level += Math.abs(dataArray[i] - 128);
    const y = (dataArray[i] / 255) * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    x += 1;
  }
  ctx.stroke();

  const averageLevel = level / Math.max(1, x);
  if (speechRecognitionFailed && averageLevel > 4 && !detectedAudioWhileSpeechFailed) {
    detectedAudioWhileSpeechFailed = true;
    setMicTranscript('Mic audio detected. Browser speech recognition service is unavailable.');
  }

  animationId = requestAnimationFrame(drawWaveform);
}

function startSpeechRecognition() {
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
  recognition.continuous = true;
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
      submitVoicePrompt(finalTranscriptBuffer);
      finalTranscriptBuffer = '';
    }

    setMicTranscript([final, interim].filter(Boolean).join(' ').trim());
  };
  recognition.onerror = (e) => {
    if (e.error === 'no-speech') {
      setMicTranscript('Listening...');
      return;
    }

    if (e.error === 'network') {
      speechRecognitionFailed = true;
      setMicTranscript('Mic is active. Browser speech recognition cannot reach its service.');
      console.warn('Speech recognition service unavailable', e);
      return;
    }

    const recoverable = ['aborted', 'audio-capture'].includes(e.error);
    const message = e.message || e.error || 'Speech recognition failed';
    if (recoverable) {
      console.warn('Speech recognition warning', e);
      setMicTranscript('Listening...');
    } else {
      console.error('Speech recognition error', e);
      setMicTranscript(`Voice input error: ${message}`);
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
      stopMic();
    } else {
      try {
        window.__chat?.unlockAudio?.();
        await startMic();
      } catch (e) {
        console.error(e);
      }
    }
  });
}

// expose functions for debugging
window.__mic = { startMic, stopMic };
