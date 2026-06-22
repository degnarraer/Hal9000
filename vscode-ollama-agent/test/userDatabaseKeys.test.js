const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { isTrackableUser } = require('../server/activity');
const { actorFromReq } = require('../server/securityEvents');
const { databaseUserKey } = require('../server/userIdentity');

const subjectUser = {
  sub: 'keycloak-subject-123',
  email: 'person@example.com',
  preferred_username: 'person',
  name: 'Person Example'
};
const profileOnlyUser = {
  email: 'person@example.com',
  preferred_username: 'person',
  name: 'Person Example'
};

function assertOpaqueSubjectKey(key) {
  assert.equal(typeof key, 'string');
  assert.ok(key.length > 20);
  assert.notEqual(key, subjectUser.sub);
  assert.notEqual(key, subjectUser.email);
  assert.notEqual(key, subjectUser.preferred_username);
  assert.notEqual(key, subjectUser.name);
}

test('memory database user_key is derived only from Keycloak subject', () => {
  assertOpaqueSubjectKey(databaseUserKey(subjectUser));
  assert.throws(() => databaseUserKey(profileOnlyUser), /subject is required/);
});

test('admin roles database user_key is derived only from Keycloak subject', () => {
  assertOpaqueSubjectKey(databaseUserKey(subjectUser));
  assert.throws(() => databaseUserKey(profileOnlyUser), /subject is required/);
});

test('activity database user_key is derived only from Keycloak subject', () => {
  assertOpaqueSubjectKey(databaseUserKey(subjectUser));
  assert.throws(() => databaseUserKey(profileOnlyUser), /subject is required/);
  assert.equal(isTrackableUser(profileOnlyUser), false);
});

test('security events actor uses subject-derived key instead of profile fields', () => {
  assertOpaqueSubjectKey(actorFromReq({ user: subjectUser }));
  assert.equal(actorFromReq({ user: profileOnlyUser }), 'anonymous');
});

test('Yahoo OAuth database user_key is derived only from Keycloak subject', () => {
  assertOpaqueSubjectKey(databaseUserKey(subjectUser));
  assert.throws(() => databaseUserKey(profileOnlyUser), /subject is required/);
});

test('user chat database keys are derived only from Keycloak subject', () => {
  assertOpaqueSubjectKey(databaseUserKey(subjectUser));
  assert.throws(() => databaseUserKey(profileOnlyUser), /subject is required/);
});

test('backend database stores do not use profile-field fallback key chains', () => {
  const repoRoot = path.join(__dirname, '..');
  const files = [
    'server/memory.js',
    'server/admin.js',
    'server/activity.js',
    'server/yahoo.js',
    'server/userChat.js',
    'server/securityEvents.js'
  ];
  const forbidden = [
    /user\.sub\s*\|\|\s*user\.email/,
    /user\.email\s*\|\|\s*user\.preferred_username\s*\|\|\s*user\.name\s*\|\|\s*['"]anonymous['"]/,
    /preferred_username\s*\|\|\s*user\.name\s*\|\|\s*['"]anonymous['"]/
  ];

  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${file} must not use profile fields as database ownership key fallback`);
    }
  }
});

test('database stores use the canonical databaseUserKey module instead of local key derivation', () => {
  const repoRoot = path.join(__dirname, '..');
  const files = [
    'server/admin.js',
    'server/activity.js',
    'server/userChat.js',
    'server/securityEvents.js'
  ];

  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    assert.match(source, /databaseUserKey/, `${file} should use canonical databaseUserKey`);
  }

  for (const file of ['server/memory.js', 'server/yahoo.js']) {
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    assert.match(source, /requestDatabaseUserKey/, `${file} should use canonical requestDatabaseUserKey`);
  }
});

test('database stores do not define alternate user key helper functions', () => {
  const repoRoot = path.join(__dirname, '..');
  const files = [
    'server/memory.js',
    'server/admin.js',
    'server/activity.js',
    'server/yahoo.js',
    'server/userChat.js'
  ];

  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    assert.doesNotMatch(source, /function\s+(userKey|getUserKey)\s*\(/, `${file} must not define a local database key helper`);
  }
});
