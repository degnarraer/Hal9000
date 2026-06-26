function initBobChatTester() {
  const status = byId('bobChatTesterStatus');
  const modelSelect = byId('bobChatTestModel');
  const refreshModels = byId('bobChatTestRefreshModels');
  const messages = byId('bobChatTestMessages');
  const form = byId('bobChatTestForm');
  const promptInput = byId('bobChatTestPrompt');
  const sendButton = byId('bobChatTestSend');
  const rerunButton = byId('bobChatTestRerun');
  const clearButton = byId('bobChatTestClear');
  const routerStageButton = byId('bobChatRouterStage');
  const responseStageButton = byId('bobChatResponseStage');
  const bobChatSkillButton = byId('bobChatSkillEdit');
  const webSearchSkillButton = byId('bobWebSearchSkillEdit');
  const presetGrid = byId('bobChatPresetGrid');
  const debugCopy = byId('bobChatDebugCopy');
  const llmCopy = byId('bobChatLlmCopy');
  const contractBadge = byId('bobChatContractBadge');
  const llmTrace = byId('bobChatLlmTrace');
  const liveStatus = byId('bobChatLiveStatus');
  const liveOutput = byId('bobChatLiveOutput');
  const testerFace = byId('bobChatTesterFace');
  const testerFaceStatus = byId('bobChatFaceStatus');
  const testerMemoryBrain = byId('bobChatMemoryBrain');
  const testerContextCanvas = byId('bobChatTesterContextChart');
  const testerContextStatus = byId('bobChatTesterContextStatus');
  const modelStatusState = byId('bobChatModelStatusState');
  const modelStatusSummary = byId('bobChatModelStatusSummary');
  const modelStatusList = byId('bobChatModelStatusList');
  const selectedModelKey = 'bobChatTesterSelectedModel';
  const modelRulesKey = 'bobChatTesterModelRules';
  const supportedStageTags = [
    { value: '[CHAT INPUT]', label: '[CHAT INPUT]', title: 'Insert the current tester prompt.' },
    { value: '[REQUEST ID]', label: '[REQUEST ID]', title: 'Insert a server-generated request UUID.' },
    { value: '[REQUEST TIMESTAMP]', label: '[REQUEST TIMESTAMP]', title: 'Insert the server request timestamp.' },
    { value: '[SESSION ID]', label: '[SESSION ID]', title: 'Insert the current server session id.' },
    { value: '[USER ID]', label: '[USER ID]', title: 'Insert the canonical server user id.' },
    { value: '[USER NAME]', label: '[USER NAME]', title: 'Insert the authenticated user display name.' },
    { value: '[AVAILABLE SKILLS]', label: '[AVAILABLE SKILLS]', title: 'Insert the enabled skill registry.' },
    { value: '[FACTOIDS 5]', label: '[FACTOIDS #]', title: 'Insert saved user factoids up to the requested count.' },
    { value: '[CHAT MEMORY 10]', label: '[CHAT MEMORY #]', title: 'Insert recent chat memory up to the requested count.' },
    { value: '[SEARCH QUERY]', label: '[SEARCH QUERY]', title: 'Insert the server-derived search query.' },
    { value: '[SEARCH RESULTS 5]', label: '[SEARCH RESULTS #]', title: 'Insert web search results up to the requested count.' }
  ];
  const ruleInputs = {
    routerMinSizeB: byId('bobRuleRouterMin'),
    fallbackMinSizeB: byId('bobRuleFallbackMin'),
    greeting: byId('bobRuleGreeting'),
    chat: byId('bobRuleChat'),
    writing: byId('bobRuleWriting'),
    reasoning: byId('bobRuleReasoning'),
    code: byId('bobRuleCode'),
    webSearch: byId('bobRuleWebSearch'),
    longContext: byId('bobRuleLongContext'),
    veryLongContext: byId('bobRuleVeryLongContext')
  };
  let lastPrompt = '';
  let lastResult = null;
  let isRunning = false;
  let modelStatusSource = null;
  let modelStatusCountdownTimer = null;
  let testerBob = window.BobExpressionEngine && testerFace ? new window.BobExpressionEngine(testerFace) : null;
  let testerSpeechActive = false;
  let testerSpeechBuffer = '';
  let testerSpeechQueue = [];
  let testerSpeechQueueActive = false;
  let testerSpeechGeneration = 0;
  let testerSpeechAudio = null;
  let testerSpeechObjectUrls = [];
  let testerSpeechAudioContext = null;
  let testerSpeechAnalyser = null;
  let testerSpeechDataArray = null;
  let testerSpeechAnimationId = null;
  let traceHoverDialog = null;
  let traceDialogPinned = false;
  let testerContextChart = null;

  const presets = [
    'Hi',
    'What can you help me with?',
    'Explain recursion in two sentences.',
    'Write a short apology for a late reply.',
    'Give me three debugging steps for a failing API call.',
    'Turn this into a friendly note: the server restarts at noon.',
    'Ask me one clarifying question about a new feature.',
    'Summarize why JSON contracts matter.',
    'Make a tiny checklist for testing a login form.',
    'Tell me a harmless joke about software testing.',
    'Rewrite this plainly: utilization metrics exceeded threshold.',
    'Help me brainstorm names for a local AI assistant.'
  ];

  function setStatus(message, state = 'idle') {
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  }

  function pretty(value) {
    if (typeof value === 'string') {
      try {
        return JSON.stringify(JSON.parse(value), null, 2);
      } catch (err) {
        return value;
      }
    }
    return JSON.stringify(value ?? {}, null, 2);
  }

  function normalizeModelName(item) {
    if (typeof item === 'string') return item;
    return item?.name || item?.model || '';
  }

  function numberFromInput(input, fallback) {
    const value = Number(input?.value);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  function readModelRules() {
    return {
      routerMinSizeB: numberFromInput(ruleInputs.routerMinSizeB, 3),
      fallbackMinSizeB: numberFromInput(ruleInputs.fallbackMinSizeB, 2),
      minByTask: {
        greeting: numberFromInput(ruleInputs.greeting, 0.8),
        chat: numberFromInput(ruleInputs.chat, 2),
        writing: numberFromInput(ruleInputs.writing, 2),
        reasoning: numberFromInput(ruleInputs.reasoning, 4),
        code: numberFromInput(ruleInputs.code, 9),
        webSearch: numberFromInput(ruleInputs.webSearch, 9),
        longContext: numberFromInput(ruleInputs.longContext, 9),
        veryLongContext: numberFromInput(ruleInputs.veryLongContext, 27)
      }
    };
  }

  function saveModelRules() {
    localStorage.setItem(modelRulesKey, JSON.stringify(readModelRules()));
  }

  function loadModelRules() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(modelRulesKey) || 'null');
    } catch (err) {
      saved = null;
    }
    const minByTask = saved?.minByTask || {};
    const values = {
      routerMinSizeB: saved?.routerMinSizeB ?? 3,
      fallbackMinSizeB: saved?.fallbackMinSizeB ?? 2,
      greeting: minByTask.greeting ?? 0.8,
      chat: minByTask.chat ?? 2,
      writing: minByTask.writing ?? 2,
      reasoning: minByTask.reasoning ?? 4,
      code: minByTask.code ?? 9,
      webSearch: minByTask.webSearch ?? 9,
      longContext: minByTask.longContext ?? 9,
      veryLongContext: minByTask.veryLongContext ?? 27
    };
    Object.entries(ruleInputs).forEach(([key, input]) => {
      if (input) input.value = values[key];
    });
  }

  function setRunning(nextRunning) {
    isRunning = nextRunning;
    [sendButton, rerunButton, clearButton, routerStageButton, responseStageButton, bobChatSkillButton, webSearchSkillButton, refreshModels, modelSelect, promptInput].filter(Boolean).forEach(element => {
      element.toggleAttribute('disabled', isRunning);
    });
    debugCopy?.toggleAttribute('disabled', isRunning || !lastResult);
    llmCopy?.toggleAttribute('disabled', isRunning || !lastResult?.llm?.length);
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }

  function addMessage(role, text) {
    if (!messages) return null;
    const row = document.createElement('div');
    row.className = `bob-chat-test-message ${role}`;
    row.textContent = text;
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
    return row;
  }

  function renderPresets() {
    if (!presetGrid) return;
    presetGrid.replaceChildren(...presets.map((preset, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${index + 1}. ${preset}`;
      button.addEventListener('click', () => {
        if (promptInput) promptInput.value = preset;
        runTest(preset);
      });
      return button;
    }));
  }

  async function loadModels() {
    if (!modelSelect) return;
    const previous = localStorage.getItem(selectedModelKey) || modelSelect.value || 'AUTO';
    modelSelect.disabled = true;
    try {
      const response = await fetchWithAuthRedirect('/api/ollama/models', { cache: 'no-store' });
      const json = await response.json();
      if (!json.ok) throw new Error(json.error || 'Could not load models');
      const models = (json.data || []).map(normalizeModelName).filter(Boolean);
      modelSelect.innerHTML = '';
      if (!models.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No models installed';
        modelSelect.appendChild(option);
        setStatus('No models', 'fail');
        return;
      }
      const autoOption = document.createElement('option');
      autoOption.value = 'AUTO';
      autoOption.textContent = 'AUTO (router chooses)';
      modelSelect.appendChild(autoOption);
      models.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        modelSelect.appendChild(option);
      });
      modelSelect.value = previous === 'AUTO' || models.includes(previous) ? previous : 'AUTO';
      localStorage.setItem(selectedModelKey, modelSelect.value);
      setStatus('Idle');
    } catch (err) {
      modelSelect.innerHTML = '<option value="">Models unavailable</option>';
      setStatus('Models unavailable', 'fail');
    } finally {
      modelSelect.disabled = false;
    }
  }

  function renderValidation(validation = {}, metadata = {}) {
    const valid = Boolean(validation.valid);
    const fallbackApplied = Boolean(metadata.fallbackApplied);
    const checks = validation.checks || [];
    const passed = checks.filter(check => check.pass).length;
    const failed = Math.max(0, checks.length - passed);
    if (contractBadge) {
      contractBadge.className = `bob-chat-contract-badge ${valid ? 'pass' : fallbackApplied ? 'warn' : 'fail'}`;
      contractBadge.textContent = valid ? 'Contract met' : fallbackApplied ? 'Fallback applied' : `${failed} checks failed`;
    }
  }

  function renderTrace(entries = []) {
    if (!llmTrace) return;
    removeTraceHoverDialog();
    if (!entries.length) {
      llmTrace.innerHTML = '<div class="menu-loading">No trace yet.</div>';
      llmCopy?.setAttribute('disabled', '');
      return;
    }
    llmCopy?.removeAttribute('disabled');
    const list = document.createElement('div');
    list.className = 'bob-chat-trace-list';
    entries.forEach(entry => {
      const checks = entry.validation?.checks || entry.checks || [];
      const passed = checks.filter(check => check.pass).length;
      const output = pretty(entry.output || '');
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `bob-chat-trace-row ${entry.contractValid ? 'pass' : 'fail'}`;
      row.innerHTML = `
        <span class="bob-chat-trace-row-title">${escapeHtml(formatSkillLabel(entry.skill))}</span>
        <span class="bob-chat-trace-row-preview">${escapeHtml(output || '(empty output)')}</span>
        <span class="bob-chat-trace-status ${entry.contractValid ? 'pass' : 'fail'}">${entry.contractValid ? 'Pass' : 'Check'}${checks.length ? ` ${passed}/${checks.length}` : ''}</span>
      `;
      row.addEventListener('mouseenter', () => showTraceDialog(entry, { pinned: false }));
      row.addEventListener('mouseleave', removeTraceHoverDialog);
      row.addEventListener('focus', () => showTraceDialog(entry, { pinned: false }));
      row.addEventListener('blur', removeTraceHoverDialog);
      row.addEventListener('click', event => {
        event.preventDefault();
        showTraceDialog(entry, { pinned: true });
      });
      list.appendChild(row);
    });
    llmTrace.replaceChildren(list);
  }

  function resetLiveOutput(label = 'Idle', state = 'idle') {
    if (liveStatus) {
      liveStatus.textContent = label;
      liveStatus.dataset.state = state;
    }
    if (liveOutput) liveOutput.textContent = label === 'Idle' ? 'No live output yet.' : '';
  }

  function appendLiveOutput(chunk = '') {
    if (!liveOutput) return;
    liveOutput.textContent += String(chunk || '');
    liveOutput.scrollTop = liveOutput.scrollHeight;
  }

  function setTesterFaceStatus(message) {
    if (testerFaceStatus) testerFaceStatus.textContent = message;
  }

  function setTesterFaceSpeaking(isSpeaking) {
    mainPage.querySelector('.bob-chat-face-card')?.classList.toggle('active', Boolean(isSpeaking));
    if (isSpeaking) testerBob?.startSpeaking();
    else testerBob?.stopSpeaking();
  }

  function stopTesterSpeech() {
    testerSpeechGeneration += 1;
    testerSpeechActive = false;
    testerSpeechBuffer = '';
    testerSpeechQueue = [];
    testerSpeechQueueActive = false;
    stopTesterSpeechMouth();
    if (testerSpeechAudio) {
      testerSpeechAudio.pause();
      testerSpeechAudio.removeAttribute('src');
      testerSpeechAudio.load?.();
      testerSpeechAudio = null;
    }
    testerSpeechObjectUrls.forEach(url => URL.revokeObjectURL(url));
    testerSpeechObjectUrls = [];
    setTesterFaceSpeaking(false);
    testerBob?.idle?.();
    setTesterFaceStatus('Ready for streamed speech.');
  }

  function startTesterStreamingSpeech() {
    stopTesterSpeech();
    testerSpeechGeneration += 1;
    testerSpeechActive = true;
    testerSpeechBuffer = '';
    testerSpeechQueue = [];
    testerSpeechQueueActive = false;
    testerBob?.think?.();
    setTesterFaceStatus('Listening for stream...');
  }

  function queueTesterStreamingSpeech(text) {
    if (!testerSpeechActive || !text) return;
    testerSpeechBuffer += String(text).replace(/\s+/g, ' ');
    drainTesterSpeechSentences();
  }

  function drainTesterSpeechSentences() {
    while (true) {
      const match = /[.!?](?=\s|$)/.exec(testerSpeechBuffer);
      const shouldSpeakLongChunk = !match && testerSpeechBuffer.length >= 220;
      if (!match && !shouldSpeakLongChunk) return;
      const chunkEnd = match ? match.index + 1 : testerSpeechBuffer.lastIndexOf(' ', 220);
      const safeEnd = chunkEnd > 0 ? chunkEnd : testerSpeechBuffer.length;
      const chunk = testerSpeechBuffer.slice(0, safeEnd).trim();
      testerSpeechBuffer = testerSpeechBuffer.slice(safeEnd).trimStart();
      if (chunk) enqueueTesterSpeech(chunk);
    }
  }

  function enqueueTesterSpeech(text) {
    testerSpeechQueue.push({ text, generation: testerSpeechGeneration });
    pumpTesterSpeechQueue();
  }

  function finishTesterStreamingSpeech() {
    if (!testerSpeechActive) return;
    const finalChunk = testerSpeechBuffer.trim();
    testerSpeechBuffer = '';
    testerSpeechActive = false;
    if (finalChunk) enqueueTesterSpeech(finalChunk);
    else if (!testerSpeechQueueActive && testerSpeechQueue.length === 0) {
      setTesterFaceSpeaking(false);
      testerBob?.idle?.();
      setTesterFaceStatus('Stream complete.');
    }
  }

  async function fetchTesterTtsManifest(text) {
    const params = window.__voicePreferences?.toParams
      ? window.__voicePreferences.toParams(null, text)
      : new URLSearchParams({ provider: 'piper', lang: 'en', text: text.slice(0, 4500) });
    params.set('visemes', '1');
    const response = await fetchWithAuthRedirect(`/api/tts?${params.toString()}`, { cache: 'no-store' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'TTS request failed');
    return json;
  }

  async function playTesterAudioUrls(urls = [], generation, spokenText = '') {
    for (const item of urls) {
      if (generation !== testerSpeechGeneration) return;
      const url = typeof item === 'string' ? item : item.url;
      const mouthText = typeof item === 'string' ? spokenText : item.text || spokenText;
      const visemes = typeof item === 'string' ? [] : Array.isArray(item.visemes) ? item.visemes : [];
      const audioResponse = await fetchWithAuthRedirect(url, { cache: 'no-store' });
      if (!audioResponse.ok) throw new Error(`TTS audio failed with HTTP ${audioResponse.status}`);
      const blob = await audioResponse.blob();
      const objectUrl = URL.createObjectURL(blob);
      testerSpeechObjectUrls.push(objectUrl);
      await new Promise((resolve, reject) => {
        testerSpeechAudio = new Audio(objectUrl);
        testerSpeechAudio.preload = 'auto';
        testerSpeechAudio.playsInline = true;
        setTesterFaceSpeaking(true);
        connectTesterSpeechAnalyser(testerSpeechAudio);
        testerBob?.speakText?.(mouthText, { audio: testerSpeechAudio, visemes });
        testerSpeechAudio.onended = () => {
          stopTesterSpeechMouth();
          testerBob?.stopVisemeSpeech?.();
          testerBob?.setMouthLevel?.(0);
          resolve();
        };
        testerSpeechAudio.onerror = () => {
          stopTesterSpeechMouth();
          testerBob?.stopVisemeSpeech?.();
          reject(new Error('Browser could not play generated tester audio'));
        };
        testerSpeechAudio.play().catch(reject);
      });
    }
  }

  function connectTesterSpeechAnalyser(audio) {
    if (!audio || !testerBob?.setMouthLevel) return;
    try {
      stopTesterSpeechMouth();
      testerSpeechAudioContext = testerSpeechAudioContext || new (window.AudioContext || window.webkitAudioContext)();
      if (testerSpeechAudioContext.state === 'suspended') testerSpeechAudioContext.resume();
      const source = testerSpeechAudioContext.createMediaElementSource(audio);
      testerSpeechAnalyser = testerSpeechAudioContext.createAnalyser();
      testerSpeechAnalyser.fftSize = 1024;
      testerSpeechDataArray = new Uint8Array(testerSpeechAnalyser.fftSize);
      source.connect(testerSpeechAnalyser);
      testerSpeechAnalyser.connect(testerSpeechAudioContext.destination);
      drawTesterSpeechMouth();
    } catch (err) {
      console.warn('Tester mouth analyser setup failed', err);
    }
  }

  function stopTesterSpeechMouth() {
    if (testerSpeechAnimationId) {
      cancelAnimationFrame(testerSpeechAnimationId);
      testerSpeechAnimationId = null;
    }
    testerSpeechAnalyser = null;
    testerSpeechDataArray = null;
  }

  function drawTesterSpeechMouth() {
    if (!testerSpeechAnalyser || !testerSpeechDataArray) return;
    testerSpeechAnalyser.getByteTimeDomainData(testerSpeechDataArray);
    const step = Math.max(1, Math.floor(testerSpeechDataArray.length / 120));
    let level = 0;
    let samples = 0;
    for (let i = 0; i < testerSpeechDataArray.length; i += step) {
      level += Math.abs(testerSpeechDataArray[i] - 128);
      samples += 1;
    }
    testerBob?.setMouthLevel?.(Math.min(1, (level / Math.max(1, samples)) / 30));
    testerSpeechAnimationId = requestAnimationFrame(drawTesterSpeechMouth);
  }

  function speakTesterBrowserChunk(text) {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 4500));
    utterance.lang = 'en-US';
    utterance.onstart = () => {
      setTesterFaceSpeaking(true);
      testerBob?.speakText?.(text, { durationMs: Math.max(650, text.length * 58) });
    };
    utterance.onend = () => {
      setTesterFaceSpeaking(false);
      testerBob?.idle?.();
    };
    utterance.onerror = () => setTesterFaceSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }

  async function pumpTesterSpeechQueue() {
    if (testerSpeechQueueActive) return;
    testerSpeechQueueActive = true;
    while (testerSpeechQueue.length > 0) {
      const item = testerSpeechQueue.shift();
      if (item.generation !== testerSpeechGeneration) continue;
      try {
        setTesterFaceStatus('Speaking streamed response...');
        const manifest = await fetchTesterTtsManifest(item.text);
        const urls = manifest.items || manifest.urls || (manifest.url ? [manifest.url] : []);
        await playTesterAudioUrls(urls, item.generation, item.text);
      } catch (err) {
        console.warn('Tester streamed speech failed', err);
        speakTesterBrowserChunk(item.text);
      }
    }
    testerSpeechQueueActive = false;
    if (!testerSpeechActive && testerSpeechQueue.length === 0) {
      setTesterFaceSpeaking(false);
      testerBob?.idle?.();
      setTesterFaceStatus('Stream complete.');
    }
  }

  function handleLiveStreamEvent(eventName, data, pending) {
    if (eventName === 'llm-live-status') {
      if (liveStatus) {
        liveStatus.textContent = data?.status || 'Running';
        liveStatus.dataset.state = 'busy';
      }
      return false;
    }
    if (eventName === 'llm-live-output') {
      if (liveStatus) {
        liveStatus.textContent = data?.skill || 'Streaming';
        liveStatus.dataset.state = 'busy';
      }
      appendLiveOutput(data?.chunk || '');
      return false;
    }
    if (eventName === 'llm-live-speech') {
      queueTesterStreamingSpeech(data?.speech || '');
      return false;
    }
    if (eventName === 'test-result') {
      if (!data?.ok) throw new Error(data?.error || 'Bob chat test failed');
      renderResult(data.data || {});
      if (pending) pending.textContent = data.data?.response || 'Bob returned an empty response.';
      const passed = Boolean(data.data?.validation?.valid);
      setStatus(passed ? 'Passed' : 'Failed', passed ? 'pass' : 'fail');
      if (liveStatus) {
        liveStatus.textContent = 'Complete';
        liveStatus.dataset.state = passed ? 'pass' : 'fail';
      }
      finishTesterStreamingSpeech();
      return true;
    }
    if (eventName === 'error') {
      throw new Error(data?.error || 'Bob chat streaming test failed');
    }
    return eventName === 'done';
  }

  async function readLiveTestStream(response, pending) {
    if (!response.ok) {
      let error = '';
      try {
        const json = await response.json();
        error = json.error || '';
      } catch (err) {
        error = await response.text().catch(() => '');
      }
      throw new Error(error || 'Bob chat test failed');
    }
    if (!response.body?.getReader) throw new Error('Streaming response is not available in this browser.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\n\n/);
      buffer = events.pop() || '';
      for (const rawEvent of events) {
        const lines = rawEvent.split(/\r?\n/);
        let eventName = 'message';
        const dataLines = [];
        lines.forEach(line => {
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
        });
        if (!dataLines.length) continue;
        const rawData = dataLines.join('\n');
        const data = rawData === '[DONE]' ? '[DONE]' : JSON.parse(rawData);
        if (handleLiveStreamEvent(eventName, data, pending)) return;
      }
    }
  }

  function getTraceStatusText(entry = {}) {
    const checks = entry.validation?.checks || entry.checks || [];
    const status = entry.contractValid ? 'Pass' : 'Check';
    if (!checks.length) return status;
    return [
      `${status} (${checks.filter(check => check.pass).length}/${checks.length})`,
      ...checks.map(check => `${check.pass ? 'PASS' : 'FAIL'} - ${check.label}`)
    ].join('\n');
  }

  function getTraceRunMetrics() {
    const data = lastResult || {};
    const timing = getTimingSummary(data);
    return [
      `Route: ${data.route?.skill || '-'}${data.route?.query ? ` (${data.route.query})` : ''}`,
      `Emotion: ${data.metadata?.emotion || '-'}`,
      `Latency: ${data.elapsedMs ? `${data.elapsedMs} ms` : '-'}`,
      `Model load: ${timing.loadMs !== null ? `${formatMs(timing.loadMs)}${timing.loadPct !== null ? ` (${timing.loadPct}%)` : ''}` : '-'}`
    ].join('\n');
  }

  function traceDialogSection(label, value) {
    const section = document.createElement('section');
    section.className = 'bob-chat-trace-dialog-section';
    const title = document.createElement('h5');
    title.textContent = label;
    const pre = document.createElement('pre');
    pre.textContent = value || '';
    section.append(title, pre);
    return section;
  }

  function showTraceDialog(entry = {}, { pinned = false } = {}) {
    if (traceDialogPinned && !pinned) return;
    removeTraceHoverDialog({ force: pinned });
    traceDialogPinned = pinned;
    traceHoverDialog = document.createElement('div');
    traceHoverDialog.className = `bob-chat-trace-dialog ${entry.contractValid ? 'pass' : 'fail'}${pinned ? ' pinned' : ''}`;
    traceHoverDialog.setAttribute('role', 'dialog');
    traceHoverDialog.setAttribute('aria-hidden', pinned ? 'false' : 'true');
    const title = document.createElement('div');
    title.className = 'bob-chat-trace-dialog-title';
    const titleText = document.createElement('span');
    titleText.textContent = formatSkillLabel(entry.skill);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'bob-chat-trace-dialog-close';
    close.setAttribute('aria-label', 'Close output dialog');
    close.innerHTML = '<i data-lucide="x"></i>';
    close.addEventListener('click', event => {
      event.stopPropagation();
      removeTraceHoverDialog({ force: true });
    });
    title.append(titleText, close);
    traceHoverDialog.append(
      title,
      traceDialogSection('Input', entry.input || ''),
      traceDialogSection('Expected JSON', pretty(entry.expectedContract || entry.contract || '')),
      traceDialogSection('Output', pretty(entry.output || '')),
      traceDialogSection('Run Metrics', getTraceRunMetrics()),
      traceDialogSection('Status', getTraceStatusText(entry))
    );
    document.body.appendChild(traceHoverDialog);
    window.__icons?.render?.(traceHoverDialog);
  }

  function removeTraceHoverDialog({ force = false } = {}) {
    if (traceDialogPinned && !force) return;
    traceHoverDialog?.remove();
    traceHoverDialog = null;
    traceDialogPinned = false;
  }

  function closePinnedTraceDialogFromOutside(event) {
    if (!traceDialogPinned || !traceHoverDialog) return;
    if (traceHoverDialog.contains(event.target) || event.target.closest?.('.bob-chat-trace-row')) return;
    removeTraceHoverDialog({ force: true });
  }

  function loadTesterContextChartJs() {
    if (window.Chart) return Promise.resolve(window.Chart);
    if (!window.__bobChartJsPromise) {
      window.__bobChartJsPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/vendor/chart.js/chart.umd.min.js';
        script.onload = () => resolve(window.Chart);
        script.onerror = () => reject(new Error('Chart.js failed to load'));
        document.head.appendChild(script);
      });
    }
    return window.__bobChartJsPromise;
  }

  function updateTesterContextStatus(text, title = '') {
    if (!testerContextStatus) return;
    testerContextStatus.textContent = text || 'CTX -';
    testerContextStatus.title = title || '';
  }

  async function renderTesterContextChart(metadata = {}) {
    if (!testerContextCanvas || !testerContextStatus) return;
    const ctx = metadata?.ctx;
    if (!ctx || typeof ctx !== 'object') {
      updateTesterContextStatus('CTX -');
      if (testerContextChart) {
        testerContextChart.data.datasets[0].data = [0];
        testerContextChart.data.datasets[1].data = [100];
        testerContextChart.update();
      }
      return;
    }

    const Chart = await loadTesterContextChartJs();
    const actual = Number(ctx.Actual);
    const estimated = Math.max(0, Number(ctx.Estimated ?? 0));
    const used = Number.isFinite(actual) && actual >= 0 ? actual : estimated;
    const max = Math.max(1, Number(ctx.modelContextTokens || 1));
    const percent = Math.max(0, Math.min(100, Math.round((used / max) * 100)));
    const freePercent = Math.max(0, 100 - percent);
    const triggerTokens = Math.max(0, Number(ctx.triggerTokens || 0));
    const isDue = triggerTokens > 0 && used >= triggerTokens;
    const usedColor = isDue ? 'rgba(255,154,90,0.82)' : 'rgba(0,224,255,0.82)';
    const tokenLabel = `${Math.round(used)}/${Math.round(max)} tokens`;

    updateTesterContextStatus(`CTX ${percent}%`, `${tokenLabel} (${ctx.tokenMethod || 'unknown'})`);

    const config = {
      type: 'bar',
      data: {
        labels: ['CTX'],
        datasets: [
          {
            label: 'Used',
            data: [percent],
            backgroundColor: usedColor,
            borderColor: usedColor,
            borderWidth: 1,
            borderRadius: 4,
            stack: 'ctx'
          },
          {
            label: 'Free',
            data: [freePercent],
            backgroundColor: 'rgba(255,255,255,0.055)',
            borderColor: 'rgba(255,255,255,0.08)',
            borderWidth: 1,
            borderRadius: 4,
            stack: 'ctx'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: context => `${context.dataset.label}: ${Math.round(context.raw)}%`,
              afterBody: () => [
                tokenLabel,
                `Trigger: ${Math.round(triggerTokens)} tokens`,
                `Method: ${ctx.tokenMethod || 'unknown'}`
              ]
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            display: false,
            grid: { display: false },
            border: { display: false }
          },
          y: {
            stacked: true,
            min: 0,
            max: 100,
            display: false,
            grid: { display: false },
            border: { display: false }
          }
        }
      }
    };

    if (testerContextChart) {
      testerContextChart.data = config.data;
      testerContextChart.options = config.options;
      testerContextChart.update();
      return;
    }

    testerContextChart = new Chart(testerContextCanvas, config);
  }

  function renderResult(data = {}) {
    lastResult = data;
    debugCopy?.removeAttribute('disabled');
    renderValidation(data.validation || {}, data.metadata || {});
    renderTrace(data.llm || []);
    renderTesterContextChart(data.metadata || {});
  }

  function formatModelBytes(bytes) {
    const number = Number(bytes);
    if (!Number.isFinite(number) || number <= 0) return '-';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = number;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  function formatProcessorInfo(model = {}) {
    const processor = String(model.processor || '').trim();
    const size = Number(model.size);
    const sizeVram = Number(model.sizeVram || model.size_vram);
    const detail = [
      `Total ${formatModelBytes(size)}`,
      `VRAM ${formatModelBytes(sizeVram)}`
    ].join(' | ');
    if (processor) {
      const lower = processor.toLowerCase();
      return {
        label: processor,
        detail,
        state: lower.includes('gpu') && !/^0%\s*gpu/.test(lower) ? 'gpu' : lower.includes('cpu') ? 'cpu' : 'unknown',
        title: `Ollama /api/ps processor: ${processor}. ${detail}`
      };
    }
    if (Number.isFinite(size) && size > 0 && Number.isFinite(sizeVram) && sizeVram >= 0) {
      const pct = Math.round((sizeVram / size) * 100);
      return {
        label: pct > 0 ? `${pct}% VRAM` : 'CPU',
        detail,
        state: pct > 0 ? 'gpu' : 'cpu',
        title: `Ollama did not report processor. Estimated from size_vram: ${detail}`
      };
    }
    return {
      label: 'Processor unknown',
      detail,
      state: 'unknown',
      title: 'Ollama did not report processor or VRAM placement for this model.'
    };
  }

  function formatModelActivityReasons(model = {}) {
    const reasons = Array.isArray(model.activeReasons) ? model.activeReasons : [];
    const labels = reasons
      .map(item => {
        const reason = String(item.reason || '').trim();
        if (!reason) return '';
        const count = Number(item.count || 0);
        const age = formatActivityAge(item.oldestStartedAt);
        const label = modelActivityLabel(reason);
        const countText = count > 1 ? ` (${count})` : '';
        return `${label}${countText}${age ? ` ${age}` : ''}`;
      })
      .filter(Boolean);
    return labels.length ? labels.join(', ') : 'active request';
  }

  function formatActivityAge(value) {
    if (!value) return '';
    const started = new Date(value).getTime();
    if (!Number.isFinite(started)) return '';
    const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
    if (seconds < 1) return '';
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = String(seconds % 60).padStart(2, '0');
    return `${minutes}:${remainder}`;
  }

  function modelActivityLabel(reason = '') {
    const normalized = String(reason || '').trim();
    const labels = {
      'router-stage': 'router',
      'bob-chat-response': 'response',
      'memory-factoids': 'memory factoids',
      'memory-summary': 'memory summary',
      'manual-load': 'manual load',
      'manual-unload': 'manual unload'
    };
    return labels[normalized] || normalized || 'active request';
  }

  function isBackgroundModelActivity(reason = '') {
    return /^memory-/i.test(String(reason || '').trim());
  }

  function getModelActivityCounts(model = {}) {
    const reasons = Array.isArray(model.activeReasons) ? model.activeReasons : [];
    return reasons.reduce((counts, item) => {
      const count = Math.max(0, Number(item.count || 0));
      if (!count) return counts;
      if (isBackgroundModelActivity(item.reason)) counts.background += count;
      else counts.foreground += count;
      return counts;
    }, { foreground: 0, background: 0 });
  }

  function formatModelStatusTime(value) {
    if (!value) return 'expiry not reported';
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) return 'expiry not reported';
    const deltaMs = time - Date.now();
    if (deltaMs <= 0) return 'unload due';
    const totalSeconds = Math.ceil(deltaMs / 1000);
    if (totalSeconds < 3600) {
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = String(totalSeconds % 60).padStart(2, '0');
      return `unloads in ${minutes}:${seconds}`;
    }
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.ceil((totalSeconds % 3600) / 60);
    return `unloads in ${hours}h ${String(minutes).padStart(2, '0')}m`;
  }

  function tickModelUnloadCountdowns() {
    modelStatusList?.querySelectorAll('[data-unload-countdown]').forEach(element => {
      const text = formatModelStatusTime(element.dataset.unloadCountdown);
      element.textContent = text;
      element.classList.toggle('expired', text === 'unload due');
    });
  }

  function setModelStatusState(label, state = 'idle') {
    if (!modelStatusState) return;
    modelStatusState.textContent = label;
    modelStatusState.dataset.state = state;
  }

  function renderModelStatus(snapshot = {}) {
    const data = snapshot.data || {};
    const running = Array.isArray(data.running) ? data.running : [];
    const loaded = running.filter(model => model.loaded !== false);
    const activeCount = running.reduce((sum, model) => sum + getModelActivityCounts(model).foreground, 0);
    const backgroundCount = running.reduce((sum, model) => sum + getModelActivityCounts(model).background, 0);
    const version = data.version?.version || 'unknown';
    const updated = snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleTimeString() : '-';
    const hasErrors = Boolean(data.errors?.running || data.errors?.models || data.errors?.version);

    setModelStatusState(snapshot.ok ? (hasErrors ? 'Partial' : 'Live') : 'Error', snapshot.ok ? (hasErrors ? 'busy' : 'pass') : 'fail');

    if (modelStatusSummary) {
      modelStatusSummary.innerHTML = `
        <div class="metric"><span>Installed</span><strong>${escapeHtml(data.installedCount ?? data.models?.length ?? 0)}</strong></div>
        <div class="metric"><span>Loaded</span><strong>${escapeHtml(loaded.length)}</strong></div>
        <div class="metric"><span>${backgroundCount ? 'Busy / Memory' : 'Busy'}</span><strong>${escapeHtml(backgroundCount ? `${activeCount} / ${backgroundCount}` : activeCount)}</strong></div>
        <div class="metric"><span>Updated</span><strong>${escapeHtml(updated)}</strong></div>
      `;
    }

    if (!modelStatusList) return;
    if (!running.length) {
      const error = data.errors?.running || (!snapshot.ok ? 'Ollama status unavailable' : '');
      modelStatusList.innerHTML = `<div class="bob-chat-model-status-empty">${escapeHtml(error || `No models loaded. Ollama ${version}.`)}</div>`;
      return;
    }

    const rows = running
      .slice()
      .sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || String(a.name || a.model).localeCompare(String(b.name || b.model)))
      .map(model => {
        const name = model.name || model.model || 'unknown';
        const counts = getModelActivityCounts(model);
        const foregroundActive = counts.foreground > 0 || (model.active && counts.foreground === 0 && counts.background === 0);
        const backgroundActive = !foregroundActive && counts.background > 0;
        const state = foregroundActive ? 'running' : backgroundActive ? 'background' : 'loaded';
        const processor = formatProcessorInfo(model);
        const expiry = formatModelStatusTime(model.expiresAt);
        const expiryAttr = escapeHtml(model.expiresAt || '');
        const visibleActiveCount = foregroundActive ? (counts.foreground || Number(model.activeCount || 1)) : counts.background;
        const activeText = visibleActiveCount > 1 ? ` (${visibleActiveCount})` : '';
        const activity = model.active ? ` - ${formatModelActivityReasons(model)}` : '';
        const unloadLabel = model.active ? 'Unload active model' : 'Unload loaded model';
        const stateLabel = foregroundActive ? `Busy${escapeHtml(activeText)}` : backgroundActive ? `Memory${escapeHtml(activeText)}` : 'Loaded';
        return `
          <div class="bob-chat-model-status-row ${state}">
            <div>
              <strong>${escapeHtml(name)}</strong>
              <small>
                <span class="bob-chat-model-processor ${escapeHtml(processor.state)}" title="${escapeHtml(processor.title)}">${escapeHtml(processor.label)}</span>
                <span>${escapeHtml(processor.detail)}${escapeHtml(activity)} - <span class="bob-chat-model-countdown" data-unload-countdown="${expiryAttr}">${escapeHtml(expiry)}</span></span>
              </small>
            </div>
            <div class="bob-chat-model-actions">
              <span class="bob-chat-model-state ${state}">${stateLabel}</span>
              <button class="bob-chat-model-unload" type="button" data-unload-model="${escapeHtml(name)}" title="${escapeHtml(unloadLabel)}">
                <i data-lucide="power"></i>
                Unload
              </button>
            </div>
          </div>
        `;
      })
      .join('');
    modelStatusList.innerHTML = rows;
    modelStatusList.querySelectorAll('[data-unload-model]').forEach(button => {
      button.addEventListener('click', () => unloadModel(button.dataset.unloadModel || '', button));
    });
    window.__icons?.render?.(modelStatusList);
    tickModelUnloadCountdowns();
  }

  function memoryDateTime(message = {}) {
    return message.dateTime || message.created_at || message.createdAt || message.timestamp || '';
  }

  async function unloadModel(model, button) {
    const name = String(model || '').trim();
    if (!name) return;
    button?.setAttribute('disabled', '');
    setModelStatusState('Unloading', 'busy');
    try {
      const response = await fetchWithAuthRedirect('/api/ollama/unload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: name })
      });
      const json = await response.json();
      if (!json.ok) throw new Error(json.error || `Could not unload ${name}`);
      setModelStatusState('Unload sent', 'busy');
    } catch (err) {
      setModelStatusState('Unload failed', 'fail');
      await window.__dialog?.alert?.({ title: 'Unload Failed', message: err.message });
      button?.removeAttribute('disabled');
    }
  }

  function startModelStatusCountdown() {
    if (window.__bobChatModelCountdownTimer) {
      clearInterval(window.__bobChatModelCountdownTimer);
      window.__bobChatModelCountdownTimer = null;
    }
    if (modelStatusCountdownTimer) {
      clearInterval(modelStatusCountdownTimer);
      modelStatusCountdownTimer = null;
    }
    modelStatusCountdownTimer = setInterval(tickModelUnloadCountdowns, 1000);
    window.__bobChatModelCountdownTimer = modelStatusCountdownTimer;
  }

  function startModelStatusStream() {
    if (!modelStatusState || !modelStatusSummary || !modelStatusList || typeof EventSource === 'undefined') return;
    if (window.__bobChatModelStatusSource) {
      window.__bobChatModelStatusSource.close();
      window.__bobChatModelStatusSource = null;
    }
    setModelStatusState('Connecting', 'busy');
    modelStatusSummary.innerHTML = `
      <div class="metric"><span>Installed</span><strong>-</strong></div>
      <div class="metric"><span>Loaded</span><strong>-</strong></div>
      <div class="metric"><span>Running</span><strong>-</strong></div>
      <div class="metric"><span>Updated</span><strong>-</strong></div>
    `;
    modelStatusList.innerHTML = '<div class="bob-chat-model-status-empty">Waiting for model status events...</div>';
    startModelStatusCountdown();

    modelStatusSource = new EventSource('/api/ollama/model-status/stream');
    window.__bobChatModelStatusSource = modelStatusSource;
    modelStatusSource.addEventListener('model-status', event => {
      try {
        renderModelStatus(JSON.parse(event.data || '{}'));
      } catch (err) {
        setModelStatusState('Bad event', 'fail');
      }
    });
    modelStatusSource.addEventListener('error', () => {
      setModelStatusState('Disconnected', 'fail');
    });
  }

  function compactMetadata(metadata = {}) {
    const { skillDebug, ...rest } = metadata || {};
    return skillDebug ? { ...rest, skillDebug: `[${skillDebug.length} trace entries omitted; see LLM Inputs and Outputs]` } : rest;
  }

  function nsToMs(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number / 1_000_000 : null;
  }

  function formatMs(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '-';
    if (number >= 1000) return `${(number / 1000).toFixed(2)} s`;
    return `${Math.round(number)} ms`;
  }

  function normalizeMs(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function getTimingSummary(data = {}) {
    if (data.usage?.timing) {
      const timing = data.usage.timing;
      const totalMs = normalizeMs(timing.totalMs);
      const loadMs = normalizeMs(timing.loadMs);
      const generationMs = normalizeMs(timing.generationMs);
      const loadPct = totalMs && loadMs !== null ? Math.round((loadMs / totalMs) * 100) : null;
      return { totalMs, loadMs, generationMs, loadPct };
    }
    const totalMs = nsToMs(data.usage?.totalDuration);
    const loadMs = nsToMs(data.usage?.loadDuration);
    const generationMs = totalMs !== null && loadMs !== null ? Math.max(0, totalMs - loadMs) : null;
    const loadPct = totalMs && loadMs !== null ? Math.round((loadMs / totalMs) * 100) : null;
    return { totalMs, loadMs, generationMs, loadPct };
  }

  function resetTester() {
    if (isRunning) return;
    stopTesterSpeech();
    lastPrompt = '';
    lastResult = null;
    if (messages) messages.replaceChildren();
    if (promptInput) promptInput.value = '';
    if (contractBadge) {
      contractBadge.className = 'bob-chat-contract-badge idle';
      contractBadge.textContent = 'Not tested';
    }
    if (debugCopy) debugCopy.setAttribute('disabled', '');
    renderTrace();
    renderTesterContextChart({});
    resetLiveOutput();
    setStatus('Idle');
  }

  function buildDebugCopyText(data = lastResult) {
    if (!data) return '';
    const timing = getTimingSummary(data);
    const checks = (data.validation?.checks || [])
      .map(check => `${check.pass ? 'PASS' : 'FAIL'} - ${check.label}`)
      .join('\n');
    const trace = (data.llm || []).map(entry => [
      `================ ${formatSkillLabel(entry.skill).toUpperCase()} ================`,
      `CONTRACT: ${entry.contractValid ? 'OK' : 'CHECK'}`,
      '---- INPUT ----',
      entry.input || '',
      '---- OUTPUT ----',
      pretty(entry.output || ''),
      '---- PARSED ----',
      pretty(entry.parsed || {})
    ].join('\n')).join('\n\n');

    return [
      'BOB CHAT TEST DEBUG',
      `MODEL: ${data.model || modelSelect?.value || ''}`,
      data.requestedModel && data.requestedModel !== data.model ? `REQUESTED MODEL: ${data.requestedModel}` : '',
      data.routerModel ? `ROUTER MODEL: ${data.routerModel}` : '',
      data.modelRoute?.reason ? `MODEL ROUTE: ${data.modelRoute.reason}` : '',
      data.modelRules ? `MODEL RULES: ${JSON.stringify(data.modelRules)}` : '',
      `PROMPT: ${data.prompt || lastPrompt || ''}`,
      `RESULT: ${data.validation?.valid ? 'CONTRACT MET' : data.metadata?.fallbackApplied ? 'FALLBACK APPLIED' : 'CONTRACT FAILED'}`,
      `ROUTE: ${data.route?.skill || ''}${data.route?.query ? ` (${data.route.query})` : ''}`,
      `EMOTION: ${data.metadata?.emotion || ''}`,
      `LATENCY: ${data.elapsedMs || ''} ms`,
      timing.loadMs !== null ? `MODEL LOAD: ${formatMs(timing.loadMs)}${timing.loadPct !== null ? ` (${timing.loadPct}% of generation)` : ''}` : '',
      timing.generationMs !== null ? `MODEL GENERATION: ${formatMs(timing.generationMs)}` : '',
      timing.totalMs !== null ? `OLLAMA TOTAL: ${formatMs(timing.totalMs)}` : '',
      '',
      'EXPECTED JSON CONTRACT',
      pretty(data.expectedContract || {}),
      '',
      'CONTRACT CHECKS',
      checks || '(none)',
      '',
      'PARSED RESPONSE',
      pretty({
        response: data.response || '',
        metadata: compactMetadata(data.metadata || {})
      }),
      '',
      'LLM INPUTS AND OUTPUTS',
      trace || '(none)'
    ].filter((line, index, lines) => line || lines[index - 1]).join('\n');
  }

  function buildLlmIoCopyText(data = lastResult) {
    const entries = data?.llm || [];
    if (!entries.length) return '';
    return [
      'BOB LLM INPUTS AND OUTPUTS',
      `MODEL: ${data.model || modelSelect?.value || ''}`,
      data.requestedModel && data.requestedModel !== data.model ? `REQUESTED MODEL: ${data.requestedModel}` : '',
      data.routerModel ? `ROUTER MODEL: ${data.routerModel}` : '',
      `PROMPT: ${data.prompt || lastPrompt || ''}`,
      `ROUTE: ${data.route?.skill || ''}${data.route?.query ? ` (${data.route.query})` : ''}`,
      '',
      ...entries.flatMap(entry => [
        `================ ${formatSkillLabel(entry.skill).toUpperCase()} ================`,
        `STATUS: ${entry.contractValid ? 'PASS' : 'CHECK'}`,
        '---- EXPECTED JSON ----',
        pretty(entry.expectedContract || entry.contract || ''),
        '---- INPUT ----',
        entry.input || '',
        '---- OUTPUT ----',
        pretty(entry.output || ''),
        '---- PARSED ----',
        pretty(entry.parsed || {}),
        '---- VALIDATION ----',
        pretty(entry.validation || entry.checks || {}),
        ''
      ])
    ].filter((line, index, lines) => line || lines[index - 1]).join('\n');
  }

  async function copyDebug() {
    const text = buildDebugCopyText();
    if (!text) return;
    const previous = debugCopy?.innerHTML;
    try {
      await copyText(text);
      if (debugCopy) debugCopy.innerHTML = '<i data-lucide="check"></i> Copied';
      window.__icons?.render?.(debugCopy);
      setTimeout(() => {
        if (!debugCopy || previous === undefined) return;
        debugCopy.innerHTML = previous;
        window.__icons?.render?.(debugCopy);
      }, 1400);
    } catch (err) {
      await window.__dialog?.alert?.({ title: 'Debug Copy Failed', message: err.message });
    }
  }

  async function copyLlmIo() {
    const text = buildLlmIoCopyText();
    if (!text) return;
    const previous = llmCopy?.innerHTML;
    try {
      await copyText(text);
      if (llmCopy) llmCopy.innerHTML = '<i data-lucide="check"></i> Copied';
      window.__icons?.render?.(llmCopy);
      setTimeout(() => {
        if (!llmCopy || previous === undefined) return;
        llmCopy.innerHTML = previous;
        window.__icons?.render?.(llmCopy);
      }, 1400);
    } catch (err) {
      await window.__dialog?.alert?.({ title: 'LLM IO Copy Failed', message: err.message });
    }
  }

  async function runTest(rawPrompt) {
    const prompt = String(rawPrompt || promptInput?.value || '').trim();
    const model = modelSelect?.value || '';
    if (!prompt || !model || isRunning) return;
    lastPrompt = prompt;
    localStorage.setItem(selectedModelKey, model);
    addMessage('user', prompt);
    const pending = addMessage('bot', 'Testing...');
    setRunning(true);
    setStatus('Running', 'busy');
    resetLiveOutput('Starting', 'busy');
    startTesterStreamingSpeech();

    try {
      const response = await fetchWithAuthRedirect('/api/admin/bob-chat-test/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, modelRules: readModelRules() })
      });
      await readLiveTestStream(response, pending);
    } catch (err) {
      if (pending) pending.textContent = err.message;
      setStatus('Error', 'fail');
      stopTesterSpeech();
      testerBob?.setEmotion?.('error');
      setTesterFaceStatus(`Stream error: ${err.message}`);
      if (liveStatus) {
        liveStatus.textContent = 'Error';
        liveStatus.dataset.state = 'fail';
      }
      if (contractBadge) {
        contractBadge.className = 'bob-chat-contract-badge fail';
        contractBadge.textContent = 'Request failed';
      }
    } finally {
      setRunning(false);
    }
  }

  async function loadStageDefinition(stage) {
    const params = new URLSearchParams({
      stage,
      prompt: stageChatInputValue()
    });
    const response = await fetchWithAuthRedirect(`/api/admin/bob-chat-stage?${params}`, { cache: 'no-store' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Could not load stage definition');
    return json.data || {};
  }

  function stageChatInputValue() {
    return promptInput?.value || lastPrompt || '';
  }

  async function renderStageDefinition(stage, fields = {}, options = {}) {
    const response = await fetchWithAuthRedirect('/api/admin/bob-chat-stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stage,
        prompt: promptInput?.value || lastPrompt || '',
        persist: Boolean(options.persist),
        render: options.render || '',
        ...fields
      })
    });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Could not render stage definition');
    return json.data || {};
  }

  async function loadSkillDefinition(skill) {
    const params = new URLSearchParams({
      skill,
      prompt: stageChatInputValue()
    });
    const response = await fetchWithAuthRedirect(`/api/admin/bob-chat-skill?${params}`, { cache: 'no-store' });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Could not load skill definition');
    return json.data || {};
  }

  async function renderSkillDefinition(skill, fields = {}, options = {}) {
    const response = await fetchWithAuthRedirect('/api/admin/bob-chat-skill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skill,
        prompt: promptInput?.value || lastPrompt || '',
        persist: Boolean(options.persist),
        render: options.render || '',
        ...fields
      })
    });
    const json = await response.json();
    if (!json.ok) throw new Error(json.error || 'Could not render skill definition');
    return json.data || {};
  }

  function insertStageTag(textarea, tag) {
    if (!textarea || !tag) return;
    const start = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : textarea.value.length;
    const end = Number.isFinite(textarea.selectionEnd) ? textarea.selectionEnd : start;
    textarea.focus();
    textarea.setRangeText(tag, start, end, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function wireStageTags(overlay, fields) {
    let activeField = fields.find(Boolean) || null;
    fields.filter(Boolean).forEach(field => {
      field.addEventListener('focus', () => {
        activeField = field;
      });
      field.addEventListener('dragover', event => {
        if (!event.dataTransfer?.types?.includes('text/plain')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      });
      field.addEventListener('drop', event => {
        const tag = event.dataTransfer?.getData('text/plain');
        if (!tag) return;
        event.preventDefault();
        activeField = field;
        insertStageTag(field, tag);
      });
    });

    overlay.querySelectorAll('[data-stage-tag]').forEach(button => {
      const tag = button.getAttribute('data-stage-tag') || '';
      button.addEventListener('click', () => insertStageTag(activeField, tag));
      button.addEventListener('dragstart', event => {
        event.dataTransfer?.setData('text/plain', tag);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
      });
    });
  }

  function definitionTitle(kind, name) {
    if (kind === 'skill') return name === 'web-search' ? 'Web Search Skill' : 'Bob Chat Skill';
    return name === 'router' ? 'Router Stage' : 'Response Stage';
  }

  function definitionIcon(kind, name) {
    if (kind === 'skill') return name === 'web-search' ? 'search' : 'message-square-text';
    return name === 'router' ? 'route' : 'braces';
  }

  function buildStageDialogShell(name, kind = 'stage') {
    const title = definitionTitle(kind, name);
    const overlay = document.createElement('div');
    overlay.className = 'hal-dialog-overlay bob-stage-dialog-overlay';
    overlay.innerHTML = `
      <div class="hal-dialog bob-stage-dialog" role="dialog" aria-modal="true" aria-labelledby="bobStageDialogTitle">
        <div class="hal-dialog-header">
          <span class="hal-dialog-mark"><i data-lucide="${definitionIcon(kind, name)}"></i></span>
          <h2 id="bobStageDialogTitle">${title}</h2>
          <button class="bob-stage-close" type="button" aria-label="Close"><i data-lucide="x"></i></button>
        </div>
        <div class="bob-stage-status">Loading ${kind} definition...</div>
        <div class="bob-stage-tags" aria-label="Supported tags">
          <span>Tags</span>
          ${supportedStageTags.map(tag => `
            <button type="button" draggable="true" data-stage-tag="${tag.value}" title="${tag.title}">
              ${tag.label}
            </button>
          `).join('')}
        </div>
        <label class="bob-stage-chat-input">
          <span>[CHAT INPUT]</span>
          <textarea data-stage-chat-input rows="3" placeholder="Message used when rendering [CHAT INPUT]."></textarea>
        </label>
        <div class="bob-stage-grid">
          <label>
            <span>JSON input structure</span>
            <textarea data-stage-field="inputTemplate" spellcheck="false"></textarea>
          </label>
          <label>
            <span>JSON output structure</span>
            <textarea data-stage-field="outputTemplate" spellcheck="false"></textarea>
          </label>
          <label class="bob-stage-wide">
            <span>Instructions</span>
            <textarea data-stage-field="skillDescription" spellcheck="false"></textarea>
          </label>
        </div>
        <div class="bob-stage-actions">
          <button type="button" data-stage-render><i data-lucide="refresh-cw"></i> Render Input</button>
          <button type="button" data-stage-save><i data-lucide="save"></i> Save Definition</button>
        </div>
        <pre class="bob-stage-preview"></pre>
      </div>
    `;
    return overlay;
  }

  async function openDefinitionDialog(kind, name) {
    const isSkill = kind === 'skill';
    const loadDefinition = isSkill ? loadSkillDefinition : loadStageDefinition;
    const renderDefinition = isSkill ? renderSkillDefinition : renderStageDefinition;
    const overlay = buildStageDialogShell(name, kind);
    const dialog = overlay.querySelector('.bob-stage-dialog');
    const status = overlay.querySelector('.bob-stage-status');
    const chatInput = overlay.querySelector('[data-stage-chat-input]');
    const input = overlay.querySelector('[data-stage-field="inputTemplate"]');
    const output = overlay.querySelector('[data-stage-field="outputTemplate"]');
    const skill = overlay.querySelector('[data-stage-field="skillDescription"]');
    const preview = overlay.querySelector('.bob-stage-preview');
    const close = () => overlay.remove();
    const stageChatPrompt = () => String(chatInput?.value || '').trim();
    const populate = data => {
      input.value = pretty(data.inputTemplate);
      output.value = pretty(data.outputTemplate);
      skill.value = String(data.skillDescription || '');
      preview.textContent = pretty({
        file: data.persistedPath,
        tags: data.tags,
        rendered: data.rendered
      });
    };
    const render = async (useCurrentFields = true) => {
      try {
        status.textContent = 'Rendering input from server data...';
        const data = await renderDefinition(name, useCurrentFields ? {
          inputTemplate: input.value,
          prompt: stageChatPrompt()
        } : {}, { render: 'input' });
        if (!useCurrentFields) populate(data);
        preview.textContent = pretty({
          file: data.persistedPath,
          tags: data.tags,
          input: data.rendered?.input
        });
        status.textContent = `Rendered ${data.title || definitionTitle(kind, name)} input. Tags: ${data.tags?.supported?.join(', ') || 'none'}.`;
      } catch (err) {
        status.textContent = err.message;
      }
    };
    const save = async () => {
      try {
        status.textContent = 'Saving server definition...';
        const data = await renderDefinition(name, {
          inputTemplate: input.value,
          outputTemplate: output.value,
          skillDescription: skill.value,
          prompt: stageChatPrompt()
        }, { persist: true });
        populate(data);
        status.textContent = `Saved ${data.title || definitionTitle(kind, name)} to ${data.persistedPath || 'server persistence file'}.`;
      } catch (err) {
        status.textContent = err.message;
      }
    };

    overlay.querySelector('.bob-stage-close')?.addEventListener('click', close);
    overlay.querySelector('[data-stage-render]')?.addEventListener('click', () => render(true));
    overlay.querySelector('[data-stage-save]')?.addEventListener('click', save);
    wireStageTags(overlay, [input, output, skill]);
    overlay.addEventListener('pointerdown', event => {
      if (event.target === overlay) close();
    });
    document.body.appendChild(overlay);
    if (chatInput) chatInput.value = stageChatInputValue();
    window.__icons?.render?.(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    try {
      status.textContent = 'Loading server definition...';
      populate(await loadDefinition(name));
      status.textContent = `Loaded ${definitionTitle(kind, name)} from server persistence.`;
    } catch (err) {
      status.textContent = err.message;
    }
  }

  function openStageDialog(stage) {
    return openDefinitionDialog('stage', stage);
  }

  function openSkillDialog(skill) {
    return openDefinitionDialog('skill', skill);
  }

  renderPresets();
  renderTrace();
  resetLiveOutput();
  loadModelRules();
  startModelStatusStream();
  form?.addEventListener('submit', event => {
    event.preventDefault();
    runTest();
  });
  rerunButton?.addEventListener('click', () => runTest(lastPrompt || promptInput?.value || presets[0]));
  clearButton?.addEventListener('click', resetTester);
  testerMemoryBrain?.addEventListener('click', () => window.__bobMemoryDialog?.open?.());
  routerStageButton?.addEventListener('click', () => openStageDialog('router'));
  responseStageButton?.addEventListener('click', () => openStageDialog('response'));
  bobChatSkillButton?.addEventListener('click', () => openSkillDialog('bob-chat'));
  webSearchSkillButton?.addEventListener('click', () => openSkillDialog('web-search'));
  debugCopy?.addEventListener('click', copyDebug);
  llmCopy?.addEventListener('click', copyLlmIo);
  refreshModels?.addEventListener('click', loadModels);
  modelSelect?.addEventListener('change', () => localStorage.setItem(selectedModelKey, modelSelect.value));
  Object.values(ruleInputs).filter(Boolean).forEach(input => input.addEventListener('change', saveModelRules));
  if (window.__bobChatTraceOutsideHandler) {
    document.removeEventListener('pointerdown', window.__bobChatTraceOutsideHandler, true);
  }
  window.__bobChatTraceOutsideHandler = closePinnedTraceDialogFromOutside;
  document.addEventListener('pointerdown', window.__bobChatTraceOutsideHandler, true);
  loadModels();
  window.__icons?.render?.(mainPage);
}
