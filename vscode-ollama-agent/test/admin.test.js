const test = require('node:test');
const assert = require('node:assert/strict');
const { ADMIN_ROLE, USER_ROLE, normalizeRole, rolesFromClaims } = require('../server/admin');
const { databaseUserKey } = require('../server/userIdentity');

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

test('userKey derives an opaque key from OIDC subject only', () => {
  const key = databaseUserKey({ sub: 'subject-123', email: 'person@example.com' });
  assert.equal(typeof key, 'string');
  assert.notEqual(key, 'subject-123');
  assert.throws(() => databaseUserKey({ email: 'person@example.com' }), /subject is required/);
});
