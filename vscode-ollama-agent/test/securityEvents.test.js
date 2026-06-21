const test = require('node:test');
const assert = require('node:assert/strict');
const { actorFromReq, requestIp, summarize } = require('../server/securityEvents');

test('actorFromReq prefers authenticated user identifiers', () => {
  assert.equal(actorFromReq({ user: { email: 'person@example.com', sub: 'subject' } }), 'person@example.com');
  assert.equal(actorFromReq({ user: { sub: 'subject' } }), 'subject');
  assert.equal(actorFromReq({}), 'anonymous');
});

test('requestIp uses first forwarded address', () => {
  assert.equal(requestIp({ headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' }, socket: {} }), '10.0.0.1');
  assert.equal(requestIp({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1');
});

test('summarize counts recent security event types', () => {
  const events = [
    { severity: 'warn', type: 'auth_failure', createdAt: new Date().toISOString() },
    { severity: 'warn', type: 'admin_denied', createdAt: new Date().toISOString() },
    { severity: 'critical', type: 'auth_failure', createdAt: new Date().toISOString() },
    { severity: 'info', type: 'login_success', createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() }
  ];

  assert.deepEqual(summarize(events), {
    total: 3,
    critical: 1,
    warnings: 2,
    auth_failures: 2,
    admin_denied: 1
  });
});
