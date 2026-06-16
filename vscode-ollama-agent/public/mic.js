// mic.js
// Captures microphone audio, draws a fixed-size waveform, and uses Web Speech API for voice-to-text.

let audioCtx, analyser, dataArray, sourceNode, mediaStream;
let animationId;
let finalTranscriptBuffer = '';
const MAX_TRANSCRIPT_DISPLAY = 180;

const canvas = document.getElementById('waveform');
const vttOutput = document.getElementById('vttOutput');
const micToggle = document.getElementById('micToggle');

async function startMic() {
  console.log('startMic called');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('getUserMedia not supported in this browser');
    return;
  }

  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  sourceNode = audioCtx.createMediaStreamSource(mediaStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  const bufferLength = analyser.fftSize; // use full fftSize for time-domain
  dataArray = new Uint8Array(bufferLength);
  sourceNode.connect(analyser);

  console.log('audio started, bufferLength=', bufferLength);
  drawWaveform();
  startSpeechRecognition();
}

function stopMic() {
  console.log('stopMic called');
  mediaStream && mediaStream.getTracks().forEach(t => t.stop());
  animationId && cancelAnimationFrame(animationId);
  animationId = null;
  audioCtx && audioCtx.close();
  analyser = null;
  dataArray = null;
  stopSpeechRecognition();
  if (micToggle) {
    micToggle.classList.remove('active');
  }
}

function renderIcons() {
  window.__icons?.render?.();
}

function drawWaveform() {
  if (!analyser || !canvas) return;
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
  for (let i = 0; i < dataArray.length; i += step) {
    const y = (dataArray[i] / 255) * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    x += 1;
  }
  ctx.stroke();

  animationId = requestAnimationFrame(drawWaveform);
}

// Web Speech API for voice-to-text
let recognition;
function startSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    vttOutput.textContent = 'SpeechRecognition API not supported in this browser.';
    return;
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
  recognition.onerror = (e) => { console.error('Speech recognition error', e); };
  recognition.onend = () => {
    if (micToggle.dataset.running === '1') {
      try { recognition.start(); } catch (e) { console.warn('Speech recognition restart failed', e); }
    }
  };
  try { recognition.start(); } catch (e) { console.warn('Speech recognition start failed', e); }
}

function stopSpeechRecognition() {
  recognition && recognition.stop();
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
  if (!vttOutput) return;

  const clean = text.replace(/\s+/g, ' ').trim();
  vttOutput.textContent = clean.length > MAX_TRANSCRIPT_DISPLAY
    ? `...${clean.slice(-MAX_TRANSCRIPT_DISPLAY)}`
    : clean;
}

micToggle.addEventListener('click', async () => {
  window.__chat?.unlockAudio?.();
  if (micToggle.dataset.running === '1') {
    micToggle.dataset.running = '0';
    micToggle.innerHTML = '<i data-lucide="mic"></i> Voice Input';
    renderIcons();
    micToggle.classList.remove('active');
    stopMic();
  } else {
    micToggle.dataset.running = '1';
    micToggle.innerHTML = '<i data-lucide="square"></i> Listening';
    renderIcons();
    micToggle.classList.add('active');
    try {
      await startMic();
    } catch (e) {
      console.error(e);
      micToggle.dataset.running = '0';
      micToggle.innerHTML = '<i data-lucide="mic"></i> Voice Input';
      renderIcons();
      micToggle.classList.remove('active');
    }
  }
});

// expose functions for debugging
window.__mic = { startMic, stopMic };
