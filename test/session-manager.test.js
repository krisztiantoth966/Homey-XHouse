'use strict';

const Module = require('node:module');
const test = require('node:test');
const assert = require('node:assert/strict');

const XHouseApi = require('../lib/xhouse-api');

function loadAppWithMockedHomey() {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'homey') return { App: class App {} };
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
