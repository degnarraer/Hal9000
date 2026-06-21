const { Pool } = require('pg');

const ADMIN_ROLE = 'admin';
const USER_ROLE = 'user';

function userKey(user = {}) {
  return user.sub || user.email || user.preferred_username || user.name || 'anonymous';
}

function userEmail(user = {}) {
  return String(user.email || user.preferred_username || user.upn || '').toLowerCase();
}

function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'administrator') return ADMIN_ROLE;
  return value;
}

function rolesFromClaims(user = {}) {
  const sources = [
    user.roles,
    user.groups,
    user.realm_access?.roles,
    user.resource_access?.['ollama-agent']?.roles
  ];
  const roles = new Set([USER_ROLE]);

  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    source.map(normalizeRole).filter(Boolean).forEach(role => roles.add(role));
  }

  return roles;
}

function isLocalRequest(req) {
  const host = String(req.headers.host || '').toLowerCase().split(':')[0];
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').toLowerCase().split(':')[0];
  const remote = String(req.socket?.remoteAddress || '');
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', 'app.localhost']);

  return localHosts.has(host)
    || localHosts.has(forwardedHost)
    || remote === '127.0.0.1'
    || remote === '::1'
    || remote === '::ffff:127.0.0.1';
}

function createAdminStore(logger, securityEvents = null) {
  const connectionString = process.env.MEMORY_DATABASE_URL;
  const bootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN || '';
  const bootstrapUsers = String(process.env.ADMIN_BOOTSTRAP_USERS || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  let pool;
  let ready;

  async function init() {
    if (!connectionString) {
      logger.warn('Admin role database disabled: MEMORY_DATABASE_URL is not set');
      return false;
    }

    pool = new Pool({ connectionString });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_user_roles (
        user_key TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL,
        granted_by TEXT NOT NULL DEFAULT 'system',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_key, role)
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_app_user_roles_role ON app_user_roles (role)');
    logger.info('Admin role database initialized');
    return true;
  }

  async function ensureReady() {
    if (!ready) {
      ready = init().catch(err => {
        logger.error('Admin role database initialization failed', err?.message || err);
        ready = null;
        return false;
      });
    }
    return ready;
  }

  async function getRolesForUser(user) {
    const roles = rolesFromClaims(user);
    if (!(await ensureReady())) return Array.from(roles).sort();
    try {
      const result = await pool.query(
        'SELECT role FROM app_user_roles WHERE user_key = $1 ORDER BY role',
        [userKey(user)]
      );
      result.rows.map(row => normalizeRole(row.role)).filter(Boolean).forEach(role => roles.add(role));
      return Array.from(roles).sort();
    } catch (err) {
      logger.error('Admin role lookup failed', err?.message || err);
      return Array.from(roles).sort();
    }
  }

  async function countAdmins() {
    if (!(await ensureReady())) return 0;
    const result = await pool.query('SELECT COUNT(*)::int AS count FROM app_user_roles WHERE role = $1', [ADMIN_ROLE]);
    return result.rows[0]?.count || 0;
  }

  function isBootstrapAuthorized(req) {
    if (isLocalRequest(req)) return true;
    const user = req.user || {};
    const identifiers = [
      user.sub,
      user.email,
      user.preferred_username,
      user.upn,
      user.name
    ].filter(Boolean).map(value => String(value).toLowerCase());
    if (bootstrapUsers.length && identifiers.some(value => bootstrapUsers.includes(value))) return true;
    if (!bootstrapToken) return false;
    const supplied = req.headers['x-admin-bootstrap-token'] || req.body?.token || req.query.token;
    return supplied && supplied === bootstrapToken;
  }

  async function canBootstrap(req) {
    return (await countAdmins()) === 0 && isBootstrapAuthorized(req);
  }

  async function grantRole(user, role, grantedBy = 'system') {
    if (!(await ensureReady())) throw new Error('Role database unavailable');
    const normalizedRole = normalizeRole(role);
    if (!normalizedRole) throw new Error('Role is required');
    await pool.query(
      `INSERT INTO app_user_roles (user_key, email, role, granted_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_key, role) DO UPDATE
       SET email = EXCLUDED.email`,
      [userKey(user), userEmail(user), normalizedRole, grantedBy]
    );
  }

  async function revokeRole(user, role) {
    if (!(await ensureReady())) throw new Error('Role database unavailable');
    const normalizedRole = normalizeRole(role);
    if (!normalizedRole || normalizedRole === USER_ROLE) throw new Error('Role cannot be removed');
    await pool.query(
      'DELETE FROM app_user_roles WHERE user_key = $1 AND role = $2',
      [userKey(user), normalizedRole]
    );
  }

  async function listUsers(req, res) {
    try {
      if (!(await ensureReady())) {
        const current = req.user || {};
        return res.json({
          ok: true,
          data: {
            persistent: false,
            users: [{
              userKey: userKey(current),
              name: current.name || current.preferred_username || current.email || 'Signed in user',
              email: userEmail(current),
              roles: req.roles || [USER_ROLE],
              appRoles: [],
              firstSeenAt: null,
              lastSeenAt: null,
              currentAction: 'Current session',
              activeRequests: 0,
              online: true
            }]
          }
        });
      }

      const activityTable = await pool.query("SELECT to_regclass('public.activity_user_state') AS table_name");
      const hasActivityTable = Boolean(activityTable.rows[0]?.table_name);
      const query = hasActivityTable ? `
          WITH role_users AS (
            SELECT user_key, MAX(email) AS email, jsonb_agg(role ORDER BY role) AS app_roles
            FROM app_user_roles
            GROUP BY user_key
          )
          SELECT
            COALESCE(activity_user_state.user_key, role_users.user_key) AS user_key,
            COALESCE(NULLIF(activity_user_state.name, ''), NULLIF(activity_user_state.email, ''), NULLIF(role_users.email, ''), COALESCE(activity_user_state.user_key, role_users.user_key)) AS name,
            COALESCE(NULLIF(activity_user_state.email, ''), NULLIF(role_users.email, '')) AS email,
            COALESCE(activity_user_state.roles, '[]'::jsonb) AS claim_roles,
            COALESCE(role_users.app_roles, '[]'::jsonb) AS app_roles,
            activity_user_state.current_action,
            activity_user_state.last_action,
            activity_user_state.active_requests,
            activity_user_state.first_seen_at,
            activity_user_state.last_seen_at,
            activity_user_state.last_seen_at > now() - interval '5 minutes' AS online
          FROM activity_user_state
          FULL OUTER JOIN role_users ON role_users.user_key = activity_user_state.user_key
          ORDER BY online DESC NULLS LAST, activity_user_state.last_seen_at DESC NULLS LAST, email ASC NULLS LAST
        ` : `
          SELECT
            user_key,
            COALESCE(NULLIF(MAX(email), ''), user_key) AS name,
            MAX(email) AS email,
            '[]'::jsonb AS claim_roles,
            jsonb_agg(role ORDER BY role) AS app_roles,
            'Idle' AS current_action,
            'Idle' AS last_action,
            0 AS active_requests,
            NULL::timestamptz AS first_seen_at,
            NULL::timestamptz AS last_seen_at,
            false AS online
          FROM app_user_roles
          GROUP BY user_key
          ORDER BY email ASC NULLS LAST
        `;
      const result = await pool.query(query);

      const users = result.rows.map(row => {
        const claimRoles = Array.isArray(row.claim_roles) ? row.claim_roles : [];
        const appRoles = Array.isArray(row.app_roles) ? row.app_roles : [];
        const roles = Array.from(new Set([USER_ROLE, ...claimRoles, ...appRoles].map(normalizeRole).filter(Boolean))).sort();
        return {
          userKey: row.user_key,
          name: row.name || row.email || row.user_key,
          email: row.email || '',
          roles,
          appRoles,
          firstSeenAt: row.first_seen_at,
          lastSeenAt: row.last_seen_at,
          currentAction: row.current_action || 'Idle',
          lastAction: row.last_action || 'Idle',
          activeRequests: Number(row.active_requests || 0),
          online: Boolean(row.online)
        };
      });

      res.json({ ok: true, data: { persistent: true, users } });
    } catch (err) {
      logger.error('Admin users list failed', err?.message || err);
      res.status(500).json({ ok: false, error: 'Users unavailable' });
    }
  }

  async function setUserAdmin(req, res) {
    try {
      const target = {
        sub: req.params.userKey,
        email: req.body?.email || '',
        name: req.body?.name || req.params.userKey
      };
      const grantedBy = userEmail(req.user) || userKey(req.user);
      await grantRole(target, ADMIN_ROLE, grantedBy);
      res.json({ ok: true });
    } catch (err) {
      logger.error('Admin role grant failed', err?.message || err);
      res.status(500).json({ ok: false, error: 'Could not grant admin role' });
    }
  }

  async function removeUserAdmin(req, res) {
    try {
      if (req.params.userKey === userKey(req.user) && (await countAdmins()) <= 1) {
        return res.status(400).json({ ok: false, error: 'Cannot remove the last admin role from yourself' });
      }
      await revokeRole({ sub: req.params.userKey }, ADMIN_ROLE);
      res.json({ ok: true });
    } catch (err) {
      logger.error('Admin role revoke failed', err?.message || err);
      res.status(500).json({ ok: false, error: 'Could not revoke admin role' });
    }
  }

  async function bootstrapStatus(req, res) {
    try {
      const adminCount = await countAdmins();
      res.json({
        ok: true,
        data: {
          adminCount,
          canBootstrap: adminCount === 0 && isBootstrapAuthorized(req),
          localRequest: isLocalRequest(req),
          bootstrapUserConfigured: bootstrapUsers.length > 0,
          tokenConfigured: Boolean(bootstrapToken)
        }
      });
    } catch (err) {
      logger.error('Admin bootstrap status failed', err?.message || err);
      res.status(500).json({ ok: false, error: 'Bootstrap status unavailable' });
    }
  }

  async function bootstrapSelf(req, res) {
    try {
      if (!(await canBootstrap(req))) {
        return res.status(403).json({ ok: false, error: 'Admin bootstrap is not available' });
      }

      await grantRole(req.user, ADMIN_ROLE, 'bootstrap');
      res.json({ ok: true, data: { roles: [ADMIN_ROLE] } });
    } catch (err) {
      logger.error('Admin bootstrap failed', err?.message || err);
      res.status(500).json({ ok: false, error: 'Admin bootstrap failed' });
    }
  }

  function requireAdmin(req, res, next) {
    if (req.roles?.includes(ADMIN_ROLE)) return next();
    securityEvents?.record?.(req, {
      severity: 'warn',
      type: 'admin_denied',
      status: 403,
      detail: 'Administrator role required'
    }).catch(err => logger.error('Security event record failed', err?.message || err));
    return res.status(403).json({ ok: false, error: 'Administrator role required' });
  }

  async function attachRoles(req, res, next) {
    req.roles = await getRolesForUser(req.user || {});
    next();
  }

  async function shutdown() {
    if (pool) await pool.end();
  }

  return {
    attachRoles,
    bootstrapSelf,
    bootstrapStatus,
    getRolesForUser,
    listUsers,
    requireAdmin,
    removeUserAdmin,
    setUserAdmin,
    shutdown
  };
}

module.exports = {
  ADMIN_ROLE,
  USER_ROLE,
  createAdminStore,
  normalizeRole,
  rolesFromClaims,
  userKey
};
