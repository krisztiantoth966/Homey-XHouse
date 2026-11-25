'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseLosslessJson,
  stringifyLosslessJson,
} = require('../lib/xhouse-json');
const { toApiId } = require('../lib/xhouse-device');

test('lossless parser preserves 64-bit XHouse identifiers exactly', () => {
  const source = '{"id":9223372036854775807,"safe":42,"negative":-9223372036854775807}';
  const parsed = parseLosslessJson(source);

  assert.equal(parsed.id, 9223372036854775807n);
  assert.equal(parsed.safe, 42);
  assert.equal(parsed.negative, -9223372036854775807n);
});

test('lossless parser does not rewrite digits inside JSON strings', () => {
  const parsed = parseLosslessJson(
    '{"message":"id 9223372036854775807","id":9223372036854775807}',
  );

  assert.equal(parsed.message, 'id 9223372036854775807');
  assert.equal(parsed.id, 9223372036854775807n);
});

test('lossless serializer emits large API IDs as raw JSON numbers', () => {
  const body = {
    userId: 42,
    deviceId: toApiId('9223372036854775807'),
  };

  assert.equal(
    stringifyLosslessJson(body),
    '{"userId":42,"deviceId":9223372036854775807}',
  );
});
