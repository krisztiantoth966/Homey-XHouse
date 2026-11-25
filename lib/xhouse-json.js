'use strict';

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const BIGINT_PARSE_PREFIX = '__XHOUSE_LOSSLESS_BIGINT_7c41f6e9__:';

/**
 * Parse JSON without losing precision for 64-bit integer identifiers.
 *
 * Native JSON.parse converts every number to a JavaScript Number. XHouse uses
 * database IDs that can be larger than Number.MAX_SAFE_INTEGER. Before parsing,
 * unsafe integer tokens are replaced with marked strings and revived as BigInt.
 */
function parseLosslessJson(text) {
  const source = String(text || '');
  if (!source) return {};
  return JSON.parse(quoteUnsafeIntegers(source), (_key, value) => {
    if (
      typeof value === 'string'
      && value.startsWith(BIGINT_PARSE_PREFIX)
      && /^-?\d+$/.test(value.slice(BIGINT_PARSE_PREFIX.length))
    ) {
      return BigInt(value.slice(BIGINT_PARSE_PREFIX.length));
    }
    return value;
  });
}

/**
 * Stringify a request body while emitting BigInt values as raw JSON numbers.
 * This lets us send exact 64-bit XHouse IDs instead of rounded Numbers or
 * quoted strings.
 */
function stringifyLosslessJson(value) {
  const rawNumbers = [];
  const markerPrefix = `__XHOUSE_RAW_NUMBER_${Date.now()}_${Math.random().toString(36).slice(2)}_`;

  let serialized = JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') {
      const index = rawNumbers.push(item.toString()) - 1;
      return `${markerPrefix}${index}__`;
    }
    return item;
  });

  for (let index = 0; index < rawNumbers.length; index += 1) {
    const marker = JSON.stringify(`${markerPrefix}${index}__`);
    serialized = serialized.replace(marker, rawNumbers[index]);
  }

  return serialized;
}

function quoteUnsafeIntegers(json) {
  let result = '';
  let index = 0;
  let inString = false;
  let escaped = false;

  while (index < json.length) {
    const char = json[index];

    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      index += 1;
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      index += 1;
      continue;
    }

    if (char === '-' || isDigit(char)) {
      const parsed = readJsonNumber(json, index);
      if (parsed) {
        const { token, end, isInteger } = parsed;
        if (isInteger && isUnsafeIntegerToken(token)) {
          result += JSON.stringify(`${BIGINT_PARSE_PREFIX}${token}`);
        } else {
          result += token;
        }
        index = end;
        continue;
      }
    }

    result += char;
    index += 1;
  }

  return result;
}

function readJsonNumber(source, start) {
  let index = start;

  if (source[index] === '-') index += 1;
  if (index >= source.length || !isDigit(source[index])) return null;

  if (source[index] === '0') {
    index += 1;
  } else {
    while (index < source.length && isDigit(source[index])) index += 1;
  }

  let isInteger = true;

  if (source[index] === '.') {
    isInteger = false;
    index += 1;
    if (index >= source.length || !isDigit(source[index])) return null;
    while (index < source.length && isDigit(source[index])) index += 1;
  }

  if (source[index] === 'e' || source[index] === 'E') {
    isInteger = false;
    index += 1;
    if (source[index] === '+' || source[index] === '-') index += 1;
    if (index >= source.length || !isDigit(source[index])) return null;
    while (index < source.length && isDigit(source[index])) index += 1;
  }

  return {
    token: source.slice(start, index),
    end: index,
    isInteger,
  };
}

function isUnsafeIntegerToken(token) {
  try {
    const value = BigInt(token);
    return value > MAX_SAFE_BIGINT || value < MIN_SAFE_BIGINT;
  } catch (_error) {
    return false;
  }
}

function isDigit(char) {
  return char >= '0' && char <= '9';
}

module.exports = {
  parseLosslessJson,
  stringifyLosslessJson,
  quoteUnsafeIntegers,
  isUnsafeIntegerToken,
};
