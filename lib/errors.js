'use strict';

class XHouseError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

class XHouseAuthError extends XHouseError {}
class XHouseDeviceOfflineError extends XHouseError {}
class XHouseDeviceNotFoundError extends XHouseError {}
class XHouseProtocolError extends XHouseError {}

module.exports = {
  XHouseError,
  XHouseAuthError,
  XHouseDeviceOfflineError,
  XHouseDeviceNotFoundError,
  XHouseProtocolError,
};
