const test = require('node:test');
const assert = require('node:assert/strict');
const { ADMIN_ROLE, USER_ROLE, normalizeRole, rolesFromClaims, userKey } = require('../server/admin');

test('normalizeRole maps administrator to admin', () => {
  assert.equal(normalizeRole('Administrator'), ADMIN_ROLE);
  assert.equal(normalizeRole(' admin '), ADMIN_ROLE);
});

test('rolesFromClaims includes user and recognizes common OIDC admin role claims', () => {
  const roles = rolesFromClaims({
    groups: ['engineering'],
    realm_access: { roles: ['administrator'] },
    resource_access: { 'ollama-agent': { roles: ['model-admin'] } }
  });

  assert.deepEqual(Array.from(roles).sort(), [ADMIN_ROLE, 'engineering', 'model-admin', USER_ROLE].sort());
});

test('userKey prefers stable OIDC subject before email', () => {
  assert.equal(userKey({ sub: 'subject-123', email: 'person@example.com' }), 'subject-123');
  assert.equal(userKey({ email: 'person@example.com' }), 'person@example.com');
});
