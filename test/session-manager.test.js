'use strict';

const Module = require('node:module');
const test = require('node:test');
const assert = require('node:assert/strict');

const XHouseApi = require('../lib/xhouse-api');

function loadAppWithMockedHomey() {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'homey') return { App: class App { log() {} error() {} } };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve('../app.js')];
    return require('../app.js');
  } finally {
    Module._load = originalLoad;
  }
}

test('account registration does not overwrite a newer shared token', () => {
  const XHouseApp = loadAppWithMockedHomey();
  const app = new XHouseApp();
  app.setXHouseSession('USER@example.com', {
    token: 'new-token',
    userId: 42,
    password: 'secret',
  });
  app.registerXHouseSession('user@example.com', {
    token: 'stale-token',
    userId: 42,
    password: 'old-secret',
  });

  assert.deepEqual(app.getXHouseSession('user@example.com'), {
    token: 'new-token',
    userId: '42',
    password: 'secret',
  });
});

test('concurrent authentication uses one XHouse login and one token', async () => {
  const XHouseApp = loadAppWithMockedHomey();
  const app = new XHouseApp();
  const originalLogin = XHouseApi.prototype.login;
  let calls = 0;

  XHouseApi.prototype.login = async function fakeLogin() {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 20));
    this.setSession({ token: 'shared-token', userId: 77 });
    return this.getSession();
  };

  try {
    const [first, second] = await Promise.all([
      app.authenticateXHouse('user@example.com', 'secret'),
      app.authenticateXHouse('USER@example.com', 'secret'),
    ]);
    assert.equal(calls, 1);
    assert.equal(first.token, 'shared-token');
    assert.deepEqual(second, first);
  } finally {
    XHouseApi.prototype.login = originalLogin;
  }
});

test('a failed login backs off instead of logging in on every poll', async () => {
  const XHouseApp = loadAppWithMockedHomey();
  const app = new XHouseApp();
  const { XHouseLoginDeferredError } = require('../lib/errors');
  const originalLogin = XHouseApi.prototype.login;
  let calls = 0;
  XHouseApi.prototype.login = async function fakeLogin() {
    calls += 1;
    throw new XHouseLoginDeferredError('XHouse refused the login for now: too many requests');
  };
  try {
    await assert.rejects(app.authenticateXHouse('user@example.com', 'secret'), XHouseLoginDeferredError);
    await assert.rejects(app.authenticateXHouse('user@example.com', 'secret'), XHouseLoginDeferredError);
    await assert.rejects(app.authenticateXHouse('user@example.com', 'secret'), XHouseLoginDeferredError);
    assert.equal(calls, 1, 'only one real login attempt inside the back-off window');
  } finally {
    XHouseApi.prototype.login = originalLogin;
  }
});

test('login errors: only real credential problems need a repair', () => {
  const { isCredentialError } = XHouseApi;
  assert.equal(isCredentialError('Password is incorrect'), true);
  assert.equal(isCredentialError('Account not registered'), true);
  assert.equal(isCredentialError('密码错误'), true);
  assert.equal(isCredentialError('Login too frequent, try again later'), false);
  assert.equal(isCredentialError('Account logged in on another device'), false);
  assert.equal(isCredentialError('System error'), false);
  assert.equal(isCredentialError('unknown error'), false);
});
