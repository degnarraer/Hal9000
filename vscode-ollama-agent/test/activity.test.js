const test = require('node:test');
const assert = require('node:assert/strict');
const { chunkBytes, isTrackableUser, routeLabel } = require('../server/activity');
const { databaseUserKey } = require('../server/userIdentity');

test('isTrackableUser filters security pseudo-users', () => {
  assert.equal(isTrackableUser({ systemKey: 'public-asset', name: 'public-asset' }), false);
  assert.equal(isTrackableUser({ systemKey: 'auth-login', name: 'auth-login' }), false);
  assert.equal(isTrackableUser({ email: 'person@example.com' }), false);
  assert.equal(isTrackableUser({ sub: 'subject-123', email: 'person@example.com' }), true);
});

test('routeLabel gives readable activity names for key dashboard routes', () => {
  assert.equal(routeLabel({ method: 'POST', path: '/api/chat' }), 'Chat request');
  assert.equal(routeLabel({ method: 'GET', path: '/api/activity/dashboard' }), 'Viewing activity dashboard');
  assert.equal(routeLabel({ method: 'POST', path: '/api/ollama/pull' }), 'Downloading model');
});

test('chunkBytes safely counts response chunks', () => {
  assert.equal(chunkBytes(Buffer.from('hello')), 5);
  assert.equal(chunkBytes('hello'), 5);
  assert.equal(chunkBytes(undefined), 0);
  assert.equal(chunkBytes(() => {}), 0);
});

test('activity userKey derives an opaque key from OIDC subject', () => {
  const key = databaseUserKey({ sub: 'subject-123', email: 'person@example.com' });
  assert.notEqual(key, 'subject-123');
  assert.throws(() => databaseUserKey({ email: 'person@example.com' }), /subject is required/);
});
