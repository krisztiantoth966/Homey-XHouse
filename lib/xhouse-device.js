'use strict';

const DEVICE_ID_KEYS = [
  'id',
  'deviceId',
  'wifiDeviceId',
  'wifiId',
  'iotDeviceId',
  'thingId',
  'devId',
];

function normalizeDevice(raw = {}) {
  const properties = Array.isArray(raw.properties) ? raw.properties : [];
  const idCandidates = extractDeviceIdCandidates(raw);
  const id = idCandidates[0] || '';
  const alias = String(raw.alias || raw.name || `XHouse ${id || 'device'}`);
  const model = String(raw.model || 'Unknown');
  const deviceType = String(raw.deviceType || 'Unknown');

  return {
    raw,
    id,
    apiId: id ? toApiId(id) : null,
    apiDeviceId: id,
    idCandidates,
    alias,
    model,
    deviceType,
    online: Number(raw.status) === 1,
    properties,
    bleCode: getPropertyFromList(properties, 'bleCode') || raw.bleCode || null,
  };
}

function extractDeviceIdCandidates(raw = {}) {
  const candidates = [];

  for (const key of DEVICE_ID_KEYS) {
    addCandidate(candidates, raw[key]);
  }

  // Some XHouse builds expose identifiers through the property list.
  const properties = Array.isArray(raw.properties) ? raw.properties : [];
  for (const key of DEVICE_ID_KEYS) {
    addCandidate(candidates, getPropertyFromList(properties, key));
  }

  // Be tolerant of nested device descriptors returned by shared accounts.
  if (raw.device && typeof raw.device === 'object') {
    for (const key of DEVICE_ID_KEYS) addCandidate(candidates, raw.device[key]);
  }
  if (raw.wifiDevice && typeof raw.wifiDevice === 'object') {
    for (const key of DEVICE_ID_KEYS) addCandidate(candidates, raw.wifiDevice[key]);
  }

  return candidates;
}

function addCandidate(target, value) {
  const normalized = normalizeId(value);
  if (!normalized || target.includes(normalized)) return;
  target.push(normalized);
}

function normalizeId(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) return '';
    return String(value);
  }
  const normalized = String(value).trim();
  if (!normalized || normalized === 'undefined' || normalized === 'null') return '';
  return normalized;
}

function identifiers(device) {
  return `${device.model || ''} ${device.deviceType || ''}`.toUpperCase();
}

function isEga(device) {
  return identifiers(device).includes('EGA');
}

function isEgb(device) {
  const value = identifiers(device);
  return value.includes('EGB') || value.includes('PGB');
}

function isBleGate(device) {
  return isEga(device) || isEgb(device);
}

function isGarageOpener(device) {
  return identifiers(device).includes('XH-SGC01');
}

function getPropertyFromList(properties, key) {
  const property = (properties || []).find(item => item && item.key === key);
  return property ? property.value : null;
}

function propertiesToMap(properties) {
  const result = {};
  for (const property of properties || []) {
    if (!property || typeof property.key !== 'string') continue;
    result[property.key] = property.value;
  }
  return result;
}

/**
 * Convert an exact decimal ID string into a JSON-compatible API value.
 * Safe integers stay Numbers. Larger values become BigInt and are emitted as
 * raw JSON numbers by stringifyLosslessJson.
 */
function toApiId(value) {
  if (typeof value === 'bigint') return value;

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) return value;
    if (Number.isSafeInteger(value)) return value;
    return BigInt(String(Math.trunc(value)));
  }

  const normalized = normalizeId(value);
  if (!/^-?\d+$/.test(normalized)) return value;

  try {
    const bigint = BigInt(normalized);
    if (bigint <= BigInt(Number.MAX_SAFE_INTEGER) && bigint >= BigInt(Number.MIN_SAFE_INTEGER)) {
      return Number(normalized);
    }
    return bigint;
  } catch (_error) {
    return value;
  }
}

function parseStoredIdCandidates(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeId).filter(Boolean).filter(unique);
  }
  if (!value) return [];

  try {
    const parsed = JSON.parse(String(value));
    if (Array.isArray(parsed)) {
      return parsed.map(normalizeId).filter(Boolean).filter(unique);
    }
  } catch (_error) {
    // Older builds may have stored a single ID directly.
  }

  const single = normalizeId(value);
  return single ? [single] : [];
}

function serializeIdCandidates(candidates) {
  return JSON.stringify((candidates || []).map(normalizeId).filter(Boolean).filter(unique));
}

function unique(value, index, array) {
  return array.indexOf(value) === index;
}

module.exports = {
  DEVICE_ID_KEYS,
  normalizeDevice,
  extractDeviceIdCandidates,
  normalizeId,
  isEga,
  isEgb,
  isBleGate,
  isGarageOpener,
  getPropertyFromList,
  propertiesToMap,
  toApiId,
  parseStoredIdCandidates,
  serializeIdCandidates,
};
