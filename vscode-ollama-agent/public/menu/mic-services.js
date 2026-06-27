async function initMicServices() {
  byId('saveMicServices')?.addEventListener('click', saveMicServices);
  await loadMicServices();
}

function selectedMicProvider() {
  return document.querySelector('input[name="micTranscriptionProvider"]:checked')?.value || 'pipeline';
}

function setSelectedMicProvider(provider) {
  const value = ['pipeline', 'auto', 'server', 'browser'].includes(provider) ? provider : 'pipeline';
  const input = document.querySelector(`input[name="micTranscriptionProvider"][value="${value}"]`);
  if (input) input.checked = true;
}

function renderMicServices(data = {}) {
  const provider = data.transcriptionProvider || 'pipeline';
  const stt = provider === 'pipeline' ? (data.voicePipeline || data.stt || {}) : (data.stt || {});
  setSelectedMicProvider(provider);

  const providerLabel = provider === 'pipeline'
    ? 'Voice pipeline'
    : provider === 'server'
    ? 'Server STT only'
    : provider === 'browser'
      ? 'Browser STT only'
      : 'Auto';
  const okText = stt.ok ? `${stt.stt || stt.provider || 'STT'} ready` : (stt.state || 'unavailable');
  const modelPath = stt.model || stt.modelPath || 'Not configured';
  const details = stt.error || (stt.ok ? 'Speech recognition is available.' : 'Speech recognition is not ready.');

  if (byId('micServicesProvider')) byId('micServicesProvider').textContent = providerLabel;
  if (byId('micServicesSttState')) byId('micServicesSttState').textContent = okText;
  if (byId('micServicesSampleRate')) byId('micServicesSampleRate').textContent = stt.sampleRate ? `${stt.sampleRate} Hz` : 'Unknown';
  if (byId('micServicesModelPath')) byId('micServicesModelPath').textContent = modelPath;
  if (byId('micServicesSettingsPath')) byId('micServicesSettingsPath').textContent = data.settingsPath || 'Server default';
  if (byId('micServicesDetails')) byId('micServicesDetails').textContent = details;
}

async function loadMicServices() {
  const status = byId('micServicesStatus');
  if (status) status.textContent = 'Loading microphone services...';

  try {
    const response = await fetchWithAuthRedirect('/api/admin/mic-settings', { cache: 'no-store' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Could not load microphone services');
    renderMicServices(json.data || {});
    if (status) status.textContent = 'Microphone services loaded.';
  } catch (err) {
    if (status) status.textContent = `Microphone services error: ${err.message}`;
  }
}

async function saveMicServices() {
  const status = byId('micServicesStatus');
  const transcriptionProvider = selectedMicProvider();
  if (status) status.textContent = 'Saving microphone services...';

  try {
    const response = await fetchWithAuthRedirect('/api/admin/mic-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcriptionProvider })
    });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Could not save microphone services');
    renderMicServices(json.data || {});
    if (status) status.textContent = `Saved. Mic provider is ${json.data?.transcriptionProvider || transcriptionProvider}.`;
  } catch (err) {
    if (status) status.textContent = `Save error: ${err.message}`;
  }
}
