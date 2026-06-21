const { Pool } = require('pg');

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const ACTIVE_WINDOW_MS = 20 * 1000;
const SAMPLE_INTERVAL_MS = 5 * 1000;
const SAMPLE_RETENTION_HOURS = 24;

function userKey(user = {}) {
  return user.sub || user.email || user.preferred_username || user.name || 'anonymous';
}

function isTrackableUser(user = {}) {
  const key = userKey(user);
  return key && !['anonymous', 'public-asset', 'public-route', 'auth-login', 'auth-start', 'auth-register', 'auth-callback', 'auth-logout', 'local-dev'].includes(key);
}

function userLabel(user = {}) {
  return user.email || user.preferred_username || user.name || user.sub || 'Authenticated user';
}

function routeLabel(req) {
  if (req.path === '/api/chat') return 'Chat request';
  if (req.path === '/api/stream') return 'Streaming chat';
  if (req.path.startsWith('/api/ollama/pull')) return 'Downloading model';
  if (req.path.startsWith('/api/ollama/remove')) return 'Removing model';
  if (req.path.startsWith('/api/ollama/monitor')) return 'Viewing Ollama monitor';
  if (req.path.startsWith('/api/logs')) return 'Viewing logs';
  if (req.path.startsWith('/api/activity')) return 'Viewing activity dashboard';
  if (req.path.startsWith('/api/auth')) return 'Checking account';
  if (req.path.startsWith('/menu-pages')) return 'Opening menu page';
  if (req.path.startsWith('/api/')) return `${req.method} ${req.path}`;
  return req.path === '/' ? 'Viewing chat' : `Viewing ${req.path}`;
}

function chunkBytes(chunk, encoding) {
  if (!chunk || typeof chunk === 'function') return 0;
  return Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk), encoding);
}

function createActivityMonitor(logger) {
  const connectionString = process.env.MEMORY_DATABASE_URL;
  let pool;
  let ready;
  let bucketStartedAt = Date.now();
  let uploadBytes = 0;
  let downloadBytes = 0;
  let requestCount = 0;
  const fallbackUsers = new Map();
  const fallbackSamples = [];

  async function init() {
    if (!connectionString) {
      logger.warn('Activity database disabled: MEMORY_DATABASE_URL is not set');
      return false;
    }

    pool = new Pool({ connectionString });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS activity_user_state (
        user_key TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        roles JSONB NOT NULL DEFAULT '[]'::jsonb,
        current_action TEXT NOT NULL DEFAULT 'Idle',
        last_action TEXT NOT NULL DEFAULT 'Idle',
        active_requests INTEGER NOT NULL DEFAULT 0,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS activity_events (
        id BIGSERIAL PRIMARY KEY,
        user_key TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status INTEGER,
        upload_bytes BIGINT NOT NULL DEFAULT 0,
        download_bytes BIGINT NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS activity_samples (
        id BIGSERIAL PRIMARY KEY,
        sampled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        upload_bps BIGINT NOT NULL DEFAULT 0,
        download_bps BIGINT NOT NULL DEFAULT 0,
        requests INTEGER NOT NULL DEFAULT 0,
        online_users INTEGER NOT NULL DEFAULT 0
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_activity_events_created ON activity_events (created_at DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_activity_samples_sampled ON activity_samples (sampled_at DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_activity_user_state_seen ON activity_user_state (last_seen_at DESC)');
    await pool.query(
      `DELETE FROM activity_user_state
       WHERE user_key IN ('anonymous', 'public-asset', 'public-route', 'auth-login', 'auth-start', 'auth-register', 'auth-callback', 'auth-logout', 'local-dev')`
    );
    logger.info('Activity database initialized');
    return true;
  }

  async function ensureReady() {
    if (!ready) {
      ready = init().catch(err => {
        logger.error('Activity database initialization failed', err?.message || err);
        ready = null;
        return false;
      });
    }
    return ready;
  }

  async function flushBucket() {
    const now = Date.now();
    if (now - bucketStartedAt < SAMPLE_INTERVAL_MS) return;

    const seconds = Math.max((now - bucketStartedAt) / 1000, 1);
    const sample = {
      sampledAt: new Date(now).toISOString(),
      uploadBps: Math.round(uploadBytes / seconds),
      downloadBps: Math.round(downloadBytes / seconds),
      requests: requestCount
    };

    if (await ensureReady()) {
      try {
        const online = await countOnlineUsers();
        await pool.query(
          `INSERT INTO activity_samples (sampled_at, upload_bps, download_bps, requests, online_users)
           VALUES (now(), $1, $2, $3, $4)`,
          [sample.uploadBps, sample.downloadBps, sample.requests, online]
        );
        await pool.query(
          `DELETE FROM activity_samples
           WHERE sampled_at < now() - ($1::text || ' hours')::interval`,
          [SAMPLE_RETENTION_HOURS]
        );
      } catch (err) {
        logger.error('Activity sample write failed', err?.message || err);
      }
    } else {
      sample.onlineUsers = onlineFallbackUsers().length;
      fallbackSamples.push(sample);
      while (fallbackSamples.length > 120) fallbackSamples.shift();
    }

    bucketStartedAt = now;
    uploadBytes = 0;
    downloadBytes = 0;
    requestCount = 0;
  }

  async function countOnlineUsers() {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM activity_user_state
       WHERE last_seen_at > now() - ($1::text || ' milliseconds')::interval`,
      [ONLINE_WINDOW_MS]
    );
    return result.rows[0]?.count || 0;
  }

  function onlineFallbackUsers() {
    const now = Date.now();
    return Array.from(fallbackUsers.values()).filter(user => now - user.lastSeenAt <= ONLINE_WINDOW_MS);
  }

  async function upsertUserState({ user, roles, action, activeDelta }) {
    const key = userKey(user);
    const name = user.name || user.preferred_username || user.email || 'Signed in user';
    const email = userLabel(user);

    if (!(await ensureReady())) {
      const existing = fallbackUsers.get(key) || {
        key,
        name,
        email,
        roles,
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
        activeRequests: 0,
        lastAction: action,
        currentAction: action
      };
      existing.name = name;
      existing.email = email;
      existing.roles = roles;
      existing.lastSeenAt = Date.now();
      existing.lastAction = action || existing.lastAction;
      existing.currentAction = activeDelta < 0 && existing.activeRequests <= 1 ? 'Idle' : (action || existing.currentAction);
      existing.activeRequests = Math.max(0, existing.activeRequests + activeDelta);
      fallbackUsers.set(key, existing);
      return;
    }

    await pool.query(
      `INSERT INTO activity_user_state
        (user_key, name, email, roles, current_action, last_action, active_requests, first_seen_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $5, GREATEST(0, $6), now(), now())
       ON CONFLICT (user_key) DO UPDATE
       SET name = EXCLUDED.name,
           email = EXCLUDED.email,
           roles = EXCLUDED.roles,
           current_action = CASE
             WHEN activity_user_state.active_requests + $6 <= 0 AND $6 < 0 THEN 'Idle'
             WHEN $5 <> '' THEN $5
             ELSE activity_user_state.current_action
           END,
           last_action = CASE WHEN $5 <> '' THEN $5 ELSE activity_user_state.last_action END,
           active_requests = GREATEST(0, activity_user_state.active_requests + $6),
           last_seen_at = now()`,
      [key, name, email, JSON.stringify(roles || ['user']), action || '', activeDelta]
    );
  }

  async function insertEvent(event) {
    if (!(await ensureReady())) return;
    try {
      await pool.query(
        `INSERT INTO activity_events
          (user_key, email, action, method, path, status, upload_bytes, download_bytes, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          event.userKey,
          event.email,
          event.action,
          event.method,
          event.path,
          event.status,
          event.uploadBytes,
          event.downloadBytes,
          event.durationMs
        ]
      );
    } catch (err) {
      logger.error('Activity event write failed', err?.message || err);
    }
  }

  function record(req, res, next) {
    const started = Date.now();
    const user = req.user || {};
    if (!isTrackableUser(user)) return next();

    const roles = req.roles || ['user'];
    const action = routeLabel(req);
    const key = userKey(user);
    const email = userLabel(user);
    const requestUploadBytes = Number(req.headers['content-length'] || 0) || 0;
    let responseDownloadBytes = 0;

    uploadBytes += requestUploadBytes;
    requestCount += 1;
    upsertUserState({ user, roles, action, activeDelta: 1 }).catch(err => logger.error('Activity user update failed', err?.message || err));

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    res.write = (chunk, encoding, cb) => {
      responseDownloadBytes += chunkBytes(chunk, encoding);
      return originalWrite(chunk, encoding, cb);
    };

    res.end = (chunk, encoding, cb) => {
      responseDownloadBytes += chunkBytes(chunk, encoding);
      return originalEnd(chunk, encoding, cb);
    };

    res.on('finish', () => {
      downloadBytes += responseDownloadBytes;
      upsertUserState({ user, roles, action: '', activeDelta: -1 }).catch(err => logger.error('Activity user finish failed', err?.message || err));
      insertEvent({
        userKey: key,
        email,
        action,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        uploadBytes: requestUploadBytes,
        downloadBytes: responseDownloadBytes,
        durationMs: Date.now() - started
      });
      flushBucket().catch(err => logger.error('Activity sample flush failed', err?.message || err));
    });

    flushBucket().catch(err => logger.error('Activity sample flush failed', err?.message || err));
    next();
  }

  async function dashboard(req, res) {
    try {
      await flushBucket();
      if (!(await ensureReady())) {
        const now = Date.now();
        return res.json({
          ok: true,
          data: {
            onlineCount: onlineFallbackUsers().length,
            users: onlineFallbackUsers().map(user => ({
              name: user.name,
              email: user.email,
              roles: user.roles,
              action: now - user.lastSeenAt <= ACTIVE_WINDOW_MS ? user.currentAction : 'Idle',
              lastAction: user.lastAction,
              activeRequests: user.activeRequests,
              lastSeenAt: new Date(user.lastSeenAt).toISOString()
            })),
            samples: fallbackSamples.slice(-60),
            recentEvents: [],
            persistent: false
          }
        });
      }

      const [usersResult, samplesResult, eventsResult] = await Promise.all([
        pool.query(
          `SELECT name, email, roles, current_action, last_action, active_requests, last_seen_at
           FROM activity_user_state
           WHERE last_seen_at > now() - ($1::text || ' milliseconds')::interval
           ORDER BY last_seen_at DESC`,
          [ONLINE_WINDOW_MS]
        ),
        pool.query(
          `SELECT sampled_at, upload_bps, download_bps, requests, online_users
           FROM activity_samples
           ORDER BY sampled_at DESC
           LIMIT 60`
        ),
        pool.query(
          `SELECT email, action, method, path, status, upload_bytes, download_bytes, duration_ms, created_at
           FROM activity_events
           ORDER BY created_at DESC
           LIMIT 12`
        )
      ]);

      const users = usersResult.rows.map(row => {
        const lastSeenAt = new Date(row.last_seen_at).getTime();
        return {
          name: row.name,
          email: row.email,
          roles: row.roles,
          action: Date.now() - lastSeenAt <= ACTIVE_WINDOW_MS ? row.current_action : 'Idle',
          lastAction: row.last_action,
          activeRequests: row.active_requests,
          lastSeenAt: row.last_seen_at
        };
      });

      res.json({
        ok: true,
        data: {
          onlineCount: users.length,
          users,
          samples: samplesResult.rows.reverse().map(row => ({
            sampledAt: row.sampled_at,
            uploadBps: Number(row.upload_bps),
            downloadBps: Number(row.download_bps),
            requests: row.requests,
            onlineUsers: row.online_users
          })),
          recentEvents: eventsResult.rows,
          persistent: true
        }
      });
    } catch (err) {
      logger.error('Activity dashboard failed', err?.message || err);
      res.status(500).json({ ok: false, error: 'Activity dashboard unavailable' });
    }
  }

  async function shutdown() {
    if (pool) await pool.end();
  }

  return { dashboard, record, shutdown };
}

module.exports = {
  createActivityMonitor,
  chunkBytes,
  isTrackableUser,
  routeLabel,
  userKey
};
