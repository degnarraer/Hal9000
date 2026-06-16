const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const sessions = new Map();
const authStates = new Map();
let oidcConfigCache;
let jwksCache;

function parseBool(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function setting(rows, key, fallback) {
  const row = rows.find(item => item.key === key);
  return row && row.value !== undefined ? row.value : fallback;
}

function tableValue(rows, key, fallback) {
  const row = rows.find(item => item.key === key);
  if (!row) return fallback;
  if (row.env && process.env[row.env] !== undefined) return process.env[row.env];
  if (row.value !== undefined) return row.value;
  if (row.fallbackValue !== undefined) return row.fallbackValue;
  return fallback;
}

function envSetting(name, fallback) {
  return process.env[name] !== undefined ? process.env[name] : fallback;
}

function loadSecurityTable() {
  const configPath = process.env.SECURITY_CONFIG_PATH || path.join(__dirname, '..', 'security.config.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

function base64Url(input) {
  return Buffer.from(input).toString('base64url');
}

function decodeBase64UrlJson(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function parseCookies(header = '') {
  return header.split(';').reduce((cookies, part) => {
    const index = part.indexOf('=');
    if (index === -1) return cookies;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    return cookies;
  }, {});
}

function cookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.secure) parts.push('Secure');
  if (opts.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join('; ');
}

function clearCookie(name, secure) {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

function routeMatches(rule, req) {
  if (rule.method !== '*' && rule.method !== req.method) return false;
  const pattern = String(rule.pattern || '');
  if (pattern.endsWith('*')) return req.path.startsWith(pattern.slice(0, -1));
  return req.path === pattern;
}

function routePolicy(req, config) {
  return (config.table.routes || []).find(rule => routeMatches(rule, req)) || { security: 'authenticated', pattern: '<default>' };
}

function statusIcon(statusCode, securityPassed) {
  if (!securityPassed || statusCode >= 400) return '🔴';
  if (statusCode >= 300) return '🟡';
  return '🟢';
}

function requestLogger(logger, config) {
  return (req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      const securityPassed = Boolean(req.security?.passed);
      const policy = routePolicy(req, config);
      const icon = statusIcon(res.statusCode, securityPassed);
      const user = req.user?.email || req.user?.preferred_username || req.user?.name || 'anonymous';
      const msg = `${icon} ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms security=${securityPassed ? 'pass' : 'fail'} policy=${policy.security} user=${user}`;
      logger.info(msg);
      console.log(msg);
    });
    next();
  };
}

function securityHeaders(config) {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    next();
  };
}

function getConfig() {
  const table = loadSecurityTable();
  const settings = table.settings || [];
  const oidc = table.oidc || table.entra || [];

  const enabled = envSetting('SECURITY_ENABLED', setting(settings, 'enabled', false));
  const secureCookies = envSetting('SECURITY_SECURE_COOKIES', setting(settings, 'secureCookies', false));
  const sessionTtlMs = envSetting('SECURITY_SESSION_TTL_MS', setting(settings, 'sessionTtlMs', 8 * 60 * 60 * 1000));
  const corsOrigin = envSetting('CORS_ORIGIN', setting(settings, 'corsOrigin', ''));
  const allowedUsers = (table.allowlists || [])
    .filter(row => row.type === 'user' && row.value)
    .map(row => String(row.value).toLowerCase());
  const allowedGroups = (table.allowlists || [])
    .filter(row => row.type === 'group' && row.value)
    .map(row => String(row.value));

  return {
    enabled: typeof enabled === 'boolean' ? enabled : parseBool(enabled),
    table,
    provider: tableValue(oidc, 'provider', 'oidc'),
    issuer: tableValue(oidc, 'issuer', ''),
    clientId: tableValue(oidc, 'clientId', ''),
    clientSecret: tableValue(oidc, 'clientSecret', ''),
    redirectUri: tableValue(oidc, 'redirectUri', ''),
    registrationEndpoint: tableValue(oidc, 'registrationEndpoint', ''),
    corsOrigin,
    allowedUsers,
    allowedGroups,
    sessionTtlMs: Number(sessionTtlMs),
    secureCookies: typeof secureCookies === 'boolean' ? secureCookies : parseBool(secureCookies)
  };
}

async function oidcConfig(config) {
  if (oidcConfigCache) return oidcConfigCache;
  const resp = await axios.get(`${config.issuer}/.well-known/openid-configuration`, { timeout: 10000 });
  oidcConfigCache = resp.data;
  return oidcConfigCache;
}

async function jwks(config) {
  if (jwksCache) return jwksCache;
  const oidc = await oidcConfig(config);
  const resp = await axios.get(oidc.jwks_uri, { timeout: 10000 });
  jwksCache = resp.data.keys || [];
  return jwksCache;
}

async function verifyJwt(token, config, expectedNonce) {
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  if (!headerPart || !payloadPart || !signaturePart) throw new Error('Invalid token');

  const header = decodeBase64UrlJson(headerPart);
  const payload = decodeBase64UrlJson(payloadPart);
  const keys = await jwks(config);
  const key = keys.find(candidate => candidate.kid === header.kid);
  if (!key) throw new Error('Signing key not found');

  const publicKey = crypto.createPublicKey({ key, format: 'jwk' });
  const verified = crypto.verify('RSA-SHA256', Buffer.from(`${headerPart}.${payloadPart}`), publicKey, Buffer.from(signaturePart, 'base64url'));
  if (!verified) throw new Error('Invalid signature');

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error('Token expired');
  if (payload.nbf && payload.nbf > now) throw new Error('Token not active');
  if (payload.iss !== config.issuer) throw new Error('Invalid issuer');
  if (payload.aud !== config.clientId && payload.azp !== config.clientId) throw new Error('Invalid audience');
  if (expectedNonce && payload.nonce !== expectedNonce) throw new Error('Invalid nonce');
  return payload;
}

function isAuthorized(user, config) {
  const email = String(user.email || user.preferred_username || user.upn || '').toLowerCase();
  if (config.allowedUsers.length && !config.allowedUsers.includes(email)) return false;
  if (config.allowedGroups.length) {
    const groups = Array.isArray(user.groups) ? user.groups : [];
    if (!config.allowedGroups.some(group => groups.includes(group))) return false;
  }
  return true;
}

function createSecurityMiddleware(logger) {
  const config = getConfig();

  function markPassed(req, user = null) {
    req.security = { passed: true };
    if (user) req.user = user;
  }

  async function authenticate(req, res, next) {
    const policy = routePolicy(req, config);
    if (policy.security === 'public') {
      markPassed(req, { name: 'public-route' });
      return next();
    }

    if (!config.enabled) {
      markPassed(req, { name: 'local-dev' });
      return next();
    }

    if (req.path.startsWith('/auth/')) return next();

    try {
      const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (bearer) {
        const user = await verifyJwt(bearer, config);
        if (!isAuthorized(user, config)) return res.status(403).json({ ok: false, error: 'Forbidden' });
        markPassed(req, user);
        return next();
      }

      const sessionId = parseCookies(req.headers.cookie).ollama_agent_session;
      const session = sessionId ? sessions.get(sessionId) : null;
      if (session && session.expiresAt > Date.now()) {
        markPassed(req, session.user);
        return next();
      }
      if (sessionId) sessions.delete(sessionId);

      if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, error: 'Authentication required' });
      return res.redirect('/auth/login');
    } catch (err) {
      logger.warn(`security auth failed: ${err.message}`);
      if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, error: 'Authentication failed' });
      return res.redirect('/auth/login');
    }
  }

  async function login(req, res) {
    markPassed(req, { name: 'auth-login' });
    if (!config.enabled) return res.redirect('/');
    res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
  }

  async function startLogin(req, res) {
    markPassed(req, { name: 'auth-start' });
    if (!config.enabled) return res.redirect('/');
    return redirectToProvider(req, res, 'login');
  }

  async function register(req, res) {
    markPassed(req, { name: 'auth-register' });
    if (!config.enabled) return res.redirect('/');
    return redirectToProvider(req, res, 'register');
  }

  async function redirectToProvider(req, res, mode) {
    const oidc = await oidcConfig(config);
    const state = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    authStates.set(state, { nonce, expiresAt: Date.now() + 10 * 60 * 1000 });
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: config.redirectUri,
      response_mode: 'query',
      scope: 'openid profile email',
      state,
      nonce
    });

    const keycloakRegistrationEndpoint = `${config.issuer.replace(/\/$/, '')}/protocol/openid-connect/registrations`;
    const endpoint = mode === 'register'
      ? (config.registrationEndpoint || (config.provider === 'keycloak' ? keycloakRegistrationEndpoint : oidc.authorization_endpoint))
      : oidc.authorization_endpoint;

    if (mode === 'register' && endpoint === oidc.authorization_endpoint) {
      params.set('kc_action', 'register');
    }

    res.redirect(`${endpoint}?${params}`);
  }

  async function callback(req, res) {
    try {
      markPassed(req, { name: 'auth-callback' });
      const state = authStates.get(req.query.state);
      authStates.delete(req.query.state);
      if (!state || state.expiresAt < Date.now()) throw new Error('Invalid login state');

      const oidc = await oidcConfig(config);
      const params = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'authorization_code',
        code: req.query.code,
        redirect_uri: config.redirectUri
      });
      const tokenResp = await axios.post(oidc.token_endpoint, params.toString(), {
        timeout: 10000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      const user = await verifyJwt(tokenResp.data.id_token, config, state.nonce);
      if (!isAuthorized(user, config)) return res.status(403).send('Forbidden');

      const sessionId = crypto.randomUUID();
      sessions.set(sessionId, { user, expiresAt: Date.now() + config.sessionTtlMs });
      res.setHeader('Set-Cookie', cookie('ollama_agent_session', sessionId, { secure: config.secureCookies, maxAge: Math.floor(config.sessionTtlMs / 1000) }));
      res.redirect('/');
    } catch (err) {
      logger.error(`OIDC callback failed: ${err.message}`);
      res.status(401).send('Authentication failed');
    }
  }

  function logout(req, res) {
    markPassed(req, { name: 'auth-logout' });
    const sessionId = parseCookies(req.headers.cookie).ollama_agent_session;
    if (sessionId) sessions.delete(sessionId);
    res.setHeader('Set-Cookie', clearCookie('ollama_agent_session', config.secureCookies));
    res.redirect('/auth/login');
  }

  return { config, requestLogger: requestLogger(logger, config), securityHeaders: securityHeaders(config), authenticate, login, startLogin, register, callback, logout };
}

module.exports = { createSecurityMiddleware };
