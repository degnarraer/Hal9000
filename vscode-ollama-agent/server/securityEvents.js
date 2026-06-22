const { Pool } = require('pg');
const { databaseUserKey, systemUserKey } = require('./userIdentity');

const RETENTION_DAYS = 30;

function requestIp(req = {}) {
  return String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '')
    .split(',')[0]
    .trim();
}

function actorFromReq(req = {}) {
  const user = req.user || {};
  if (user.systemKey) return systemUserKey(user.systemKey);
  try {
    return databaseUserKey(user);
  } catch (err) {
    return 'anonymous';
  }
}

function createSecurityEventStore(logger) {
  const connectionString = process.env.MEMORY_DATABASE_URL;
  let pool;
  let ready;
  const fallbackEvents = [];

  async function init() {
    if (!connectionString) {
      logger.warn('Security event database disabled: MEMORY_DATABASE_URL is not set');
      return false;
    }

    pool = new Pool({ connectionString });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS security_events (
        id BIGSERIAL PRIMARY KEY,
        severity TEXT NOT NULL,
        type TEXT NOT NULL,
        actor TEXT NOT NULL DEFAULT 'anonymous',
        method TEXT NOT NULL DEFAULT '',
        path TEXT NOT NULL DEFAULT '',
        status INTEGER,
        ip TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        detail TEXT NOT NULL DEFAULT '',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events (created_at DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_security_events_type_created ON security_events (type, created_at DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_security_events_severity_created ON security_events (severity, created_at DESC)');
    logger.info('Security event database initialized');
    return true;
  }

  async function ensureReady() {
    if (!ready) {
      ready = init().catch(err => {
        logger.error('Security event database initialization failed', err?.message || err);
        ready = null;
        return false;
      });
    }
    return ready;
  }

  async function record(req, event = {}) {
    const entry = {
      severity: event.severity || 'info',
      type: event.type || 'security_event',
      actor: event.actor || actorFromReq(req),
      method: req?.method || '',
      path: req?.originalUrl || req?.path || '',
      status: event.status || null,
      ip: requestIp(req),
      userAgent: String(req?.headers?.['user-agent'] || ''),
      detail: event.detail || '',
      metadata: event.metadata || {},
      createdAt: new Date().toISOString()
    };

    if (!(await ensureReady())) {
      fallbackEvents.push(entry);
      while (fallbackEvents.length > 500) fallbackEvents.shift();
      return entry;
    }

    try {
      await pool.query(
        `INSERT INTO security_events
          (severity, type, actor, method, path, status, ip, user_agent, detail, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          entry.severity,
          entry.type,
          entry.actor,
          entry.method,
          entry.path,
          entry.status,
          entry.ip,
          entry.userAgent,
          entry.detail,
          JSON.stringify(entry.metadata)
        ]
      );
      await pool.query(
        `DELETE FROM security_events
         WHERE created_at < now() - ($1::text || ' days')::interval`,
        [RETENTION_DAYS]
      );
    } catch (err) {
      logger.error('Security event write failed', err?.message || err);
    }

    return entry;
  }

  async function dashboard(req, res) {
    try {
      if (!(await ensureReady())) {
        return res.json({
          ok: true,
          data: {
            persistent: false,
            summary: summarize(fallbackEvents),
            events: fallbackEvents.slice(-100).reverse(),
            timeline: []
          }
        });
      }

      const [summaryResult, eventsResult, timelineResult] = await Promise.all([
        pool.query(`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE severity = 'critical')::int AS critical,
            COUNT(*) FILTER (WHERE severity = 'warn')::int AS warnings,
            COUNT(*) FILTER (WHERE type = 'auth_failure')::int AS auth_failures,
            COUNT(*) FILTER (WHERE type = 'admin_denied')::int AS admin_denied
          FROM security_events
          WHERE created_at > now() - interval '24 hours'
        `),
        pool.query(`
          SELECT severity, type, actor, method, path, status, ip, user_agent, detail, metadata, created_at
          FROM security_events
          ORDER BY created_at DESC
          LIMIT 100
        `),
        pool.query(`
          SELECT date_trunc('minute', created_at) AS bucket,
                 COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE severity IN ('warn', 'critical'))::int AS notable
          FROM security_events
          WHERE created_at > now() - interval '60 minutes'
          GROUP BY bucket
          ORDER BY bucket ASC
        `)
      ]);

      res.json({
        ok: true,
        data: {
          persistent: true,
          summary: summaryResult.rows[0],
          events: eventsResult.rows,
          timeline: timelineResult.rows
        }
      });
    } catch (err) {
      logger.error('Security event dashboard failed', err?.message || err);
      res.status(500).json({ ok: false, error: 'Security dashboard unavailable' });
    }
  }

  async function shutdown() {
    if (pool) await pool.end();
  }

  return { dashboard, record, shutdown };
}

function summarize(events) {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = events.filter(event => new Date(event.createdAt).getTime() > since);
  return {
    total: recent.length,
    critical: recent.filter(event => event.severity === 'critical').length,
    warnings: recent.filter(event => event.severity === 'warn').length,
    auth_failures: recent.filter(event => event.type === 'auth_failure').length,
    admin_denied: recent.filter(event => event.type === 'admin_denied').length
  };
}

module.exports = { actorFromReq, createSecurityEventStore, requestIp, summarize };
