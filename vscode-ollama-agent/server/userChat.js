const { Pool } = require('pg');
const { databaseUserKey, userDisplayName, userEmail } = require('./userIdentity');

function getDisplayName(user = {}) {
  return userDisplayName(user);
}

function getEmail(user = {}) {
  return userEmail(user);
}

function createUserChatStore(logger) {
  const connectionString = process.env.MEMORY_DATABASE_URL;
  let pool;
  let ready;

  async function init() {
    if (!connectionString) {
      logger.warn('User chat disabled: MEMORY_DATABASE_URL is not set');
      return false;
    }

    pool = new Pool({ connectionString });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_chat_keys (
        user_key TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        public_key_jwk JSONB NOT NULL,
        fingerprint TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query("ALTER TABLE user_chat_keys ADD COLUMN IF NOT EXISTS fingerprint TEXT NOT NULL DEFAULT ''");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_chat_messages (
        id BIGSERIAL PRIMARY KEY,
        sender_key TEXT NOT NULL,
        recipient_key TEXT NOT NULL,
        sender_public_key_jwk JSONB NOT NULL,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        algorithm TEXT NOT NULL DEFAULT 'ECDH-P256-AES-GCM',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_user_chat_messages_recipient_created ON user_chat_messages (recipient_key, created_at DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_user_chat_messages_pair_created ON user_chat_messages (sender_key, recipient_key, created_at DESC)');
    logger.info('User chat database initialized');
    return true;
  }

  async function ensureReady() {
    if (!ready) {
      ready = init().catch(err => {
        logger.error('User chat initialization failed', err?.message || err);
        ready = null;
        return false;
      });
    }
    return ready;
  }

  async function upsertKey(req, res) {
    try {
      if (!(await ensureReady())) return res.status(503).json({ ok: false, error: 'User chat database unavailable' });
      const publicKeyJwk = req.body?.publicKeyJwk;
      const fingerprint = String(req.body?.fingerprint || '').trim().slice(0, 80);
      if (!publicKeyJwk || publicKeyJwk.kty !== 'EC' || publicKeyJwk.crv !== 'P-256' || !publicKeyJwk.x || !publicKeyJwk.y) {
        return res.status(400).json({ ok: false, error: 'Valid P-256 public key JWK required' });
      }

      await pool.query(
        `INSERT INTO user_chat_keys (user_key, name, email, public_key_jwk, fingerprint, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (user_key) DO UPDATE
         SET name = EXCLUDED.name,
             email = EXCLUDED.email,
             public_key_jwk = EXCLUDED.public_key_jwk,
             fingerprint = EXCLUDED.fingerprint,
             updated_at = now()`,
        [databaseUserKey(req.user), getDisplayName(req.user), getEmail(req.user), publicKeyJwk, fingerprint]
      );
      res.json({ ok: true });
    } catch (err) {
      logger.error('User chat key save failed', err?.message || err);
      res.status(500).json({ ok: false, error: 'Could not save chat public key' });
    }
  }

  async function listUsers(req, res) {
    try {
      if (!(await ensureReady())) return res.status(503).json({ ok: false, error: 'User chat database unavailable' });
      const query = String(req.query.q || '').trim();
      const hasActivityTable = Boolean((await pool.query("SELECT to_regclass('public.activity_user_state') AS table_name")).rows[0]?.table_name);
      const params = query ? [`%${query.toLowerCase()}%`] : [];
      const where = query ? `
        WHERE lower(COALESCE(name, '')) LIKE $1
           OR lower(COALESCE(email, '')) LIKE $1
           OR lower(user_key) LIKE $1
           OR lower(COALESCE(fingerprint, '')) LIKE $1
      ` : '';
      const sourceQuery = hasActivityTable ? `
        WITH directory AS (
          SELECT
            COALESCE(activity_user_state.user_key, user_chat_keys.user_key) AS user_key,
            COALESCE(NULLIF(activity_user_state.name, ''), NULLIF(user_chat_keys.name, ''), NULLIF(activity_user_state.email, ''), NULLIF(user_chat_keys.email, ''), COALESCE(activity_user_state.user_key, user_chat_keys.user_key)) AS name,
            COALESCE(NULLIF(activity_user_state.email, ''), NULLIF(user_chat_keys.email, '')) AS email,
            user_chat_keys.public_key_jwk,
            user_chat_keys.fingerprint,
            user_chat_keys.updated_at,
            activity_user_state.last_seen_at
          FROM activity_user_state
          FULL OUTER JOIN user_chat_keys ON user_chat_keys.user_key = activity_user_state.user_key
        )
        SELECT user_key, name, email, public_key_jwk, fingerprint, updated_at
        FROM directory
        ${where}
        ORDER BY (public_key_jwk IS NULL) ASC, last_seen_at DESC NULLS LAST, name ASC, email ASC
        LIMIT 100
      ` : `
        SELECT user_key, name, email, public_key_jwk, fingerprint, updated_at
        FROM user_chat_keys
        ${where}
        ORDER BY name ASC, email ASC
        LIMIT 100
      `;
      const result = await pool.query(sourceQuery, params);
      res.json({
        ok: true,
        data: result.rows.map(row => ({
          userKey: row.user_key,
          name: row.name || row.email || row.user_key,
          email: row.email || '',
          publicKeyJwk: row.public_key_jwk || null,
          fingerprint: row.fingerprint || '',
          updatedAt: row.updated_at,
          canChat: Boolean(row.public_key_jwk),
          isSelf: row.user_key === databaseUserKey(req.user)
        }))
      });
    } catch (err) {
      logger.error('User chat user list failed', err?.message || err);
      res.status(500).json({ ok: false, error: 'Could not load chat users' });
    }
  }

  async function sendMessage(req, res) {
    try {
      if (!(await ensureReady())) return res.status(503).json({ ok: false, error: 'User chat database unavailable' });
      const recipientKey = String(req.body?.recipientKey || '').trim();
      const ciphertext = String(req.body?.ciphertext || '').trim();
      const iv = String(req.body?.iv || '').trim();

      if (!recipientKey || !ciphertext || !iv) {
        return res.status(400).json({ ok: false, error: 'recipientKey, ciphertext, and iv are required' });
      }

      const senderKey = databaseUserKey(req.user);
      const keys = await pool.query(
        `SELECT user_key, public_key_jwk
         FROM user_chat_keys
         WHERE user_key = ANY($1::text[])`,
        [[senderKey, recipientKey]]
      );
      const senderPublicKeyJwk = keys.rows.find(row => row.user_key === senderKey)?.public_key_jwk;
      const recipientExists = keys.rows.some(row => row.user_key === recipientKey);

      if (!senderPublicKeyJwk) {
        return res.status(400).json({ ok: false, error: 'Sender chat key is not registered' });
      }
      if (!recipientExists) {
        return res.status(404).json({ ok: false, error: 'Recipient chat key was not found' });
      }

      const result = await pool.query(
        `INSERT INTO user_chat_messages (sender_key, recipient_key, sender_public_key_jwk, ciphertext, iv)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, sender_key, recipient_key, sender_public_key_jwk, ciphertext, iv, algorithm, created_at`,
        [senderKey, recipientKey, senderPublicKeyJwk, ciphertext, iv]
      );
      res.json({ ok: true, data: mapMessage(result.rows[0], senderKey) });
    } catch (err) {
      logger.error('User chat message send failed', err?.message || err);
      res.status(500).json({ ok: false, error: 'Could not send encrypted message' });
    }
  }

  async function listMessages(req, res) {
    try {
      if (!(await ensureReady())) return res.status(503).json({ ok: false, error: 'User chat database unavailable' });
      const self = databaseUserKey(req.user);
      const withUser = String(req.query.with || '').trim();
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
      const params = withUser ? [self, withUser, limit] : [self, limit];
      const query = withUser ? `
        SELECT id, sender_key, recipient_key, sender_public_key_jwk, ciphertext, iv, algorithm, created_at
        FROM user_chat_messages
        WHERE (sender_key = $1 AND recipient_key = $2)
           OR (sender_key = $2 AND recipient_key = $1)
        ORDER BY created_at DESC
        LIMIT $3
      ` : `
        SELECT id, sender_key, recipient_key, sender_public_key_jwk, ciphertext, iv, algorithm, created_at
        FROM user_chat_messages
        WHERE sender_key = $1 OR recipient_key = $1
        ORDER BY created_at DESC
        LIMIT $2
      `;
      const result = await pool.query(query, params);
      res.json({ ok: true, data: result.rows.reverse().map(row => mapMessage(row, self)) });
    } catch (err) {
      logger.error('User chat message list failed', err?.message || err);
      res.status(500).json({ ok: false, error: 'Could not load encrypted messages' });
    }
  }

  async function shutdown() {
    if (pool) await pool.end();
  }

  return { listMessages, listUsers, sendMessage, shutdown, upsertKey };
}

function mapMessage(row, self) {
  return {
    id: row.id,
    senderKey: row.sender_key,
    recipientKey: row.recipient_key,
    senderPublicKeyJwk: row.sender_public_key_jwk,
    ciphertext: row.ciphertext,
    iv: row.iv,
    algorithm: row.algorithm,
    createdAt: row.created_at,
    direction: row.sender_key === self ? 'sent' : 'received'
  };
}

module.exports = { createUserChatStore };
