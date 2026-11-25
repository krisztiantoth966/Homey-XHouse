'use strict';

const { XHouseProtocolError } = require('./errors');

const GATE_MODE_MENU_ITEM = 0x3E;
const GATE_MODE_SINGLE = 'single';
const GATE_MODE_DOUBLE = 'double';

function parseHexByte(value) {
  if (typeof value !== 'string' || value.length !== 2 || !/^[0-9a-f]{2}$/i.test(value)) {
    return null;
  }
  return Number.parseInt(value, 16);
}

function parseGateMode(menuCodeHex) {
  if (typeof menuCodeHex !== 'string' || menuCodeHex.length < 10) {
    return GATE_MODE_DOUBLE;
  }

  const body = menuCodeHex.slice(10);
  for (let index = 0; index <= body.length - 4; index += 4) {
    const item = parseHexByte(body.slice(index, index + 2));
    const value = parseHexByte(body.slice(index + 2, index + 4));
    if (item === null || value === null) continue;
    if (item === GATE_MODE_MENU_ITEM) {
      return value === 0x01 ? GATE_MODE_SINGLE : GATE_MODE_DOUBLE;
    }
  }

  return GATE_MODE_DOUBLE;
}

function parseEgaStatus(statusHex, gateMode = GATE_MODE_DOUBLE) {
  if (typeof statusHex !== 'string' || statusHex.length < 38) {
    return null;
  }

  const header = parseHexByte(statusHex.slice(0, 2));
  const doorEnum = parseHexByte(statusHex.slice(10, 12));
  const dirA = parseHexByte(statusHex.slice(12, 14));
  const dirB = parseHexByte(statusHex.slice(14, 16));
  const posLeft = parseHexByte(statusHex.slice(34, 36));
  const posRight = parseHexByte(statusHex.slice(36, 38));

  if ([header, doorEnum, dirA, dirB, posLeft, posRight].some(value => value === null)) {
    return null;
  }

  let state;
  let position;

  if (gateMode === GATE_MODE_SINGLE) {
    position = Math.max(posLeft, posRight);
    if (doorEnum === 0x02) state = 'opening';
    else if (doorEnum === 0x03) state = 'closing';
    else if (dirB === 0x01) state = 'opening';
    else if (dirB === 0x00) state = 'closing';
    else if (posLeft === 0 && posRight === 0) state = 'closed';
    else if (posLeft > 0 || posRight > 0) state = 'open';
    else state = 'closed';
  } else {
    position = Math.floor((posLeft + posRight) / 2);
    if (doorEnum === 0x02) state = 'opening';
    else if (doorEnum === 0x03) state = 'closing';
    else if (doorEnum === 0x01 || (posLeft === 0 && posRight === 0)) state = 'closed';
    else if (header === 0x41 && (dirA === 0x01 || dirB === 0x01)) state = 'opening';
    else if (header === 0x41 && (dirA === 0x00 || dirB === 0x00)) state = 'closing';
    else state = 'open';
  }

  return {
    state,
    position: clampPosition(position),
    posLeft: clampPosition(posLeft),
    posRight: clampPosition(posRight),
  };
}

const EGB_STATE_BY_CODE = new Map([
  [0x00, 'closing'],
  [0x01, 'opening'],
  [0x02, 'open'],
  [0x03, 'closed'],
]);

function parseEgbStatus(statusHex) {
  if (typeof statusHex !== 'string' || statusHex.length < 12) {
    return null;
  }

  const stateCode = parseHexByte(statusHex.slice(10, 12));
  if (stateCode === null || !EGB_STATE_BY_CODE.has(stateCode)) {
    return null;
  }

  const state = EGB_STATE_BY_CODE.get(stateCode);
  let position = null;

  if (statusHex.length >= 20) {
    const parsedPosition = parseHexByte(statusHex.slice(18, 20));
    if (parsedPosition !== null) position = clampPosition(parsedPosition);
  }

  if (position === null) {
    if (state === 'open') position = 100;
    else if (state === 'closed') position = 0;
  }

  return { state, position };
}

function buildBleCommand(bleCode, actionCode) {
  const normalizedBleCode = String(bleCode || '').replace(/\s+/g, '').toUpperCase();
  const normalizedActionCode = String(actionCode || '').toUpperCase();

  if (!normalizedBleCode || !/^[0-9A-F]+$/.test(normalizedBleCode) || normalizedBleCode.length % 2 !== 0) {
    throw new XHouseProtocolError('The device did not provide a valid bleCode.');
  }
  if (!/^(01|02|03)$/.test(normalizedActionCode)) {
    throw new XHouseProtocolError(`Unsupported XHouse action code: ${normalizedActionCode}`);
  }

  return `3A${normalizedBleCode}04${normalizedActionCode}`;
}

function clampPosition(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

module.exports = {
  GATE_MODE_SINGLE,
  GATE_MODE_DOUBLE,
  parseGateMode,
  parseEgaStatus,
  parseEgbStatus,
  buildBleCommand,
  clampPosition,
};
