function parseJsonObject(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    return null;
  }
}

function decodeJsonStringFragment(fragment = '') {
  let safe = String(fragment || '');
  const trailingSlashes = safe.match(/\\+$/)?.[0]?.length || 0;
  if (trailingSlashes % 2 === 1) safe = safe.slice(0, -1);
  try {
    return JSON.parse(`"${safe}"`);
  } catch (err) {
    return safe
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\');
  }
}

function extractStreamingResponseText(raw = '') {
  const parsed = parseJsonObject(raw);
  if (parsed) return String(parsed.response || parsed.output?.response || '');

  const text = String(raw || '');
  const match = text.match(/"response"\s*:\s*"/);
  if (!match) return '';
  let fragment = '';
  let escaped = false;
  for (let index = match.index + match[0].length; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      fragment += `\\${char}`;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') break;
    fragment += char;
  }
  if (escaped) fragment += '\\';
  return decodeJsonStringFragment(fragment);
}

function cleanSpeakableText(text = '') {
  return String(text || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function longestCommonPrefixLength(left = '', right = '') {
  const max = Math.min(left.length, right.length);
  let index = 0;
  while (index < max && left[index] === right[index]) index += 1;
  return index;
}

function sentenceBoundaryEnd(text = '') {
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== '.' && char !== '!' && char !== '?') continue;
    let end = index + 1;
    while (end < text.length && /["')\]]/.test(text[end])) end += 1;
    if (end === text.length || /\s/.test(text[end])) return end;
  }
  return -1;
}

function createStreamingResponseSentenceEmitter() {
  let lastResponseText = '';
  let pendingSpeech = '';

  function drain({ flush = false } = {}) {
    const sentences = [];
    while (pendingSpeech) {
      const boundary = sentenceBoundaryEnd(pendingSpeech);
      if (boundary < 0) break;
      const sentence = cleanSpeakableText(pendingSpeech.slice(0, boundary));
      pendingSpeech = pendingSpeech.slice(boundary).trimStart();
      if (sentence) sentences.push(sentence);
    }
    if (flush) {
      const finalText = cleanSpeakableText(pendingSpeech);
      pendingSpeech = '';
      if (finalText) sentences.push(finalText);
    }
    return sentences;
  }

  function push(raw = '') {
    const responseText = cleanSpeakableText(extractStreamingResponseText(raw));
    if (!responseText) return { responseText: '', responseDelta: '', sentences: [] };

    const common = responseText.startsWith(lastResponseText)
      ? lastResponseText.length
      : longestCommonPrefixLength(lastResponseText, responseText);
    const responseDelta = responseText.slice(common);
    lastResponseText = responseText;
    if (responseDelta) pendingSpeech = cleanSpeakableText(`${pendingSpeech}${responseDelta}`);
    return {
      responseText,
      responseDelta,
      sentences: drain()
    };
  }

  function flush() {
    return {
      responseText: lastResponseText,
      responseDelta: '',
      sentences: drain({ flush: true })
    };
  }

  return { push, flush };
}

module.exports = {
  cleanSpeakableText,
  createStreamingResponseSentenceEmitter,
  extractStreamingResponseText
};
