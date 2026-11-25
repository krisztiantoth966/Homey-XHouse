'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractDeviceIdCandidates,
  isBleGate,
  isEga,
  isEgb,
  isGarageOpener,
  normalizeDevice,
  parseStoredIdCandidates,
  propertiesToMap,
  serializeIdCandidates,
  toApiId,
} = require('../lib/xhouse-device');

test('device families are recognized from model and deviceType', () => {
  assert.equal(isEga(normalizeDevice({ id: 1, model: 'EGA18' })), true);
  assert.equal(isEgb(normalizeDevice({ id: 2, deviceType: 'EGB1900' })), true);
  assert.equal(isEgb(normalizeDevice({ id: 3, model: 'PGB-01' })), true);
  assert.equal(isBleGate(normalizeDevice({ id: 4, model: 'EGA15' })), true);
  assert.equal(isGarageOpener(normalizeDevice({ id: 5, model: 'XH-SGC01' })), true);
  assert.equal(isBleGate(normalizeDevice({ id: 6, model: 'XH-SGC01' })), false);
});

test('normalization keeps pairing information and all candidate IDs', () => {
  const device = normalizeDevice({
    id: '9223372036854775807',
    deviceId: '1234567890123456789',
    alias: 'Front gate',
    model: 'EGB1900',
    deviceType: 'PGB',
    status: 1,
    properties: [{ key: 'bleCode', value: 'ABCDEF' }],
  });
  assert.equal(device.id, '9223372036854775807');
  assert.deepEqual(device.idCandidates, [
    '9223372036854775807',
    '1234567890123456789',
  ]);
  assert.equal(typeof device.apiId, 'bigint');
  assert.equal(device.alias, 'Front gate');
  assert.equal(device.online, true);
  assert.equal(device.bleCode, 'ABCDEF');
});

test('candidate IDs are also read from nested/shared account descriptors', () => {
  assert.deepEqual(extractDeviceIdCandidates({
    id: 10,
    device: { deviceId: '20' },
    wifiDevice: { id: '30' },
    properties: [{ key: 'wifiDeviceId', value: '40' }],
  }), ['10', '40', '20', '30']);
});

test('property and API ID helpers preserve large integers', () => {
  assert.deepEqual(propertiesToMap([
    { key: 'status', value: 'abc' },
    { key: 'Switch_1', value: '1' },
  ]), { status: 'abc', Switch_1: '1' });
  assert.equal(toApiId('42'), 42);
  assert.equal(typeof toApiId('9223372036854775807'), 'bigint');
  assert.equal(toApiId('device-A'), 'device-A');
});

test('candidate ID store format is backward compatible', () => {
  const serialized = serializeIdCandidates(['1', '2', '2']);
  assert.equal(serialized, '["1","2"]');
  assert.deepEqual(parseStoredIdCandidates(serialized), ['1', '2']);
  assert.deepEqual(parseStoredIdCandidates('legacy-id'), ['legacy-id']);
});
