const ALLOWED_CATEGORIES = new Set(['preference', 'project', 'identity', 'environment', 'workflow', 'constraint', 'general']);

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

function normalizeFactoids(factoids) {
  return (factoids || []).map(item => {
    const fact = String(item?.fact || '').trim();
    if (!fact) return null;

    const category = String(item.category || 'general').trim().toLowerCase();
    const factKey = String(item.factKey || item.key || fact.toLowerCase().replace(/[^a-z0-9]+/g, '-')).trim().slice(0, 120);
    const confidence = Math.max(0, Math.min(1, Number(item.confidence) || 0));

    return {
      factKey: factKey || fact.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 120),
      category: ALLOWED_CATEGORIES.has(category) ? category : 'general',
      fact: fact.slice(0, 1000),
      confidence
    };
  }).filter(Boolean);
}

module.exports = {
  normalizeFactoids,
  parseFactoidExtraction
};
