'use strict';

const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const originalLoad = Module._load;
const fakeHomey = {
  App: class App {},
  Driver: class Driver {},
  Device: class Device {},
};

function withMockedHomey(callback) {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'homey') return fakeHomey;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return callback();
  } finally {
    Module._load = originalLoad;
  }
}

test('all Homey runtime modules can be loaded', () => {
  withMockedHomey(() => {
    const files = [
      '../app.js',
      '../lib/base-xhouse-device.js',
      '../drivers/gate/driver.js',
      '../drivers/gate/device.js',
      '../drivers/garage/driver.js',
      '../drivers/garage/device.js',
    ];
    for (const file of files) {
      const exported = require(path.resolve(__dirname, file));
      assert.equal(typeof exported, 'function', `${file} should export a class`);
    }
  });
});

test('refresh interval is clamped to the supported range', () => {
  withMockedHomey(() => {
    const { clampRefreshInterval } = require('../lib/base-xhouse-device');
    assert.equal(clampRefreshInterval(undefined), 30);
    assert.equal(clampRefreshInterval(1), 5);
    assert.equal(clampRefreshInterval(31.4), 31);
    assert.equal(clampRefreshInterval(999), 300);
  });
});

test('automatic binding recovery refuses equally likely physical gates', () => {
  withMockedHomey(() => {
    delete require.cache[require.resolve('../lib/base-xhouse-device')];
    const { rankDiscoveredDevices } = require('../lib/base-xhouse-device');
    const stored = {
      getApiDeviceId: () => 'rounded-old-id',
      getData: () => ({ id: 'rounded-old-id' }),
      _deviceIdCandidates: ['rounded-old-id'],
      _bleCode: null,
      _model: 'EGA1800',
      _deviceType: 'EGA',
    };
    const candidates = [
      { idCandidates: ['exact-1'], bleCode: null, model: 'EGA1800', deviceType: 'EGA' },
      { idCandidates: ['exact-2'], bleCode: null, model: 'EGA1800', deviceType: 'EGA' },
    ];

    assert.deepEqual(rankDiscoveredDevices(stored, candidates), []);
  });
});
