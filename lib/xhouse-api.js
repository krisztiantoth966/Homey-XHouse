'use strict';

const crypto = require('node:crypto');
const https = require('node:https');

const {
  API_BASE_URL,
  APP_TYPE,
  HMAC_SECRET_KEY,
  PLATFORM_CODE,
  REQUEST_TIMEOUT_MS,
  SAAS_CODE,
} = require('./constants');
const {
  XHouseAuthError,
  XHouseDeviceOfflineError,
  XHouseDeviceNotFoundError,
  XHouseError,
} = require('./errors');
const { normalizeId, toApiId } = require('./xhouse-device');
const { parseLosslessJson, stringifyLosslessJson } = require('./xhouse-json');

class XHouseApi {
  constructor({ token = null, userId = null, logger = null } = {}) {
    this.token = token || null;
    this.userId = userId === undefined || userId === null ? null : String(userId);
    this.logger = logger || createNoopLogger();
    this.agent = new https.Agent({ keepAlive: true, maxSockets: 4 });
  }

  setSession({ token, userId } = {}) {
    this.token = token || null;
    this.userId = userId === undefined || userId === null ? null : String(userId);
  }

  getSession() {
    return { token: this.token, userId: this.userId };
  }

  clearSession() {
    this.token = null;
    this.userId = null;
  }

  close() {
    this.agent.destroy();
  }

  async login(email, password) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail || !password) {
      throw new XHouseAuthError('Email and password are required.');
    }

    const data = await this._post('clientUser/login', {
      saasCode: SAAS_CODE,
      type: 'EMAIL',
      email: normalizedEmail,
      password: String(password),
      appType: APP_TYPE.toUpperCase(),
    }, false);

    if (String(data?.code) !== '0') {
      throw new XHouseAuthError(`Login failed: ${data?.msg || 'unknown error'}`);
    }

    const token = data?.result?.token;
    const userId = data?.result?.userId;
    if (!token || userId === undefined || userId === null) {
      throw new XHouseAuthError('Login succeeded but XHouse did not return a session.');
    }

    this.setSession({ token, userId });
    this.logger.debug('XHouse login successful.');
    return this.getSession();
  }

  async getDevices() {
    this._assertAuthenticated();
    const data = await this._post('group/queryGroupDevices', {
      userId: toApiId(this.userId),
      groupId: 0,
    });

    this._checkResponse(data, 'Failed to get devices');
    return data?.result?.deviceInfos || [];
  }

  async getDeviceProperties(deviceId) {
    this._assertAuthenticated();
    const data = await this._post('wifi/getWifiProperties', {
      userId: toApiId(this.userId),
      deviceId: toApiId(deviceId),
    });

    this._checkResponse(data, 'Failed to get device state');
    const properties = data?.result?.properties || [];
    const result = {};
    for (const property of properties) {
      if (property && typeof property.key === 'string') {
        result[property.key] = property.value;
      }
    }
    return result;
  }

  /**
   * Try all identifiers exposed by discovery and return the first one accepted
   * by wifi/getWifiProperties. Shared accounts and firmware variants can expose
   * both a relation ID and the real Wi-Fi device ID.
   */
  async resolveDeviceId(candidates = []) {
    const normalizedCandidates = [];
    for (const candidate of candidates) {
      const id = normalizeId(candidate);
      if (id && !normalizedCandidates.includes(id)) normalizedCandidates.push(id);
    }

    let lastNotFound = null;
    for (const candidate of normalizedCandidates) {
      try {
        const properties = await this.getDeviceProperties(candidate);
        return {
          deviceId: candidate,
          properties,
          offline: false,
        };
      } catch (error) {
        if (error instanceof XHouseDeviceNotFoundError) {
          lastNotFound = error;
          continue;
        }
        if (error instanceof XHouseDeviceOfflineError) {
          // A device-offline response proves that this is a valid identifier.
          return {
            deviceId: candidate,
            properties: null,
            offline: true,
          };
        }
        throw error;
      }
    }

    if (lastNotFound) throw lastNotFound;
    throw new XHouseDeviceNotFoundError('No usable XHouse device identifier was found.');
  }

  async sendCommand(body) {
    this._assertAuthenticated();
    const data = await this._post('wifi/sendWifiCode', body);
    this._checkResponse(data, 'Failed to control device');
    return true;
  }

  _assertAuthenticated() {
    if (!this.token || !this.userId) {
      throw new XHouseAuthError('XHouse session is missing.');
    }
  }

  _checkResponse(data, prefix) {
    const message = String(data?.msg || '');
    const normalizedMessage = message.toLowerCase();

    if (normalizedMessage.includes('token invalid') || normalizedMessage.includes('invalid token')) {
      this.clearSession();
      throw new XHouseAuthError('XHouse token is invalid.');
    }
    if (
      normalizedMessage.includes('device.not.exist')
      || normalizedMessage.includes('device not exist')
      || normalizedMessage.includes('device does not exist')
      || normalizedMessage.includes('device_not_exist')
    ) {
      throw new XHouseDeviceNotFoundError(`${prefix}: ${message || 'device not found'}`);
    }
    if (normalizedMessage.includes('device offline')) {
      throw new XHouseDeviceOfflineError('XHouse device is offline.');
    }
    if (String(data?.code) !== '0') {
      throw new XHouseError(`${prefix}: ${message || `code ${data?.code ?? 'unknown'}`}`);
    }
  }

  _generateSignature(timestamp) {
    return crypto
      .createHmac('md5', HMAC_SECRET_KEY)
      .update(`${PLATFORM_CODE}${timestamp}`)
      .digest('hex');
  }

  _buildHeaders({ authenticated, bodyLength, url }) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = {
      apptype: APP_TYPE,
      l: 'EN',
      platformcode: PLATFORM_CODE,
      saascode: SAAS_CODE,
      timestamp,
      signature: this._generateSignature(timestamp),
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(bodyLength),
      'user-agent': 'okhttp/4.2.0',
      host: url.host,
      connection: 'Keep-Alive',
    };

    if (authenticated) {
      this._assertAuthenticated();
      headers.token = this.token;
      headers.userid = this.userId;
      headers.phonetime = formatLocalDateTime(new Date());
    }

    return headers;
  }

  async _post(endpoint, body, authenticated = true) {
    const url = new URL(endpoint, API_BASE_URL);
    const bodyString = stringifyLosslessJson(body);
    const bodyBuffer = Buffer.from(bodyString, 'utf8');
    const headers = this._buildHeaders({
      authenticated,
      bodyLength: bodyBuffer.length,
      url,
    });

    return new Promise((resolve, reject) => {
      const request = https.request(url, {
        method: 'POST',
        headers,
        agent: this.agent,
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const responseText = Buffer.concat(chunks).toString('utf8');
          if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
            reject(new XHouseError(
              `XHouse HTTP ${response.statusCode || 'error'} at ${endpoint}: ${responseText.slice(0, 200)}`,
            ));
            return;
          }

          try {
            resolve(responseText ? parseLosslessJson(responseText) : {});
          } catch (error) {
            reject(new XHouseError(
              `XHouse returned invalid JSON at ${endpoint}.`,
              { cause: error },
            ));
          }
        });
      });

      request.setTimeout(REQUEST_TIMEOUT_MS, () => {
        request.destroy(new XHouseError(`XHouse request timed out at ${endpoint}.`));
      });
      request.on('error', error => {
        if (error instanceof XHouseError) reject(error);
        else reject(new XHouseError(`XHouse request failed at ${endpoint}: ${error.message}`, { cause: error }));
      });
      request.end(bodyBuffer);
    });
  }
}

function formatLocalDateTime(date) {
  const pad = value => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds()),
  ].join('');
}

function createNoopLogger() {
  return {
    debug() {},
    log() {},
    warn() {},
    error() {},
  };
}

module.exports = XHouseApi;
module.exports.formatLocalDateTime = formatLocalDateTime;
