const crypto = require('crypto');
const axios = require('axios');
const { Pool } = require('pg');
const { requestDatabaseUserKey } = require('./userIdentity');

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function jsonBase64url(value) {
  return base64url(JSON.stringify(value));
}

function parseJwtPayload(token) {
  const part = String(token || '').split('.')[1];
  if (!part) return {};
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch (err) {
    return {};
  }
}

function createYahooStore(logger) {
  const enabled = String(process.env.YAHOO_ENABLED || 'true').toLowerCase() !== 'false';
  const connectionString = process.env.YAHOO_DATABASE_URL || process.env.MEMORY_DATABASE_URL;
  const clientId = process.env.YAHOO_CLIENT_ID || '';
  const clientSecret = process.env.YAHOO_CLIENT_SECRET || '';
  const redirectUri = process.env.YAHOO_REDIRECT_URI || '';
  const authUrl = process.env.YAHOO_OAUTH_AUTH_URL || 'https://api.login.yahoo.com/oauth2/request_auth';
  const tokenUrl = process.env.YAHOO_OAUTH_TOKEN_URL || 'https://api.login.yahoo.com/oauth2/get_token';
  const scope = process.env.YAHOO_OAUTH_SCOPE || 'openid email';
  const appUrl = process.env.APP_SITE || process.env.PUBLIC_APP_URL || '/';
  let pool;
  let ready;

  function configured() {
    return Boolean(enabled && connectionString && clientId && clientSecret && redirectUri);
  }

  function encryptionKey() {
    const raw = process.env.YAHOO_TOKEN_ENCRYPTION_KEY || process.env.TOKEN_ENCRYPTION_KEY || clientSecret;
    return crypto.createHash('sha256').update(String(raw || 'missing-yahoo-secret')).digest();
  }

  function encrypt(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(String(value || ''), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
  }

  function decrypt(value) {
    if (!value) return '';
    const [ivText, tagText, ciphertextText] = String(value).split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  }

  function signState(payload) {
    const body = jsonBase64url(payload);
    const sig = crypto
      .createHmac('sha256', clientSecret || 'missing-yahoo-secret')
      .update(body)
      .digest('base64url');
    return `${body}.${sig}`;
  }

  function verifyState(state) {
    const [body, sig] = String(state || '').split('.');
    if (!body || !sig) throw new Error('Invalid OAuth state');
    const expected = crypto
      .createHmac('sha256', clientSecret || 'missing-yahoo-secret')
      .update(body)
      .digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      throw new Error('Invalid OAuth state signature');
    }
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) throw new Error('OAuth state expired');
    return payload;
  }

  async function init() {
    if (!enabled) return false;
    if (!connectionString) {
      logger.warn('Yahoo skill disabled: YAHOO_DATABASE_URL or MEMORY_DATABASE_URL is not set');
      return false;
    }

    pool = new Pool({ connectionString });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS yahoo_oauth_accounts (
        user_key TEXT PRIMARY KEY,
        yahoo_guid TEXT,
        yahoo_email TEXT,
        display_name TEXT,
        scope TEXT NOT NULL DEFAULT '',
        access_token_enc TEXT,
        refresh_token_enc TEXT,
        id_token_enc TEXT,
        token_type TEXT,
        expires_at TIMESTAMPTZ,
        raw_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_yahoo_oauth_accounts_email ON yahoo_oauth_accounts (yahoo_email)');
    logger.info('Yahoo OAuth database initialized');
    return true;
  }

  async function ensureReady() {
    if (!enabled) return false;
    if (!ready) {
      ready = init().catch(err => {
        logger.error('Yahoo OAuth database initialization failed', err?.message || err);
        ready = null;
        return false;
      });
    }
    return ready;
  }

  async function getAccount(req) {
    if (!(await ensureReady())) return null;
    const result = await pool.query(
      `SELECT user_key, yahoo_guid, yahoo_email, display_name, scope, token_type, expires_at, raw_profile, created_at, updated_at
       FROM yahoo_oauth_accounts
       WHERE user_key = $1`,
      [requestDatabaseUserKey(req)]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      userKey: row.user_key,
      yahooGuid: row.yahoo_guid,
      yahooEmail: row.yahoo_email,
      displayName: row.display_name,
      scope: row.scope,
      tokenType: row.token_type,
      expiresAt: row.expires_at,
      profile: row.raw_profile,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async function saveTokens(req, tokenData) {
    if (!(await ensureReady())) throw new Error('Yahoo OAuth database unavailable');
    const profile = parseJwtPayload(tokenData.id_token);
    const yahooGuid = profile.sub || tokenData.xoauth_yahoo_guid || '';
    const yahooEmail = profile.email || '';
    const displayName = profile.name || profile.nickname || yahooEmail || yahooGuid || 'Yahoo account';
    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + (Number(tokenData.expires_in) * 1000))
      : null;

    await pool.query(
      `INSERT INTO yahoo_oauth_accounts
        (user_key, yahoo_guid, yahoo_email, display_name, scope, access_token_enc, refresh_token_enc, id_token_enc, token_type, expires_at, raw_profile, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       ON CONFLICT (user_key) DO UPDATE
       SET yahoo_guid = EXCLUDED.yahoo_guid,
           yahoo_email = EXCLUDED.yahoo_email,
           display_name = EXCLUDED.display_name,
           scope = EXCLUDED.scope,
           access_token_enc = EXCLUDED.access_token_enc,
           refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, yahoo_oauth_accounts.refresh_token_enc),
           id_token_enc = EXCLUDED.id_token_enc,
           token_type = EXCLUDED.token_type,
           expires_at = EXCLUDED.expires_at,
           raw_profile = EXCLUDED.raw_profile,
           updated_at = now()`,
      [
        requestDatabaseUserKey(req),
        yahooGuid,
        yahooEmail,
        displayName,
        scope,
        tokenData.access_token ? encrypt(tokenData.access_token) : null,
        tokenData.refresh_token ? encrypt(tokenData.refresh_token) : null,
        tokenData.id_token ? encrypt(tokenData.id_token) : null,
        tokenData.token_type || 'bearer',
        expiresAt,
        profile
      ]
    );

    return getAccount(req);
  }

  async function disconnect(req) {
    if (!(await ensureReady())) throw new Error('Yahoo OAuth database unavailable');
    await pool.query('DELETE FROM yahoo_oauth_accounts WHERE user_key = $1', [requestDatabaseUserKey(req)]);
  }

  async function refreshAccessToken(req) {
    if (!(await ensureReady())) throw new Error('Yahoo OAuth database unavailable');
    const result = await pool.query(
      'SELECT refresh_token_enc FROM yahoo_oauth_accounts WHERE user_key = $1',
      [requestDatabaseUserKey(req)]
    );
    const refreshToken = decrypt(result.rows[0]?.refresh_token_enc);
    if (!refreshToken) throw new Error('Yahoo refresh token is missing');

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      redirect_uri: redirectUri,
      refresh_token: refreshToken
    });
    const response = await axios.post(tokenUrl, body.toString(), {
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 30000
    });
    return saveTokens(req, response.data || {});
  }

  function startHandler(req, res) {
    if (!configured()) {
      return res.status(503).json({ ok: false, error: 'Yahoo OAuth is not configured on this server' });
    }

    const nonce = crypto.randomBytes(16).toString('base64url');
    const state = signState({
      userKey: requestDatabaseUserKey(req),
      nonce,
      exp: Date.now() + 10 * 60 * 1000
    });
    const url = new URL(authUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scope);
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('language', 'en-us');
    res.redirect(url.toString());
  }

  async function callbackHandler(req, res) {
    try {
      if (!configured()) throw new Error('Yahoo OAuth is not configured on this server');
      if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
      const state = verifyState(req.query.state);
      if (state.userKey !== requestDatabaseUserKey(req)) throw new Error('Yahoo OAuth callback user mismatch');
      const code = String(req.query.code || '');
      if (!code) throw new Error('Yahoo OAuth code is missing');

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code
      });
      const response = await axios.post(tokenUrl, body.toString(), {
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 30000
      });

      const profile = parseJwtPayload(response.data?.id_token);
      if (profile.nonce && profile.nonce !== state.nonce) throw new Error('Yahoo OAuth nonce mismatch');
      await saveTokens(req, response.data || {});
      res.redirect('/?yahoo=linked');
    } catch (err) {
      logger.error('Yahoo OAuth callback failed', err?.message || err);
      const target = new URL(appUrl, 'http://localhost');
      target.searchParams.set('yahoo', 'error');
      target.searchParams.set('message', err?.message || 'Yahoo OAuth failed');
      res.redirect(target.pathname === '/' && target.origin === 'http://localhost'
        ? `/?${target.searchParams.toString()}`
        : target.toString());
    }
  }

  async function statusHandler(req, res) {
    try {
      const account = await getAccount(req);
      res.json({
        ok: true,
        data: {
          configured: configured(),
          connected: Boolean(account),
          account,
          scope
        }
      });
    } catch (err) {
      logger.error('Yahoo status failed', err?.message || err);
      res.status(500).json({ ok: false, error: 'Yahoo status unavailable' });
    }
  }

  async function refreshHandler(req, res) {
    try {
      const account = await refreshAccessToken(req);
      res.json({ ok: true, data: account });
    } catch (err) {
      logger.error('Yahoo token refresh failed', err?.message || err);
      res.status(500).json({ ok: false, error: err?.message || 'Yahoo token refresh failed' });
    }
  }

  async function disconnectHandler(req, res) {
    try {
      await disconnect(req);
      res.json({ ok: true });
    } catch (err) {
      logger.error('Yahoo disconnect failed', err?.message || err);
      res.status(500).json({ ok: false, error: 'Yahoo disconnect failed' });
    }
  }

  async function shutdown() {
    if (pool) await pool.end();
  }

  return {
    callbackHandler,
    disconnectHandler,
    refreshHandler,
    shutdown,
    startHandler,
    statusHandler
  };
}

module.exports = { createYahooStore };
