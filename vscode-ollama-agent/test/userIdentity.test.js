const test = require('node:test');
const assert = require('node:assert/strict');
const { databaseUserKey, systemUserKey } = require('../server/userIdentity');

const env = {
  USER_KEY_SECRET: 'test-secret',
  OIDC_ISSUER: 'https://auth.example.test/realms/bob'
};

test('databaseUserKey derives stable opaque keys from issuer and subject', () => {
  const key = databaseUserKey({ sub: 'keycloak-user-id' }, env);

  assert.equal(key, databaseUserKey({ sub: 'keycloak-user-id' }, env));
  assert.notEqual(key, 'keycloak-user-id');
  assert.equal(key.includes('keycloak-user-id'), false);
});

test('databaseUserKey separates identical subjects across issuers', () => {
  assert.notEqual(
    databaseUserKey({ sub: 'same-sub', iss: 'issuer-a' }, env),
    databaseUserKey({ sub: 'same-sub', iss: 'issuer-b' }, env)
  );
});

test('databaseUserKey rejects email or name fallback identity', () => {
  assert.throws(
    () => databaseUserKey({ email: 'person@example.com', name: 'Person' }, env),
    /subject is required/
  );
});

test('systemUserKey only allows explicit system identities', () => {
  assert.equal(systemUserKey('public-route'), 'public-route');
  assert.equal(systemUserKey('person@example.com'), 'anonymous');
});
