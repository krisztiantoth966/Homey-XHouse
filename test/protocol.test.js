'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GATE_MODE_DOUBLE,
  GATE_MODE_SINGLE,
  buildBleCommand,
  parseEgaStatus,
  parseEgbStatus,
  parseGateMode,
} = require('../lib/xhouse-protocol');

test('EGB1900 short idle frames', () => {
  assert.deepEqual(parseEgbStatus('321177078202'), { state: 'open', position: 100 });
  assert.deepEqual(parseEgbStatus('321177078203'), { state: 'closed', position: 0 });
});

test('EGB1900 motion states', () => {
  assert.deepEqual(parseEgbStatus('321177078200'), { state: 'closing', position: null });
  assert.deepEqual(parseEgbStatus('321177078201'), { state: 'opening', position: null });
});

test('EGB1900 reads position offset', () => {
  assert.deepEqual(parseEgbStatus('4111770782010000002D'), { state: 'opening', position: 45 });
  assert.deepEqual(parseEgbStatus('32117707820200000064'), { state: 'open', position: 100 });
  assert.deepEqual(parseEgbStatus('32117707820200000050'), { state: 'open', position: 80 });
});

test('EGB1900 rejects invalid frames', () => {
  for (const frame of [null, '', '3211770782', '3211770782GG', '321177078204']) {
    assert.equal(parseEgbStatus(frame), null);
  }
});

test('EGA keeps swing-gate semantics', () => {
  const status = parseEgaStatus('419012855200020200000000000101010064640A0A');
  assert.equal(status.state, 'open');
  assert.equal(status.position, 100);
  assert.equal(status.posLeft, 100);
  assert.equal(status.posRight, 100);
});

test('EGA rejects malformed hex', () => {
  assert.equal(parseEgaStatus('GG'.repeat(19)), null);
});

test('gate mode is parsed from menuCode', () => {
  assert.equal(parseGateMode(null), GATE_MODE_DOUBLE);
  assert.equal(parseGateMode('00000000003E01'), GATE_MODE_SINGLE);
  assert.equal(parseGateMode('00000000003E00'), GATE_MODE_DOUBLE);
});

test('BLE command frames match XHouse protocol', () => {
  assert.equal(buildBleCommand('A1B2C3', '01'), '3AA1B2C30401');
  assert.equal(buildBleCommand('a1 b2 c3', '02'), '3AA1B2C30402');
  assert.equal(buildBleCommand('A1B2C3', '03'), '3AA1B2C30403');
  assert.throws(() => buildBleCommand('', '01'));
  assert.throws(() => buildBleCommand('A1B2C3', '04'));
});
