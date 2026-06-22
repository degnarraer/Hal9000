(function () {
  const voicePreferenceKey = 'bobVoicePreferences';

  function cleanValue(value) {
    const clean = String(value || '').trim();
    return clean.toLowerCase() === 'default' ? '' : clean;
  }

  function readVoicePreferences() {
    try {
      const parsed = JSON.parse(localStorage.getItem(voicePreferenceKey) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function writeVoicePreferences(preferences) {
    const clean = {
      provider: cleanValue(preferences.provider),
      lang: cleanValue(preferences.lang) || 'en',
      piperSpeaker: cleanValue(preferences.piperSpeaker),
      piperLengthScale: cleanValue(preferences.piperLengthScale),
      piperNoiseScale: cleanValue(preferences.piperNoiseScale),
      piperNoiseW: cleanValue(preferences.piperNoiseW)
    };
    localStorage.setItem(voicePreferenceKey, JSON.stringify(clean));
    window.dispatchEvent(new CustomEvent('bob:voice-preferences-changed', { detail: clean }));
    return clean;
  }

  function voicePreferencesToParams(preferences, text) {
    const prefs = preferences || readVoicePreferences();
    const provider = cleanValue(prefs.provider);
    const params = new URLSearchParams({
      lang: cleanValue(prefs.lang) || 'en',
      text: String(text || '').slice(0, 4500)
    });

    if (provider) params.set('provider', provider);
    if (cleanValue(prefs.piperSpeaker)) params.set('speaker', cleanValue(prefs.piperSpeaker));
    if (cleanValue(prefs.piperLengthScale)) params.set('lengthScale', cleanValue(prefs.piperLengthScale));
    if (cleanValue(prefs.piperNoiseScale)) params.set('noiseScale', cleanValue(prefs.piperNoiseScale));
    if (cleanValue(prefs.piperNoiseW)) params.set('noiseW', cleanValue(prefs.piperNoiseW));
    return params;
  }

  window.__voicePreferences = {
    key: voicePreferenceKey,
    read: readVoicePreferences,
    write: writeVoicePreferences,
    toParams: voicePreferencesToParams
  };
})();
