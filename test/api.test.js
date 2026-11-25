'use strict';

const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

const XHouseApi = require('../lib/xhouse-api');
const { HMAC_SECRET_KEY, PLATFORM_CODE } = require('../lib/constants');
const {
  XHouseAuthError,
  XHouseDeviceOfflineError,
  XHouseDeviceNotFoundError,
  XHouseError,
} = require('../lib/errors');
const { formatLocalDateTime } = require('../lib/xhouse-api');

test('signature matches the reverse-engineered HMAC-MD5 format', () => {
  const api = new XHouseApi();
  const timestamp = '1700000000';
  const expected = crypto.createHmac('md5', HMAC_SECRET_KEY)
    .update(`${PLATFORM_CODE}${timestamp}`)
    .digest('hex');
  assert.equal(api._generateSignature(timestamp), expected);
  api.close();
});

test('local phone time uses the required XHouse format', () => {
  const date = new Date(2026, 7, 27, 20, 5, 9);
  assert.equal(formatLocalDateTime(date), '2026-08-27 20:05:09');
});

test('response errors are classified for retry and availability', () => {
  const api = new XHouseApi({ token: 'token', userId: '1' });
  assert.throws(() => api._checkResponse({ code: '1', msg: 'token invalid' }, 'x'), XHouseAuthError);
  api.setSession({ token: 'token', userId: '1' });
  assert.throws(() => api._checkResponse({ code: '1', msg: 'device offline' }, 'x'), XHouseDeviceOfflineError);
  assert.throws(
    () => api._checkResponse({ code: '1', msg: 'device.not.exist' }, 'x'),
    XHouseDeviceNotFoundError,
  );
  assert.throws(() => api._checkResponse({ code: '9', msg: 'other' }, 'x'), XHouseError);
  api.close();
});

test('resolveDeviceId tries alternate IDs after device.not.exist', async () => {
  const api = new XHouseApi({ token: 'token', userId: '1' });
  const attempts = [];
  api.getDeviceProperties = async id => {
    attempts.push(String(id));
    if (String(id) === 'wrong') throw new XHouseDeviceNotFoundError('device.not.exist');
    return { status: 'ok' };
  };

  const result = await api.resolveDeviceId(['wrong', 'correct']);
  assert.deepEqual(attempts, ['wrong', 'correct']);
  assert.equal(result.deviceId, 'correct');
  assert.deepEqual(result.properties, { status: 'ok' });
  api.close();
});
