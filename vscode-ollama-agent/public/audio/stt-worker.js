let socket = null;
let inputSampleRate = 48000;
let outputSampleRate = 16000;
let audioPort = null;
let chunkCount = 0;
let lastChunkAt = 0;
let lastDiagnosticAt = 0;
let maxBufferedAmount = 0;
const WORKER_CHUNK_PROCESS_WARN_MS = 40;
const WORKER_CHUNK_GAP_WARN_MS = 180;
const SOCKET_BUFFER_WARN_BYTES = 256 * 1024;
const DIAGNOSTIC_INTERVAL_MS = 1000;

function post(type, data = {}) {
  self.postMessage({ type, ...data });
}

function sttStreamUrl(token) {
  const protocol = self.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${self.location.host}/api/stt/stream?token=${encodeURIComponent(token)}`;
}

async function fetchSttToken() {
  const response = await fetch('/api/stt/token', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }
  });
  const json = await response.json();
  if (!json.ok || !json.data?.token) throw new Error(json.error || 'STT socket token unavailable.');
  return json.data.token;
}

async function connect(message = {}) {
  closeSocket(1000, 'worker reconnecting');
  inputSampleRate = Number(message.inputSampleRate || inputSampleRate || 48000);
  outputSampleRate = Number(message.outputSampleRate || outputSampleRate || 16000);
  chunkCount = 0;
  lastChunkAt = 0;
  lastDiagnosticAt = 0;
  maxBufferedAmount = 0;

  try {
    const token = await fetchSttToken();
    socket = new WebSocket(sttStreamUrl(token));
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => post('server-open');
    socket.onmessage = event => post('server-message', { message: parseServerMessage(event.data) });
    socket.onerror = () => post('server-error', { error: 'Server speech recognition connection failed.' });
    socket.onclose = event => {
      post('server-close', { code: event.code, reason: event.reason });
      socket = null;
    };
  } catch (err) {
    post('server-error', { error: err.message || 'Server speech recognition unavailable.' });
  }
}

function parseServerMessage(raw) {
  try {
    return JSON.parse(String(raw || '{}'));
  } catch (err) {
    return {};
  }
}

function sendChunk(message = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const startedAt = performance.now();
  const now = Date.now();
  const chunkGapMs = lastChunkAt ? now - lastChunkAt : 0;
  lastChunkAt = now;
  chunkCount += 1;
  const input = message.input instanceof Float32Array
    ? message.input
    : new Float32Array(message.input || []);
  const pcm = downsampleFloatTo16BitPcm(
    input,
    Number(message.inputSampleRate || inputSampleRate),
    Number(message.outputSampleRate || outputSampleRate)
  );
  if (pcm.byteLength) socket.send(pcm.buffer);
  const processMs = performance.now() - startedAt;
  const bufferedAmount = socket.bufferedAmount || 0;
  maxBufferedAmount = Math.max(maxBufferedAmount, bufferedAmount);
  maybePostWorkerDiagnostic({ processMs, chunkGapMs, bufferedAmount });
}

function maybePostWorkerDiagnostic({ processMs, chunkGapMs, bufferedAmount }) {
  const now = Date.now();
  const pressure = processMs > WORKER_CHUNK_PROCESS_WARN_MS
    || chunkGapMs > WORKER_CHUNK_GAP_WARN_MS
    || bufferedAmount > SOCKET_BUFFER_WARN_BYTES;
  if (!pressure && now - lastDiagnosticAt < DIAGNOSTIC_INTERVAL_MS) return;
  if (pressure || now - lastDiagnosticAt >= DIAGNOSTIC_INTERVAL_MS) {
    lastDiagnosticAt = now;
    post('diagnostic', {
      area: 'stt-worker',
      pressure,
      processMs: Number(processMs.toFixed(2)),
      chunkGapMs,
      bufferedAmount,
      maxBufferedAmount,
      chunks: chunkCount,
      socketPressure: bufferedAmount > SOCKET_BUFFER_WARN_BYTES
    });
  }
}

function flush() {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'flush' }));
}

function closeSocket(code = 1000, reason = 'worker stopped') {
  if (!socket) return;
  try {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' }));
    socket.close(code, reason);
  } catch (err) {}
  socket = null;
}

function attachAudioPort(port) {
  if (audioPort) {
    try { audioPort.onmessage = null; } catch (err) {}
    try { audioPort.close(); } catch (err) {}
  }
  audioPort = port;
  audioPort.onmessage = event => {
    const message = event.data || {};
    if (message.type === 'chunk') sendChunk(message);
  };
  try { audioPort.start?.(); } catch (err) {}
  post('worker-audio-port-ready');
}

function downsampleFloatTo16BitPcm(input, fromSampleRate, toSampleRate) {
  if (!input || fromSampleRate <= toSampleRate) {
    return floatTo16BitPcm(input || new Float32Array());
  }

  const ratio = fromSampleRate / toSampleRate;
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
  return floatTo16BitPcm(output);
}

function floatTo16BitPcm(input) {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] || 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

self.onmessage = event => {
  const message = event.data || {};
  if (message.type === 'connect') {
    connect(message);
    return;
  }
  if (message.type === 'audio-port') {
    attachAudioPort(event.ports?.[0]);
    return;
  }
  if (message.type === 'chunk') {
    sendChunk(message);
    return;
  }
  if (message.type === 'flush') {
    flush();
    return;
  }
  if (message.type === 'stop') {
    closeSocket(1000, 'mic stopped');
  }
};
