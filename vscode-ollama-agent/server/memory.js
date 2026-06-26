const { Pool } = require('pg');
const { requestDatabaseUserKey } = require('./userIdentity');
const { normalizeBobEmotion } = require('./bobSkillContracts');
const { sanitizeMemorySummary } = require('./memorySkill');

const DEFAULT_HISTORY_LIMIT = 12;
const SUMMARY_SCOPES = {
  short: { limit: 24, title: 'Short term memory' },
  medium: { limit: 100, title: 'Medium term memory' },
  long: { limit: 500, title: 'Long term memory' }
};

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
        emotion TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query('ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS emotion TEXT');
    await pool.query(`
      UPDATE chat_messages
      SET emotion = lower(metadata->>'emotion')
      WHERE role = 'assistant'
        AND emotion IS NULL
        AND metadata ? 'emotion'
        AND metadata->>'emotion' <> ''
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_chat_messages_user_created ON chat_messages (user_key, created_at DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created ON chat_messages (user_key, conversation_id, created_at DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_chat_messages_user_emotion_created ON chat_messages (user_key, emotion, created_at DESC)');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS memory_summaries (
        user_key TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('short', 'medium', 'long')),
        summary TEXT NOT NULL DEFAULT '',
        source_message_count INTEGER NOT NULL DEFAULT 0,
        model TEXT,
        debug JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_key, scope)
      )
    `);
    await pool.query('ALTER TABLE memory_summaries ADD COLUMN IF NOT EXISTS debug JSONB NOT NULL DEFAULT \'{}\'::jsonb');
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
      const emotion = emotionForMessage(role, metadata);
      const storedMetadata = emotion ? { ...metadata, emotion } : metadata;
      const result = await pool.query(
        `INSERT INTO chat_messages (user_key, conversation_id, role, model, content, emotion, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, role, model, content, emotion, metadata, created_at`,
        [requestDatabaseUserKey(req), conversationId, role, model || null, content, emotion, storedMetadata]
      );
      return hydrateMessageEmotion(result.rows[0]);
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
      [requestDatabaseUserKey(req), id]
    );
    return Boolean(result.rowCount);
  }

  async function getRecent({ req, limit = historyLimit, conversationId = 'default' }) {
    if (!(await ensureReady())) return [];
    const safeLimit = Math.max(1, Math.min(Number(limit) || historyLimit, 100));
    try {
      const result = await pool.query(
        `WITH ordered_messages AS (
           SELECT id, role, model, content, emotion, metadata, created_at,
                  ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS memory_sequence
           FROM chat_messages
           WHERE user_key = $1 AND conversation_id = $2
         )
         SELECT id, role, model, content, emotion, metadata, created_at, memory_sequence
         FROM ordered_messages
         ORDER BY created_at DESC, id DESC
         LIMIT $3`,
        [requestDatabaseUserKey(req), conversationId, safeLimit]
      );
      return result.rows.map(hydrateMessageEmotion).reverse();
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
        `WITH ordered_messages AS (
           SELECT id, role, model, content, emotion, metadata, created_at,
                  ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS memory_sequence
           FROM chat_messages
           WHERE user_key = $1 AND conversation_id = $2
         )
         SELECT id, role, model, content, emotion, metadata, created_at, memory_sequence
         FROM ordered_messages
         ORDER BY created_at DESC, id DESC
         LIMIT $3`,
        [requestDatabaseUserKey(req), conversationId, safeLimit]
      );
      return result.rows.map(hydrateMessageEmotion).reverse();
    } catch (err) {
      logger.error('Memory message read failed', err?.message || err);
      return [];
    }
  }

  async function getSummaries({ req }) {
    if (!(await ensureReady())) return defaultSummaries();
    try {
      const result = await pool.query(
        `SELECT scope, summary, source_message_count, model, debug, updated_at
         FROM memory_summaries
         WHERE user_key = $1`,
        [requestDatabaseUserKey(req)]
      );
      const summaries = defaultSummaries();
      for (const row of result.rows) {
        summaries[row.scope] = {
          scope: row.scope,
          title: SUMMARY_SCOPES[row.scope]?.title || row.scope,
          summary: sanitizeMemorySummary(row.summary, ''),
          sourceMessageCount: row.source_message_count,
          model: row.model,
          debug: row.debug || {},
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
        [requestDatabaseUserKey(req), safeLimit]
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
        [requestDatabaseUserKey(req), factKey, fact.slice(0, 1000), category, confidence, model || null, sourceMessageId]
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
      [requestDatabaseUserKey(req), id]
    );
    return Boolean(result.rowCount);
  }

  async function clearAll({ req }) {
    if (!(await ensureReady())) throw new Error('Memory database unavailable');
    const key = requestDatabaseUserKey(req);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const factoids = await client.query('DELETE FROM memory_factoids WHERE user_key = $1', [key]);
      const summaries = await client.query('DELETE FROM memory_summaries WHERE user_key = $1', [key]);
      const messages = await client.query('DELETE FROM chat_messages WHERE user_key = $1', [key]);
      await client.query('COMMIT');
      return {
        messages: messages.rowCount || 0,
        summaries: summaries.rowCount || 0,
        factoids: factoids.rowCount || 0
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async function getMessageCount({ req, conversationId = 'default' }) {
    if (!(await ensureReady())) return 0;
    try {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM chat_messages
         WHERE user_key = $1 AND conversation_id = $2`,
        [requestDatabaseUserKey(req), conversationId]
      );
      return result.rows[0]?.count || 0;
    } catch (err) {
      logger.error('Memory count read failed', err?.message || err);
      return 0;
    }
  }

  async function getUnprocessedMessages({ req, summaries = null, limit = historyLimit, conversationId = 'default' }) {
    if (!(await ensureReady())) return [];
    const memorySummaries = summaries || await getSummaries({ req });
    const messageCount = await getMessageCount({ req, conversationId });
    const unprocessedCount = unprocessedMessageLimit({ summaries: memorySummaries, messageCount, limit });
    if (unprocessedCount <= 0) return [];
    return getMessages({
      req,
      conversationId,
      limit: unprocessedCount
    });
  }

  async function saveSummary({ req, scope, summary, sourceMessageCount, model, debug = {} }) {
    if (!SUMMARY_SCOPES[scope]) throw new Error('Invalid memory summary scope');
    if (!(await ensureReady())) throw new Error('Memory database unavailable');
    const result = await pool.query(
      `INSERT INTO memory_summaries (user_key, scope, summary, source_message_count, model, debug, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (user_key, scope) DO UPDATE
       SET summary = EXCLUDED.summary,
           source_message_count = EXCLUDED.source_message_count,
           model = EXCLUDED.model,
           debug = EXCLUDED.debug,
           updated_at = now()
       RETURNING scope, summary, source_message_count, model, debug, updated_at`,
      [requestDatabaseUserKey(req), scope, summary, sourceMessageCount || 0, model || null, debug || {}]
    );
    const row = result.rows[0];
    return {
      scope: row.scope,
      title: SUMMARY_SCOPES[row.scope].title,
      summary: row.summary,
      sourceMessageCount: row.source_message_count,
      model: row.model,
      debug: row.debug || {},
      updatedAt: row.updated_at
    };
  }

  function buildPrompt(prompt, history, summaries = null, factoids = [], options = {}) {
    const instructionRows = (options.systemInstructions || [])
      .map(row => String(row || '').trim())
      .filter(Boolean);
    const summaryRows = Object.values(summaries || {})
      .filter(row => row?.summary)
      .map(row => `${row.title || row.scope}: ${row.summary}`);
    const factRows = (factoids || [])
      .filter(row => row?.fact)
      .map(row => `${row.category || 'general'}: ${row.fact}`);
    const includeMemory = !isBareGreeting(prompt);
    const hasHistory = includeMemory && Array.isArray(history) && history.length > 0;
    const hasMemory = includeMemory && (summaryRows.length > 0 || factRows.length > 0 || hasHistory);

    if (!hasMemory && instructionRows.length === 0) {
      return ['<current_user_message>', prompt, '</current_user_message>'].join('\n');
    }

    const transcript = (history || [])
      .map(row => `${transcriptRoleLabel(row)}: ${row.content}`)
      .join('\n');

    const sections = [];

    if (instructionRows.length > 0) {
      sections.push('<instructions>', instructionRows.join('\n'), '</instructions>');
    }

    if (hasMemory) sections.push('<memory>');

    if (includeMemory && summaryRows.length > 0) {
      sections.push('<memory_summaries>', summaryRows.join('\n\n'), '</memory_summaries>');
    }

    if (includeMemory && factRows.length > 0) {
      sections.push('<user_factoids>', factRows.join('\n'), '</user_factoids>');
    }

    if (hasHistory) {
      sections.push('<recent_transcript>', transcript, '</recent_transcript>');
    }

    if (hasMemory) sections.push('</memory>');

    sections.push('<current_user_message>', prompt, '</current_user_message>');
    return sections.join('\n');
  }

  async function historyHandler(req, res) {
    try {
      const limit = req.query.limit || historyLimit;
      const conversationId = req.query.conversationId || 'default';
      const [rows, summaries] = await Promise.all([
        getRecent({ req, limit, conversationId }),
        getSummaries({ req })
      ]);
      const data = annotateMemoryProcessed(rows, summaries);
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
    clearAll,
    deleteFactoid,
    deleteMessage,
    getFactoids,
    getRecent,
    getMessages,
    getUnprocessedMessages,
    getMessageCount,
    getSummaries,
    historyHandler,
    managerHandler,
    saveFactoids,
    saveSummary,
    shutdown,
    summaryScopes: SUMMARY_SCOPES
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

function emotionForMessage(role, metadata = {}) {
  if (role !== 'assistant') return null;
  const rawEmotion = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata.emotion
    : '';
  return rawEmotion ? normalizeBobEmotion(rawEmotion) : null;
}

function hydrateMessageEmotion(row) {
  if (!row) return row;
  const emotion = row.emotion || emotionForMessage(row.role, row.metadata);
  const hydrated = {
    ...row,
    emotion,
    metadata: emotion ? { ...(row.metadata || {}), emotion } : (row.metadata || {})
  };
  const memorySequence = Number(row.memory_sequence || row.memorySequence || 0);
  if (memorySequence > 0) hydrated.memorySequence = memorySequence;
  delete hydrated.memory_sequence;
  return hydrated;
}

function annotateMemoryProcessed(rows = [], summaries = {}) {
  const processedCount = Number(summaries.short?.sourceMessageCount || 0);
  return (rows || []).map(row => {
    const memorySequence = Number(row.memorySequence || row.memory_sequence || 0);
    const memoryProcessed = memorySequence > 0 && memorySequence <= processedCount;
    return {
      ...row,
      memoryProcessed,
      metadata: {
        ...(row.metadata || {}),
        memoryProcessed
      }
    };
  });
}

function transcriptRoleLabel(row = {}) {
  if (row.role !== 'assistant') return 'User';
  const emotion = row.emotion || row.metadata?.emotion;
  return emotion ? `Assistant [emotion=${normalizeBobEmotion(emotion)}]` : 'Assistant';
}

function isBareGreeting(prompt = '') {
  return /^(hi|hello|hey|howdy|yo|sup|good morning|good afternoon|good evening)[!.\s]*$/i.test(String(prompt || '').trim());
}

function unprocessedMessageLimit({ summaries = {}, messageCount = 0, limit = DEFAULT_HISTORY_LIMIT } = {}) {
  const processedCount = Number(summaries.short?.sourceMessageCount || 0);
  const unprocessedCount = Math.max(0, Number(messageCount || 0) - processedCount);
  const safeLimit = Math.max(1, Number(limit) || DEFAULT_HISTORY_LIMIT);
  return Math.min(unprocessedCount, safeLimit);
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

module.exports = {
  SUMMARY_SCOPES,
  annotateMemoryProcessed,
  createMemoryStore,
  defaultSummaries,
  emotionForMessage,
  hydrateMessageEmotion,
  transcriptRoleLabel,
  unprocessedMessageLimit
};
