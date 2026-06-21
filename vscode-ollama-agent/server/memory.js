const { Pool } = require('pg');

const DEFAULT_HISTORY_LIMIT = 12;
const SUMMARY_SCOPES = {
  short: { limit: 24, title: 'Short term memory' },
  medium: { limit: 100, title: 'Medium term memory' },
  long: { limit: 500, title: 'Long term memory' }
};

function userKey(req) {
  const user = req.user || {};
  return user.sub || user.email || user.preferred_username || user.name || 'anonymous';
}

function createMemoryStore(logger) {
  const enabled = String(process.env.MEMORY_ENABLED || 'true').toLowerCase() !== 'false';
  const connectionString = process.env.MEMORY_DATABASE_URL;
  const historyLimit = Number(process.env.MEMORY_HISTORY_LIMIT || DEFAULT_HISTORY_LIMIT);
  let pool;
  let ready;

  async function init() {
    if (!enabled) return false;
    if (!connectionString) {
      logger.warn('Memory database disabled: MEMORY_DATABASE_URL is not set');
      return false;
    }

    pool = new Pool({ connectionString });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id BIGSERIAL PRIMARY KEY,
        user_key TEXT NOT NULL,
        conversation_id TEXT NOT NULL DEFAULT 'default',
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        model TEXT,
        content TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_chat_messages_user_created ON chat_messages (user_key, created_at DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created ON chat_messages (user_key, conversation_id, created_at DESC)');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS memory_summaries (
        user_key TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('short', 'medium', 'long')),
        summary TEXT NOT NULL DEFAULT '',
        source_message_count INTEGER NOT NULL DEFAULT 0,
        model TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_key, scope)
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_memory_summaries_user_updated ON memory_summaries (user_key, updated_at DESC)');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS memory_factoids (
        id BIGSERIAL PRIMARY KEY,
        user_key TEXT NOT NULL,
        fact_key TEXT NOT NULL,
        fact TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        confidence REAL NOT NULL DEFAULT 0.7,
        model TEXT,
        source_message_id BIGINT REFERENCES chat_messages(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_key, fact_key)
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_memory_factoids_user_updated ON memory_factoids (user_key, updated_at DESC)');
    logger.info('Memory database initialized');
    return true;
  }

  async function ensureReady() {
    if (!enabled) return false;
    if (!ready) {
      ready = init().catch(err => {
        logger.error('Memory database initialization failed', err?.message || err);
        ready = null;
        return false;
      });
    }
    return ready;
  }

  async function addMessage({ req, role, model, content, conversationId = 'default', metadata = {} }) {
    if (!content || !(await ensureReady())) return null;
    try {
      const result = await pool.query(
        `INSERT INTO chat_messages (user_key, conversation_id, role, model, content, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, role, model, content, created_at`,
        [userKey(req), conversationId, role, model || null, content, metadata]
      );
      return result.rows[0];
    } catch (err) {
      logger.error('Memory write failed', err?.message || err);
      return null;
    }
  }

  async function deleteMessage({ req, id }) {
    if (!(await ensureReady())) throw new Error('Memory database unavailable');
    const result = await pool.query(
      `DELETE FROM chat_messages
       WHERE user_key = $1 AND id = $2
       RETURNING id`,
      [userKey(req), id]
    );
    return Boolean(result.rowCount);
  }

  async function getRecent({ req, limit = historyLimit, conversationId = 'default' }) {
    if (!(await ensureReady())) return [];
    const safeLimit = Math.max(1, Math.min(Number(limit) || historyLimit, 100));
    try {
      const result = await pool.query(
        `SELECT id, role, model, content, created_at
         FROM chat_messages
         WHERE user_key = $1 AND conversation_id = $2
         ORDER BY created_at DESC
         LIMIT $3`,
        [userKey(req), conversationId, safeLimit]
      );
      return result.rows.reverse();
    } catch (err) {
      logger.error('Memory read failed', err?.message || err);
      return [];
    }
  }

  async function getMessages({ req, limit = 100, conversationId = 'default' }) {
    if (!(await ensureReady())) return [];
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
    try {
      const result = await pool.query(
        `SELECT id, role, model, content, metadata, created_at
         FROM chat_messages
         WHERE user_key = $1 AND conversation_id = $2
         ORDER BY created_at DESC
         LIMIT $3`,
        [userKey(req), conversationId, safeLimit]
      );
      return result.rows.reverse();
    } catch (err) {
      logger.error('Memory message read failed', err?.message || err);
      return [];
    }
  }

  async function getSummaries({ req }) {
    if (!(await ensureReady())) return defaultSummaries();
    try {
      const result = await pool.query(
        `SELECT scope, summary, source_message_count, model, updated_at
         FROM memory_summaries
         WHERE user_key = $1`,
        [userKey(req)]
      );
      const summaries = defaultSummaries();
      for (const row of result.rows) {
        summaries[row.scope] = {
          scope: row.scope,
          title: SUMMARY_SCOPES[row.scope]?.title || row.scope,
          summary: row.summary,
          sourceMessageCount: row.source_message_count,
          model: row.model,
          updatedAt: row.updated_at
        };
      }
      return summaries;
    } catch (err) {
      logger.error('Memory summaries read failed', err?.message || err);
      return defaultSummaries();
    }
  }

  async function getFactoids({ req, limit = 100 }) {
    if (!(await ensureReady())) return [];
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
    try {
      const result = await pool.query(
        `SELECT id, fact_key, fact, category, confidence, model, source_message_id, created_at, updated_at
         FROM memory_factoids
         WHERE user_key = $1
         ORDER BY updated_at DESC
         LIMIT $2`,
        [userKey(req), safeLimit]
      );
      return result.rows.map(row => ({
        id: row.id,
        factKey: row.fact_key,
        fact: row.fact,
        category: row.category,
        confidence: row.confidence,
        model: row.model,
        sourceMessageId: row.source_message_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    } catch (err) {
      logger.error('Memory factoids read failed', err?.message || err);
      return [];
    }
  }

  async function saveFactoids({ req, factoids, model, sourceMessageId = null }) {
    if (!(await ensureReady())) throw new Error('Memory database unavailable');
    const saved = [];
    for (const item of factoids || []) {
      const fact = String(item.fact || '').trim();
      if (!fact) continue;
      const factKey = normalizeFactKey(item.factKey || item.key || fact);
      const category = String(item.category || 'general').trim().slice(0, 80) || 'general';
      const confidence = clampConfidence(item.confidence);
      const result = await pool.query(
        `INSERT INTO memory_factoids (user_key, fact_key, fact, category, confidence, model, source_message_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (user_key, fact_key) DO UPDATE
         SET fact = EXCLUDED.fact,
             category = EXCLUDED.category,
             confidence = EXCLUDED.confidence,
             model = EXCLUDED.model,
             source_message_id = EXCLUDED.source_message_id,
             updated_at = now()
         RETURNING id, fact_key, fact, category, confidence, model, source_message_id, created_at, updated_at`,
        [userKey(req), factKey, fact.slice(0, 1000), category, confidence, model || null, sourceMessageId]
      );
      const row = result.rows[0];
      saved.push({
        id: row.id,
        factKey: row.fact_key,
        fact: row.fact,
        category: row.category,
        confidence: row.confidence,
        model: row.model,
        sourceMessageId: row.source_message_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      });
    }
    return saved;
  }

  async function deleteFactoid({ req, id }) {
    if (!(await ensureReady())) throw new Error('Memory database unavailable');
    const result = await pool.query(
      `DELETE FROM memory_factoids
       WHERE user_key = $1 AND id = $2
       RETURNING id`,
      [userKey(req), id]
    );
    return Boolean(result.rowCount);
  }

  async function getMessageCount({ req, conversationId = 'default' }) {
    if (!(await ensureReady())) return 0;
    try {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM chat_messages
         WHERE user_key = $1 AND conversation_id = $2`,
        [userKey(req), conversationId]
      );
      return result.rows[0]?.count || 0;
    } catch (err) {
      logger.error('Memory count read failed', err?.message || err);
      return 0;
    }
  }

  async function saveSummary({ req, scope, summary, sourceMessageCount, model }) {
    if (!SUMMARY_SCOPES[scope]) throw new Error('Invalid memory summary scope');
    if (!(await ensureReady())) throw new Error('Memory database unavailable');
    const result = await pool.query(
      `INSERT INTO memory_summaries (user_key, scope, summary, source_message_count, model, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_key, scope) DO UPDATE
       SET summary = EXCLUDED.summary,
           source_message_count = EXCLUDED.source_message_count,
           model = EXCLUDED.model,
           updated_at = now()
       RETURNING scope, summary, source_message_count, model, updated_at`,
      [userKey(req), scope, summary, sourceMessageCount || 0, model || null]
    );
    const row = result.rows[0];
    return {
      scope: row.scope,
      title: SUMMARY_SCOPES[row.scope].title,
      summary: row.summary,
      sourceMessageCount: row.source_message_count,
      model: row.model,
      updatedAt: row.updated_at
    };
  }

  function buildPrompt(prompt, history, summaries = null, factoids = []) {
    const summaryRows = Object.values(summaries || {})
      .filter(row => row?.summary)
      .map(row => `${row.title || row.scope}: ${row.summary}`);
    const factRows = (factoids || [])
      .filter(row => row?.fact)
      .map(row => `${row.category || 'general'}: ${row.fact}`);
    const hasHistory = Array.isArray(history) && history.length > 0;

    if (!hasHistory && summaryRows.length === 0 && factRows.length === 0) return prompt;

    const transcript = (history || [])
      .map(row => `${row.role === 'assistant' ? 'Assistant' : 'User'}: ${row.content}`)
      .join('\n');

    const sections = [
      'Use this recent conversation memory to continue naturally. Do not mention the memory block unless asked.',
      '<conversation_memory>'
    ];

    if (summaryRows.length > 0) {
      sections.push('<memory_summaries>', summaryRows.join('\n\n'), '</memory_summaries>');
    }

    if (factRows.length > 0) {
      sections.push('<user_factoids>', factRows.join('\n'), '</user_factoids>');
    }

    if (hasHistory) {
      sections.push('<recent_transcript>', transcript, '</recent_transcript>');
    }

    sections.push('</conversation_memory>', '', 'Current user message:', prompt);
    return sections.join('\n');
  }

  async function historyHandler(req, res) {
    try {
      const limit = req.query.limit || historyLimit;
      const conversationId = req.query.conversationId || 'default';
      const data = await getRecent({ req, limit, conversationId });
      res.json({ ok: true, data });
    } catch (err) {
      logger.error('Memory history error', err?.message || err);
      res.status(500).json({ ok: false, error: 'Memory history unavailable' });
    }
  }

  async function managerHandler(req, res) {
    try {
      const [messages, summaries, factoids] = await Promise.all([
        getMessages({ req, limit: req.query.limit || 100, conversationId: req.query.conversationId || 'default' }),
        getSummaries({ req }),
        getFactoids({ req, limit: req.query.factoidLimit || 100 })
      ]);
      res.json({ ok: true, data: { messages, summaries, factoids } });
    } catch (err) {
      logger.error('Memory manager error', err?.message || err);
      res.status(500).json({ ok: false, error: 'Memory manager unavailable' });
    }
  }

  async function shutdown() {
    if (pool) await pool.end();
  }

  return {
    addMessage,
    buildPrompt,
    deleteFactoid,
    deleteMessage,
    getFactoids,
    getRecent,
    getMessages,
    getMessageCount,
    getSummaries,
    historyHandler,
    managerHandler,
    saveFactoids,
    saveSummary,
    shutdown,
    summaryScopes: SUMMARY_SCOPES,
    userKey
  };
}

function defaultSummaries() {
  return Object.fromEntries(Object.entries(SUMMARY_SCOPES).map(([scope, config]) => [
    scope,
    {
      scope,
      title: config.title,
      summary: '',
      sourceMessageCount: 0,
      model: null,
      updatedAt: null
    }
  ]));
}

function normalizeFactKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'general-fact';
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.7;
  return Math.max(0, Math.min(1, number));
}

module.exports = { SUMMARY_SCOPES, createMemoryStore, defaultSummaries };
