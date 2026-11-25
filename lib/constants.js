'use strict';

module.exports = Object.freeze({
  API_BASE_URL: 'https://iemp.giigleiot.net/xhouseAppEncapsulation/',
  APP_TYPE: 'android',
  HMAC_SECRET_KEY: 'juge2020@giigleiot',
  PLATFORM_CODE: 'giigle',
  SAAS_CODE: 'JUJIANG',
  DEFAULT_REFRESH_INTERVAL: 15,
  MIN_REFRESH_INTERVAL: 5,
  MAX_REFRESH_INTERVAL: 300,
  FAST_POLL_INTERVAL_MS: 1500,
  FAST_POLL_DURATION_MS: 25000,
  // While the gate reports opening/closing, keep fast polling up to this long.
  FAST_POLL_MAX_MS: 120000,
  OFFLINE_AFTER_FAILURES: 3,
  REQUEST_TIMEOUT_MS: 12000,
});
