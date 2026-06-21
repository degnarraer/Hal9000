// Admin-only app tester pages.
function initAppTester() {
  const face = byId('testerBobFace');
  const textInput = byId('bobVoiceText');
  const speakButton = byId('bobVoiceSpeak');
  const stopButton = byId('bobVoiceStop');
  const status = byId('bobVoiceStatus');
  const provider = byId('bobVoiceProvider');
  const engine = byId('bobVoiceEngine');
  const voiceLang = byId('bobVoiceLang');
  const piperSpeaker = byId('bobPiperSpeaker');
  const piperLengthScale = byId('bobPiperLengthScale');
  const piperNoiseScale = byId('bobPiperNoiseScale');
  const piperNoiseW = byId('bobPiperNoiseW');
  const windowsVoice = byId('bobWindowsVoice');
  const windowsVoiceList = byId('bobWindowsVoiceList');
  const waveform = byId('bobVoiceWaveform');
  const lookPad = byId('bobLookPad');
  const lookDot = byId('bobLookDot');
  const currentLookDot = byId('bobCurrentLookDot');
  const lookReset = byId('bobLookReset');
  const bob = window.BobExpressionEngine && face ? new window.BobExpressionEngine(face) : null;

  let audio;
  let audioContext;
  let analyser;
  let dataArray;
  let animationId;
  let lookAnimationId;
  let manualLookTimeout;

  const setStatus = message => {
    if (status) status.textContent = message;
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

  const playUrls = async (urls, index = 0) => {
    if (!urls[index]) return;

    await new Promise(resolve => {
      audio = new Audio(urls[index]);
      audio.preload = 'auto';
      audio.playsInline = true;
      connectWaveform();
      audio.onended = resolve;
      audio.onerror = resolve;
      audio.play().catch(err => {
        console.warn('Tester audio playback failed', err);
        resolve();
      });
    });

    await playUrls(urls, index + 1);
  };

  const speak = async () => {
    const text = textInput?.value.trim() || '';
    const selectedProvider = engine?.value || 'google';
    const params = new URLSearchParams({
      lang: voiceLang?.value.trim() || 'en',
      provider: selectedProvider,
      text: text.slice(0, 4500)
    });
    if (piperSpeaker?.value.trim()) params.set('speaker', piperSpeaker.value.trim());
    if (piperLengthScale?.value.trim()) params.set('lengthScale', piperLengthScale.value.trim());
    if (piperNoiseScale?.value.trim()) params.set('noiseScale', piperNoiseScale.value.trim());
    if (piperNoiseW?.value.trim()) params.set('noiseW', piperNoiseW.value.trim());
    if (windowsVoice?.value.trim()) params.set('voice', windowsVoice.value.trim());
    if (!text) {
      setStatus('Enter text before speaking.');
      return;
    }

    stop();
    speakButton?.setAttribute('disabled', 'disabled');
    setStatus('Requesting configured TTS renderer...');

    try {
      const response = await fetchWithAuthRedirect(`/api/tts?${params.toString()}`, { cache: 'no-store' });
      const json = await response.json();
      if (!json.ok) throw new Error(json.error || 'TTS request failed');

      if (provider) provider.textContent = `Voice ${json.provider || 'configured'}`;
      const urls = json.urls || (json.url ? [json.url] : []);
      setActive(true);
      setStatus('Speaking.');
      await playUrls(urls);
      setActive(false);
      setStatus('Finished.');
    } catch (err) {
      setActive(false);
      bob?.setEmotion('error');
      setStatus(`Voice test failed: ${err.message}`);
    } finally {
      speakButton?.removeAttribute('disabled');
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
  lookReset?.addEventListener('click', () => setLookPosition(0, 0));
  setLookPosition(0, 0);
  if (bob && currentLookDot && !lookAnimationId) updateCurrentLookDot();

  fetchWithAuthRedirect('/api/tts/status', { cache: 'no-store' })
    .then(response => response.json())
    .then(json => {
      const data = json.data || {};
      const providers = Array.isArray(data.providers) && data.providers.length ? data.providers : ['google', 'piper'];
      if (engine) {
        const labels = { google: 'Google Translate TTS', piper: 'Piper local voice', windows: 'Windows local voice' };
        engine.replaceChildren(...providers.map(name => {
          const option = document.createElement('option');
          option.value = name;
          option.textContent = labels[name] || name;
          return option;
        }));
        engine.value = providers.includes(data.provider) ? data.provider : providers[0];
      }
      const defaults = data.defaults || {};
      if (voiceLang) voiceLang.value = data.defaultLang || 'en';
      if (piperSpeaker) piperSpeaker.value = defaults.piperSpeaker || '';
      if (piperLengthScale) piperLengthScale.value = defaults.piperLengthScale || '';
      if (piperNoiseScale) piperNoiseScale.value = defaults.piperNoiseScale || '';
      if (piperNoiseW) piperNoiseW.value = defaults.piperNoiseW || '';
      if (windowsVoice) windowsVoice.value = defaults.windowsVoice || '';
      if (windowsVoiceList) {
        const voices = Array.isArray(data.windowsVoices) ? data.windowsVoices : [];
        windowsVoiceList.replaceChildren(...voices.map(name => {
          const option = document.createElement('option');
          option.value = name;
          return option;
        }));
      }
      if (provider) provider.textContent = `Voice ${data.provider || 'unknown'}`;
    })
    .catch(() => {
      if (provider) provider.textContent = 'Voice unknown';
    });

  window.__icons?.render?.(mainPage);
}
