const messagesEl = document.getElementById('messages');
const input = document.getElementById('input');
const send = document.getElementById('send');
const clearChat = document.getElementById('clearChat');
const modelSelect = document.getElementById('model');
const refreshModels = document.getElementById('refreshModels');
const defaultModel = 'llama2';
const selectedModelKey = 'selectedModel';
let currentAudio;
let playbackRate = Number(localStorage.getItem('playbackRate') || '1');
let aiAudioCtx;
let aiAnalyser;
let aiDataArray;
let aiAnimationId;
let audioUnlocked = false;
let streamingSpeechActive = false;
let streamingSpeechBuffer = '';

const aiWaveform = document.getElementById('aiWaveform');
const playbackSpeed = document.getElementById('playbackSpeed');
const playbackRateLabel = document.getElementById('playbackRateLabel');
const playbackRates = [0.75, 1, 1.25, 1.5, 1.75, 2];

function showDialog({ title = 'Big HAL', message = '', confirmText = 'OK', cancelText = '', danger = false } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'hal-dialog-overlay';
    overlay.innerHTML = `
      <div class="hal-dialog" role="dialog" aria-modal="true" aria-labelledby="halDialogTitle">
        <div class="hal-dialog-header">
          <span class="hal-dialog-mark"><i data-lucide="${danger ? 'alert-triangle' : 'message-square'}"></i></span>
          <h2 id="halDialogTitle">${escapeDialogHtml(title)}</h2>
        </div>
        <p>${escapeDialogHtml(message)}</p>
        <div class="hal-dialog-actions">
          ${cancelText ? `<button class="hal-dialog-secondary" type="button" data-dialog-cancel>${escapeDialogHtml(cancelText)}</button>` : ''}
          <button class="hal-dialog-primary${danger ? ' danger' : ''}" type="button" data-dialog-confirm>${escapeDialogHtml(confirmText)}</button>
        </div>
      </div>
    `;

    const close = value => {
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      resolve(value);
    };
    const onKeyDown = event => {
      if (event.key === 'Escape') close(false);
      if (event.key === 'Enter') close(true);
    };

    overlay.querySelector('[data-dialog-confirm]')?.addEventListener('click', () => close(true));
    overlay.querySelector('[data-dialog-cancel]')?.addEventListener('click', () => close(false));
    overlay.addEventListener('pointerdown', event => {
      if (event.target === overlay) close(false);
    });
    document.addEventListener('keydown', onKeyDown);
    document.body.appendChild(overlay);
    renderIcons(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    overlay.querySelector('[data-dialog-confirm]')?.focus();
  });
}

function escapeDialogHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

window.__dialog = {
  alert: options => showDialog({ confirmText: 'OK', ...(typeof options === 'string' ? { message: options } : options) }),
  confirm: options => showDialog({ confirmText: 'Confirm', cancelText: 'Cancel', ...(typeof options === 'string' ? { message: options } : options) })
};

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

async function loadMemoryHistory() {
  try {
    const response = await fetch('/api/memory/history?limit=24', { cache: 'no-store' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Memory history unavailable');
    messagesEl.innerHTML = '';
    (json.data || []).forEach(row => {
      addMessage(row.role === 'assistant' ? 'bot' : 'user', row.content);
    });
  } catch (err) {
    console.warn('Failed to load memory history', err);
  }
}

async function clearVisibleChat() {
  if (!messagesEl.children.length) return;
  const shouldClear = await window.__dialog.confirm({
    title: 'Clear Chat',
    message: 'Clear the visible chat? Saved memory is not deleted.',
    confirmText: 'Clear',
    danger: true
  });
  if (!shouldClear) return;
  messagesEl.innerHTML = '';
}

async function sendMessage() {
  const prompt = input.value.trim();
  return sendPrompt(prompt);
}

function getSelectedModel() {
  return modelSelect?.value || '';
}

function normalizeModelName(item) {
  if (typeof item === 'string') return item;
  return item?.name || item?.model || '';
}

async function loadChatModels() {
  if (!modelSelect) return;

  const previousValue = localStorage.getItem(selectedModelKey) || modelSelect.value || defaultModel;
  modelSelect.disabled = true;

  try {
    const resp = await fetch('/api/ollama/models', { cache: 'no-store' });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Could not load models');

    const models = (json.data || [])
      .map(normalizeModelName)
      .filter(Boolean);

    modelSelect.innerHTML = '';

    if (models.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No models installed';
      modelSelect.appendChild(option);
      modelSelect.value = '';
      send.disabled = true;
      return;
    }

    models.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      modelSelect.appendChild(option);
    });

    modelSelect.value = models.includes(previousValue) ? previousValue : models[0];
    localStorage.setItem(selectedModelKey, modelSelect.value);
    send.disabled = false;
  } catch (err) {
    console.warn('Failed to load chat models', err);
    if (!modelSelect.options.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Models unavailable';
      modelSelect.appendChild(option);
    }
    send.disabled = true;
  } finally {
    modelSelect.disabled = false;
  }
}

function unlockAudio() {
  try {
    aiAudioCtx = aiAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (aiAudioCtx.state === 'suspended') aiAudioCtx.resume();
    unlockMediaPlayback();
  } catch (err) {
    console.warn('Audio unlock failed', err);
  }
}

function unlockMediaPlayback() {
  if (audioUnlocked) return;

  const audio = new Audio();
  audio.muted = true;
  audio.playsInline = true;
  audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';

  audio.play()
    .then(() => {
      audio.pause();
      audioUnlocked = true;
    })
    .catch(err => {
      console.warn('Media playback unlock failed', err);
    });
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
    await playAudioUrls(urls, 0, clean, false);
    setAiVoiceActive(false);
  } catch (err) {
    setAiVoiceActive(false);
    console.warn('TTS error', err);
    speakWithBrowserVoice(clean);
  }
}

function speakWithBrowserVoice(text) {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;

  window.speechSynthesis.cancel();
  speakBrowserChunk(text);
}

function speakBrowserChunk(text, onend) {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return null;

  const utterance = new SpeechSynthesisUtterance(text.slice(0, 4500));
  utterance.lang = 'en-US';
  utterance.rate = playbackRate;
  utterance.onstart = () => setAiVoiceActive(true);
  utterance.onend = () => {
    onend?.();
    if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
      setAiVoiceActive(false);
    }
  };
  utterance.onerror = () => setAiVoiceActive(false);
  window.speechSynthesis.speak(utterance);
  return utterance;
}

function startStreamingSpeech() {
  streamingSpeechActive = Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance);
  streamingSpeechBuffer = '';
  if (streamingSpeechActive) window.speechSynthesis.cancel();
  return streamingSpeechActive;
}

function queueStreamingSpeech(text) {
  if (!streamingSpeechActive || !text) return;

  streamingSpeechBuffer += text.replace(/\s+/g, ' ');
  const sentenceEnd = /[.!?]\s/.exec(streamingSpeechBuffer);
  const shouldSpeakLongChunk = streamingSpeechBuffer.length >= 180;

  if (!sentenceEnd && !shouldSpeakLongChunk) return;

  const chunkEnd = sentenceEnd ? sentenceEnd.index + 1 : streamingSpeechBuffer.lastIndexOf(' ', 180);
  const safeEnd = chunkEnd > 0 ? chunkEnd : streamingSpeechBuffer.length;
  const chunk = streamingSpeechBuffer.slice(0, safeEnd).trim();
  streamingSpeechBuffer = streamingSpeechBuffer.slice(safeEnd).trimStart();
  if (chunk) speakBrowserChunk(chunk);
}

function finishStreamingSpeech() {
  if (!streamingSpeechActive) return false;

  const finalChunk = streamingSpeechBuffer.trim();
  streamingSpeechBuffer = '';
  streamingSpeechActive = false;
  if (finalChunk) speakBrowserChunk(finalChunk);
  return true;
}

function playAudioUrls(urls, index = 0, fallbackText = '', hadAudioError = false) {
  if (!urls[index]) {
    if (fallbackText && hadAudioError) speakWithBrowserVoice(fallbackText);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    currentAudio = new Audio(urls[index]);
    currentAudio.preload = 'auto';
    currentAudio.playsInline = true;
    currentAudio.playbackRate = playbackRate;
    connectAiWaveform(currentAudio);
    currentAudio.onended = () => resolve(playAudioUrls(urls, index + 1, fallbackText, hadAudioError));
    currentAudio.onerror = () => resolve(playAudioUrls(urls, index + 1, fallbackText, true));
    currentAudio.play().catch(async err => {
      console.warn('Audio playback was blocked or failed', err);
      try {
        if (aiAudioCtx?.state === 'suspended') await aiAudioCtx.resume();
        await currentAudio.play();
      } catch (retryErr) {
        console.warn('Audio playback retry failed', retryErr);
        speakWithBrowserVoice(fallbackText);
      }
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
  const model = getSelectedModel();
  if (!model) {
    addMessage('bot', 'No Ollama models are installed. Open Models and install one before chatting.');
    return;
  }

  addMessage('user', prompt);
  input.value = '';

  const url = `/api/stream?model=${encodeURIComponent(model)}&prompt=${encodeURIComponent(prompt)}`;

  const evt = new EventSource(url);
  const botEl = addMessage('bot', 'Thinking');
  let partial = '';
  const canSpeakStream = startStreamingSpeech();

  evt.onmessage = (e) => {
    const data = e.data;
    if (data === '[DONE]') { evt.close(); return; }
    const chunk = parseOllamaChunk(data);
    if (!chunk) return;
    partial += chunk;
    botEl.textContent = partial;
    queueStreamingSpeech(chunk);
  };
  evt.addEventListener('done', () => {
    evt.close();
    if (!finishStreamingSpeech() && !canSpeakStream) speakText(partial);
    window.dispatchEvent(new CustomEvent('hal:memory-changed'));
  });
  evt.addEventListener('error', (event) => {
    console.error('SSE error', event);
    streamingSpeechActive = false;
    streamingSpeechBuffer = '';
    if (event.data) {
      try {
        botEl.textContent = JSON.parse(event.data);
      } catch (err) {
        botEl.textContent = event.data;
      }
    } else if (!partial) {
      botEl.textContent = 'Ollama did not return a response. Check the Monitor screen for service status.';
    }
    evt.close();
  });
}

send.addEventListener('click', () => {
  unlockAudio();
  sendMessage();
});
clearChat?.addEventListener('click', clearVisibleChat);
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

modelSelect?.addEventListener('change', () => {
  localStorage.setItem(selectedModelKey, modelSelect.value);
});

refreshModels?.addEventListener('click', loadChatModels);

setPlaybackRate(playbackRate);
loadChatModels();
loadMemoryHistory();
renderIcons();

window.__icons = { render: renderIcons };
window.__chat = { sendPrompt, speakText, unlockAudio, setPlaybackRate, loadModels: loadChatModels, loadMemoryHistory };
