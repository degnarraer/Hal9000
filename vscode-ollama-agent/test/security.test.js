const test = require('node:test');
const assert = require('node:assert/strict');
const { isHtmlPartialRequest, isPublicBrowserAsset, routeMatches } = require('../server/security');

test('login assets required before authentication are public', () => {
  assert.equal(isPublicBrowserAsset({ method: 'GET', path: '/style.css' }), true);
  assert.equal(isPublicBrowserAsset({ method: 'GET', path: '/big_hal.png' }), true);
  assert.equal(isPublicBrowserAsset({ method: 'GET', path: '/vendor/lucide/lucide.min.js' }), true);
});

test('authenticated app scripts are not public browser assets', () => {
  assert.equal(isPublicBrowserAsset({ method: 'GET', path: '/app.js' }), false);
  assert.equal(isPublicBrowserAsset({ method: 'GET', path: '/menu.js' }), false);
});

test('menu page partials are detected as async html requests', () => {
  assert.equal(isHtmlPartialRequest({ method: 'GET', path: '/menu-pages/landing.html' }), true);
  assert.equal(isHtmlPartialRequest({ method: 'HEAD', path: '/menu-pages/models.html' }), true);
  assert.equal(isHtmlPartialRequest({ method: 'POST', path: '/menu-pages/landing.html' }), false);
  assert.equal(isHtmlPartialRequest({ method: 'GET', path: '/auth/login' }), false);
});

test('routeMatches supports exact and wildcard paths', () => {
  assert.equal(routeMatches({ method: 'GET', pattern: '/auth/*' }, { method: 'GET', path: '/auth/login' }), true);
  assert.equal(routeMatches({ method: '*', pattern: '/api/*' }, { method: 'POST', path: '/api/chat' }), true);
  assert.equal(routeMatches({ method: 'POST', pattern: '/auth/logout' }, { method: 'GET', path: '/auth/logout' }), false);
});
