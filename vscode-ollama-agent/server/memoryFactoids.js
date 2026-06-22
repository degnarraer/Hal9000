const ALLOWED_CATEGORIES = new Set(['preference', 'project', 'identity', 'environment', 'workflow', 'constraint', 'general']);
const STOP_WORDS = new Set([
  'a', 'about', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'did', 'do', 'does', 'for', 'from', 'has',
  'have', 'he', 'her', 'his', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'our', 'she', 'that', 'the',
  'their', 'them', 'they', 'this', 'to', 'user', 'was', 'we', 'with', 'work', 'works', 'working'
]);

function parseFactoidExtraction(text) {
  if (!text) return [];
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed.factoids) ? parsed.factoids : [];
  } catch (err) {
    return [];
  }
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9'-]*/g) || [];
}

function meaningfulTokens(value) {
  return tokenize(value).filter(token => token.length > 2 && !STOP_WORDS.has(token));
}

function userTranscriptText(messages) {
  return (messages || [])
    .filter(row => row?.role === 'user')
    .map(row => row.content || '')
    .join('\n');
}

function splitClaims(fact) {
  return String(fact || '')
    .replace(/^the user\s+/i, '')
    .split(/(?:[.;]|\s+\bbut\b\s+|\s+\balso\b\s+|\s+\boften\b\s+|\s+\band\s+(?=(?:works?|uses?|prefers?|enjoys?|faces?|has|is|likes?|wants?|needs?|asked)\b))/i)
    .map(claim => claim.trim())
    .filter(Boolean);
}

function isClaimSupported(claim, evidenceText) {
  const evidence = String(evidenceText || '').toLowerCase();
  const claimText = String(claim || '').toLowerCase();
  const tokens = meaningfulTokens(claimText);
  if (tokens.length === 0) return false;

  const unsupportedTokens = tokens.filter(token => !evidence.includes(token));
  if (unsupportedTokens.length === 0) return true;

  const nameMatch = claimText.match(/\b(?:named|name is|call(?:ed)? me)\s+([a-z][a-z'-]*)\b/i);
  if (nameMatch && evidence.includes(nameMatch[1].toLowerCase())) return unsupportedTokens.length <= 1;

  return false;
}

function filterSupportedFactoids(factoids, messages) {
  const evidenceText = userTranscriptText(messages);
  if (!evidenceText.trim()) return [];

  return (factoids || []).filter(item => {
    const fact = String(item?.fact || '').trim();
    if (!fact) return false;

    const category = String(item.category || 'general').trim().toLowerCase();
    if (!ALLOWED_CATEGORIES.has(category)) return false;

    const claims = splitClaims(fact);
    if (claims.length === 0 || claims.length > 3) return false;

    return claims.every(claim => isClaimSupported(claim, evidenceText));
  });
}

module.exports = {
  filterSupportedFactoids,
  parseFactoidExtraction,
  splitClaims
};
