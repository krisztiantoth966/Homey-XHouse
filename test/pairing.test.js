'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { findMatchingDiscoveredDevice } = require('../lib/pairing');
const { normalizeDevice } = require('../lib/xhouse-device');

function createStoredDevice(values = {}) {
  const store = {
    apiDeviceId: values.apiDeviceId || '',
    deviceIdCandidates: values.deviceIdCandidates || '',
    bleCode: values.bleCode || '',
    model: values.model || '',
    deviceType: values.deviceType || '',
  };

  return {
    getData: () => ({ id: values.id || '' }),
    getStoreValue: key => store[key],
  };
}

test('repair can recover a previously rounded JavaScript device ID by BLE code and model', () => {
  const exact = normalizeDevice({
    id: '9223372036854775806',
    alias: 'Gate',
    model: 'EGA1800',
    deviceType: 'EGA',
    properties: [{ key: 'bleCode', value: 'ABC123' }],
  });
  const stored = createStoredDevice({
    id: '9223372036854776000',
    bleCode: 'ABC123',
    model: 'EGA1800',
    deviceType: 'EGA',
  });

  const match = findMatchingDiscoveredDevice(stored, [exact]);
  assert.equal(match.id, '9223372036854775806');
});

test('repair refuses an ambiguous model-only match', () => {
  const devices = [
    normalizeDevice({ id: 101, model: 'EGA1800', deviceType: 'EGA' }),
    normalizeDevice({ id: 102, model: 'EGA1800', deviceType: 'EGA' }),
  ];
  const stored = createStoredDevice({ model: 'EGA1800', deviceType: 'EGA' });

  assert.equal(findMatchingDiscoveredDevice(stored, devices), null);
});
