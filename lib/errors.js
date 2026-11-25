'use strict';

class XHouseError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

class XHouseAuthError extends XHouseError {}
// Login refused for a reason other than wrong credentials (rate limit, server
// busy, ...). Retried automatically with a back-off; never needs a repair.
class XHouseLoginDeferredError extends XHouseError {}
class XHouseDeviceOfflineError extends XHouseError {}
class XHouseDeviceNotFoundError extends XHouseError {}
class XHouseProtocolError extends XHouseError {}

module.exports = {
  XHouseError,
  XHouseAuthError,
  XHouseLoginDeferredError,
  XHouseDeviceOfflineError,
  XHouseDeviceNotFoundError,
  XHouseProtocolError,
};
