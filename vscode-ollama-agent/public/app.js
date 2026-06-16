const messagesEl = document.getElementById('messages');
const input = document.getElementById('input');
const send = document.getElementById('send');
const defaultModel = 'llama2';
let currentAudio;
let playbackRate = Number(localStorage.getItem('playbackRate') || '1');
let aiAudioCtx;
let aiAnalyser;
let aiDataArray;
let aiAnimationId;

const aiWaveform = document.getElementById('aiWaveform');
const playbackSpeed = document.getElementById('playbackSpeed');
const playbackRateLabel = document.getElementById('playbackRateLabel');
const playbackRates = [0.75, 1, 1.25, 1.5, 1.75, 2];

function renderIcons(root = document) {
  if (!window.lucide?.createIcons) return;
  window.lucide.createIcons({
    icons: window.lucide.icons,
    root,
    attrs: {
      width: 18,
      height: 18,
      'stroke-width': 2,
    },
  });
}

function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

// Clear messages on double-click
messagesEl.addEventListener('dblclick', () => { messagesEl.innerHTML = ''; });

async function sendMessage() {
  const prompt = input.value.trim();
  return sendPrompt(prompt);
}

function getSelectedModel() {
  const modelEl = document.getElementById('model');
  return modelEl?.value || defaultModel;
}

function unlockAudio() {
  try {
    aiAudioCtx = aiAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (aiAudioCtx.state === 'suspended') aiAudioCtx.resume();
  } catch (err) {
    console.warn('Audio unlock failed', err);
  }
}

function setPlaybackRate(rate) {
  playbackRate = playbackRates.includes(rate) ? rate : 1;
  localStorage.setItem('playbackRate', String(playbackRate));
  if (currentAudio) currentAudio.playbackRate = playbackRate;
  if (playbackRateLabel) playbackRateLabel.textContent = `${playbackRate}x`;

  playbackSpeed?.querySelector('[data-speed-step="-1"]')?.toggleAttribute('disabled', playbackRate === playbackRates[0]);
  playbackSpeed?.querySelector('[data-speed-step="1"]')?.toggleAttribute('disabled', playbackRate === playbackRates[playbackRates.length - 1]);
}

function stepPlaybackRate(direction) {
  const currentIndex = playbackRates.indexOf(playbackRate);
  const nextIndex = Math.min(playbackRates.length - 1, Math.max(0, currentIndex + direction));
  setPlaybackRate(playbackRates[nextIndex]);
}

function parseOllamaChunk(data) {
  try {
    const obj = JSON.parse(data);
    if (typeof obj.response === 'string') return obj.response;
    if (typeof obj.message?.content === 'string') return obj.message.content;
    if (Array.isArray(obj.output)) return obj.output.map(part => part?.content || '').join('');
    if (typeof obj === 'string') return obj;
  } catch (err) {
    return data;
  }

  return '';
}

async function speakText(text) {
  const clean = text.trim();
  if (!clean) return;

  try {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    const r = await fetch(`/api/tts?lang=en&text=${encodeURIComponent(clean.slice(0, 4500))}`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'TTS request failed');

    const urls = j.urls || (j.url ? [j.url] : []);
    setAiVoiceActive(true);
    await playAudioUrls(urls);
    setAiVoiceActive(false);
  } catch (err) {
    setAiVoiceActive(false);
    console.warn('TTS error', err);
  }
}

function playAudioUrls(urls, index = 0) {
  if (!urls[index]) return Promise.resolve();

  return new Promise((resolve) => {
    currentAudio = new Audio(urls[index]);
    currentAudio.playbackRate = playbackRate;
    connectAiWaveform(currentAudio);
    currentAudio.onended = () => resolve(playAudioUrls(urls, index + 1));
    currentAudio.onerror = () => resolve(playAudioUrls(urls, index + 1));
    currentAudio.play().catch(err => {
      console.warn('Audio playback was blocked or failed', err);
      resolve();
    });
  });
}

function connectAiWaveform(audio) {
  if (!aiWaveform) return;

  try {
    aiAudioCtx = aiAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (aiAudioCtx.state === 'suspended') aiAudioCtx.resume();

    const source = aiAudioCtx.createMediaElementSource(audio);
    aiAnalyser = aiAudioCtx.createAnalyser();
    aiAnalyser.fftSize = 1024;
    aiDataArray = new Uint8Array(aiAnalyser.fftSize);
    source.connect(aiAnalyser);
    aiAnalyser.connect(aiAudioCtx.destination);
    drawAiWaveform();
  } catch (err) {
    console.warn('AI waveform setup failed', err);
  }
}

function drawAiWaveform() {
  if (!aiWaveform || !aiAnalyser || !aiDataArray) return;

  const ctx = aiWaveform.getContext('2d');
  const width = aiWaveform.width;
  const height = aiWaveform.height;
  aiAnalyser.getByteTimeDomainData(aiDataArray);

  ctx.clearRect(0, 0, width, height);
  ctx.beginPath();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#b7a7ff';

  const step = Math.max(1, Math.floor(aiDataArray.length / width));
  let x = 0;
  for (let i = 0; i < aiDataArray.length; i += step) {
    const y = (aiDataArray[i] / 255) * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    x += 1;
  }
  ctx.stroke();

  aiAnimationId = requestAnimationFrame(drawAiWaveform);
}

function setAiVoiceActive(isActive) {
  const panel = document.querySelector('.ai-voice');
  if (panel) panel.classList.toggle('active', isActive);

  if (!isActive && aiAnimationId) {
    cancelAnimationFrame(aiAnimationId);
    aiAnimationId = null;
  }
}

function sendPrompt(prompt) {
  if (!prompt) return;
  addMessage('user', prompt);
  input.value = '';

  const model = getSelectedModel();
  const url = `/api/stream?model=${encodeURIComponent(model)}&prompt=${encodeURIComponent(prompt)}`;

  const evt = new EventSource(url);
  const botEl = addMessage('bot', '');
  let partial = '';

  evt.onmessage = (e) => {
    const data = e.data;
    if (data === '[DONE]') { evt.close(); return; }
    partial += parseOllamaChunk(data);
    botEl.textContent = partial;
  };
  evt.addEventListener('done', () => {
    evt.close();
    speakText(partial);
  });
  evt.onerror = (err) => { console.error('SSE error', err); evt.close(); };
}

send.addEventListener('click', () => {
  unlockAudio();
  sendMessage();
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    unlockAudio();
    sendMessage();
  }
});

playbackSpeed?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-speed-step]');
  if (!button) return;
  stepPlaybackRate(Number(button.dataset.speedStep));
});

setPlaybackRate(playbackRate);
renderIcons();

window.__icons = { render: renderIcons };
window.__chat = { sendPrompt, speakText, unlockAudio, setPlaybackRate };
