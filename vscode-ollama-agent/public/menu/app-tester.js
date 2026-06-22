// Admin-only app tester pages.
function initAppTester() {
  const face = byId('testerBobFace');
  const textInput = byId('bobVoiceText');
  const speakButton = byId('bobVoiceSpeak');
  const stopButton = byId('bobVoiceStop');
  const applyServerButton = byId('bobVoiceApplyServer');
  const status = byId('bobVoiceStatus');
  const provider = byId('bobVoiceProvider');
  const engine = byId('bobVoiceEngine');
  const voiceLang = byId('bobVoiceLang');
  const piperSpeaker = byId('bobPiperSpeaker');
  const piperLengthScale = byId('bobPiperLengthScale');
  const piperNoiseScale = byId('bobPiperNoiseScale');
  const piperNoiseW = byId('bobPiperNoiseW');
  const waveform = byId('bobVoiceWaveform');
  const lookPad = byId('bobLookPad');
  const lookDot = byId('bobLookDot');
  const currentLookDot = byId('bobCurrentLookDot');
  const bob = window.BobExpressionEngine && face ? new window.BobExpressionEngine(face) : null;

  let audio;
  let audioContext;
  let analyser;
  let dataArray;
  let animationId;
  let lookAnimationId;
  let manualLookTimeout;
  let objectUrls = [];

  const setStatus = message => {
    if (status) status.textContent = message;
  };

  const currentVoicePreferences = () => ({
    provider: 'piper',
    lang: voiceLang?.value || 'en',
    piperSpeaker: piperSpeaker?.value || '',
    piperLengthScale: piperLengthScale?.value || '',
    piperNoiseScale: piperNoiseScale?.value || '',
    piperNoiseW: piperNoiseW?.value || ''
  });

  const saveVoicePreferences = () => {
    return window.__voicePreferences?.write?.(currentVoicePreferences()) || currentVoicePreferences();
  };

  const setActive = isActive => {
    mainPage.querySelector('.tester-bob-card')?.classList.toggle('active', isActive);
    if (isActive) bob?.startSpeaking();
    else bob?.stopSpeaking();
    if (!isActive && animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  };

  const stop = () => {
    if (audio) {
      audio.pause();
      audio.src = '';
      audio = null;
    }
    objectUrls.forEach(url => URL.revokeObjectURL(url));
    objectUrls = [];
    setActive(false);
    setStatus('Stopped.');
  };

  const drawWaveform = () => {
    if (!waveform || !analyser || !dataArray) return;

    const ctx = waveform.getContext('2d');
    const width = waveform.width;
    const height = waveform.height;
    analyser.getByteTimeDomainData(dataArray);

    ctx.clearRect(0, 0, width, height);
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#b7a7ff';

    const step = Math.max(1, Math.floor(dataArray.length / width));
    let x = 0;
    let level = 0;
    for (let index = 0; index < dataArray.length; index += step) {
      level += Math.abs(dataArray[index] - 128);
      const y = (dataArray[index] / 255) * height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += 1;
    }
    ctx.stroke();
    bob?.setMouthLevel(Math.min(1, (level / Math.max(1, x)) / 30));

    animationId = requestAnimationFrame(drawWaveform);
  };

  const setLookPosition = (x = 0, y = 0) => {
    const clampedX = Math.max(-1, Math.min(1, Number(x) || 0));
    const clampedY = Math.max(-1, Math.min(1, Number(y) || 0));
    bob?.setLookVector?.(clampedX, clampedY);
    lookPad?.classList.add('manual-look-active');
    clearTimeout(manualLookTimeout);
    manualLookTimeout = setTimeout(() => {
      bob?.setLook?.('idle');
      lookPad?.classList.remove('manual-look-active');
    }, 10000);
    if (lookDot) {
      lookDot.style.left = `${50 + clampedX * 44}%`;
      lookDot.style.top = `${50 + clampedY * 44}%`;
    }
    lookPad?.setAttribute('aria-valuetext', `x ${clampedX.toFixed(2)}, y ${clampedY.toFixed(2)}`);
  };

  const updateCurrentLookDot = () => {
    const current = bob?.getRenderedLookVector?.();
    if (currentLookDot && current) {
      currentLookDot.style.left = `${50 + current.x * 44}%`;
      currentLookDot.style.top = `${50 + current.y * 44}%`;
    }
    lookAnimationId = requestAnimationFrame(updateCurrentLookDot);
  };

  const setLookFromPointer = event => {
    if (!lookPad) return;
    const rect = lookPad.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    setLookPosition(x, y);
  };

  const connectWaveform = () => {
    if (!waveform || !audio) return;

    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();
      const source = audioContext.createMediaElementSource(audio);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      dataArray = new Uint8Array(analyser.fftSize);
      source.connect(analyser);
      analyser.connect(audioContext.destination);
      drawWaveform();
    } catch (err) {
      console.warn('Tester waveform setup failed', err);
    }
  };

  const replaceOptions = (select, options, selectedValue = '', defaultLabel = 'Default') => {
    if (!select) return;
    const normalized = Array.isArray(options) ? options : [];
    const optionNodes = [];
    if (defaultLabel) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = defaultLabel;
      optionNodes.push(option);
    }
    normalized.forEach(item => {
      const option = document.createElement('option');
      if (item && typeof item === 'object') {
        option.value = String(item.value ?? '');
        option.textContent = String(item.label || item.value || 'Default');
      } else {
        option.value = String(item ?? '');
        option.textContent = String(item ?? '');
      }
      optionNodes.push(option);
    });
    if (selectedValue && !optionNodes.some(option => option.value === selectedValue)) {
      const option = document.createElement('option');
      option.value = selectedValue;
      option.textContent = selectedValue;
      optionNodes.push(option);
    }
    select.replaceChildren(...optionNodes);
    select.value = optionNodes.some(option => option.value === selectedValue) ? selectedValue : '';
  };

  const parseAudioError = async response => {
    try {
      const text = await response.text();
      if (!text) return `Audio request failed with HTTP ${response.status}`;
      try {
        const json = JSON.parse(text);
        return json.error || text;
      } catch (err) {
        return text;
      }
    } catch (err) {
      return `Audio request failed with HTTP ${response.status}`;
    }
  };

  const fetchAudioUrl = async url => {
    const response = await fetchWithAuthRedirect(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(await parseAudioError(response));
    const blob = await response.blob();
    if (!blob.size) throw new Error('TTS returned an empty audio file');
    const objectUrl = URL.createObjectURL(blob);
    objectUrls.push(objectUrl);
    return objectUrl;
  };

  const parseJsonError = async (response, fallback) => {
    try {
      const json = await response.json();
      return json.error || fallback;
    } catch (err) {
      return fallback;
    }
  };

  const playUrls = async urls => {
    for (const url of urls) {
      const objectUrl = await fetchAudioUrl(url);

      await new Promise((resolve, reject) => {
        audio = new Audio(objectUrl);
        audio.preload = 'auto';
        audio.playsInline = true;
        connectWaveform();
        audio.onended = resolve;
        audio.onerror = () => reject(new Error('Browser could not play the generated audio'));
        audio.play().catch(err => {
          console.warn('Tester audio playback failed', err);
          reject(err);
        });
      });
    }
  };

  const speak = async () => {
    const text = textInput?.value.trim() || '';
    saveVoicePreferences();
    const params = window.__voicePreferences?.toParams
      ? window.__voicePreferences.toParams(currentVoicePreferences(), text)
      : new URLSearchParams({ lang: voiceLang?.value.trim() || 'en', provider: engine?.value || 'piper', text: text.slice(0, 4500) });
    if (!text) {
      setStatus('Enter text before speaking.');
      return;
    }

    stop();
    speakButton?.setAttribute('disabled', 'disabled');
    setStatus('Requesting configured TTS renderer...');

    try {
      const response = await fetchWithAuthRedirect(`/api/tts?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(await parseJsonError(response, `TTS request failed with HTTP ${response.status}`));
      const json = await response.json();
      if (!json.ok) throw new Error(json.error || 'TTS request failed');

      const voiceLabel = json.voice ? ` - ${json.voice}` : '';
      if (provider) provider.textContent = `Voice ${json.provider || 'piper'}${voiceLabel}`;
      const urls = json.urls || (json.url ? [json.url] : []);
      if (!urls.length) throw new Error('TTS did not return an audio URL');
      setActive(true);
      setStatus('Speaking.');
      await playUrls(urls);
      setActive(false);
      setStatus(`Finished${voiceLabel}.`);
    } catch (err) {
      setActive(false);
      bob?.setEmotion('error');
      setStatus(`Voice test failed: ${err.message}`);
    } finally {
      speakButton?.removeAttribute('disabled');
    }
  };

  const applyServerSettings = async () => {
    const preferences = saveVoicePreferences();
    applyServerButton?.setAttribute('disabled', 'disabled');
    setStatus('Applying voice defaults to server...');

    try {
      const response = await fetchWithAuthRedirect('/api/tts/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences)
      });
      const json = await response.json();
      if (!json.ok) throw new Error(json.error || 'Could not apply voice settings');
      window.__voicePreferences?.write?.(json.data || preferences);
      setStatus('Server voice defaults applied.');
      if (provider) provider.textContent = `Voice ${json.data?.provider || preferences.provider || 'piper'}`;
    } catch (err) {
      setStatus(`Apply failed: ${err.message}`);
    } finally {
      applyServerButton?.removeAttribute('disabled');
    }
  };

  mainPage.querySelectorAll('[data-bob-emotion]').forEach(button => {
    button.addEventListener('click', () => {
      const emotion = button.dataset.bobEmotion;
      if (emotion === 'speaking') bob?.startSpeaking();
      else {
        bob?.stopSpeaking();
        bob?.setEmotion(emotion);
      }
      setStatus(`Emotion: ${emotion}.`);
    });
  });

  speakButton?.addEventListener('click', speak);
  stopButton?.addEventListener('click', stop);
  applyServerButton?.addEventListener('click', applyServerSettings);
  [voiceLang, piperSpeaker, piperLengthScale, piperNoiseScale, piperNoiseW]
    .filter(Boolean)
    .forEach(control => control.addEventListener('change', saveVoicePreferences));
  lookPad?.addEventListener('pointerdown', event => {
    lookPad.setPointerCapture?.(event.pointerId);
    setLookFromPointer(event);
  });
  lookPad?.addEventListener('pointermove', event => {
    if (event.buttons) setLookFromPointer(event);
  });
  lookPad?.addEventListener('keydown', event => {
    const step = event.shiftKey ? 0.2 : 0.08;
    const currentX = ((parseFloat(lookDot?.style.left || '50') - 50) / 44) || 0;
    const currentY = ((parseFloat(lookDot?.style.top || '50') - 50) / 44) || 0;
    if (event.key === 'ArrowLeft') setLookPosition(currentX - step, currentY);
    else if (event.key === 'ArrowRight') setLookPosition(currentX + step, currentY);
    else if (event.key === 'ArrowUp') setLookPosition(currentX, currentY - step);
    else if (event.key === 'ArrowDown') setLookPosition(currentX, currentY + step);
    else if (event.key === 'Home' || event.key === 'Enter' || event.key === ' ') setLookPosition(0, 0);
    else return;
    event.preventDefault();
  });
  setLookPosition(0, 0);
  if (bob && currentLookDot && !lookAnimationId) updateCurrentLookDot();

  fetchWithAuthRedirect('/api/tts/status', { cache: 'no-store' })
    .then(response => response.json())
    .then(json => {
      const data = json.data || {};
      const saved = window.__voicePreferences?.read?.() || {};
      if (engine) {
        engine.textContent = data.providerLabel || 'Piper local voice';
      }
      const defaults = data.defaults || {};
      const options = data.options || {};
      replaceOptions(voiceLang, options.lang || [data.defaultLang || 'en'], saved.lang || data.defaultLang || 'en', '');
      replaceOptions(piperSpeaker, options.piperSpeaker || [], saved.piperSpeaker || defaults.piperSpeaker || '', 'Default');
      replaceOptions(piperLengthScale, options.piperLengthScale || [], saved.piperLengthScale || defaults.piperLengthScale || '', 'Default');
      replaceOptions(piperNoiseScale, options.piperNoiseScale || [], saved.piperNoiseScale || defaults.piperNoiseScale || '', 'Default');
      replaceOptions(piperNoiseW, options.piperNoiseW || [], saved.piperNoiseW || defaults.piperNoiseW || '', 'Default');
      saveVoicePreferences();
      const configLabel = data.piperConfig?.loaded ? 'config loaded' : 'default config';
      if (provider) provider.textContent = `Voice ${data.provider || 'piper'} - ${configLabel}`;
      if (!data.piperConfigured) setStatus('Piper needs TTS_PIPER_MODEL before speech can run.');
    })
    .catch(() => {
      if (provider) provider.textContent = 'Voice unknown';
    });

  window.__icons?.render?.(mainPage);
}
