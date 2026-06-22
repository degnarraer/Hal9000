const crypto = require('crypto');

const SYSTEM_USER_KEYS = new Set([
  'anonymous',
  'public-asset',
  'public-route',
  'auth-login',
  'auth-start',
  'auth-register',
  'auth-callback',
  'auth-logout',
  'local-dev'
]);

function identitySecret(env = process.env) {
  return env.USER_KEY_SECRET || env.TOKEN_ENCRYPTION_KEY || env.OIDC_CLIENT_SECRET || env.SESSION_SECRET || 'development-user-key-secret';
}

function subjectNamespace(user = {}, env = process.env) {
  return String(user.iss || env.OIDC_ISSUER || 'local-issuer').trim();
}

function hasSubject(user = {}) {
  return Boolean(String(user.sub || '').trim());
}

function databaseUserKey(user = {}, env = process.env) {
  const sub = String(user.sub || '').trim();
  if (!sub) throw new Error('Authenticated user subject is required');

  return crypto
    .createHmac('sha256', identitySecret(env))
    .update(`${subjectNamespace(user, env)}|${sub}`)
    .digest('base64url');
}

function requestDatabaseUserKey(req, env = process.env) {
  return databaseUserKey(req?.user || {}, env);
}

function userDisplayName(user = {}) {
  return user.name || user.preferred_username || user.email || 'Signed in user';
}

function userEmail(user = {}) {
  return String(user.email || user.preferred_username || user.upn || '').toLowerCase();
}

function systemUserKey(value = 'anonymous') {
  const key = String(value || 'anonymous');
  return SYSTEM_USER_KEYS.has(key) ? key : 'anonymous';
}

module.exports = {
  databaseUserKey,
  hasSubject,
  requestDatabaseUserKey,
  systemUserKey,
  userDisplayName,
  userEmail
};
