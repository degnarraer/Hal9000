const test = require('node:test');
const assert = require('node:assert/strict');
const { chunkBytes, isTrackableUser, routeLabel, userKey } = require('../server/activity');

test('isTrackableUser filters security pseudo-users', () => {
  assert.equal(isTrackableUser({ name: 'public-asset' }), false);
  assert.equal(isTrackableUser({ name: 'auth-login' }), false);
  assert.equal(isTrackableUser({ email: 'degnarraer@yahoo.com' }), true);
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

test('activity userKey matches OIDC subject preference', () => {
  assert.equal(userKey({ sub: 'subject-123', email: 'person@example.com' }), 'subject-123');
});
