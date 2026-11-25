'use strict';

const XHouseApi = require('./xhouse-api');
const { XHouseDeviceNotFoundError } = require('./errors');
const {
  normalizeDevice,
  parseStoredIdCandidates,
  serializeIdCandidates,
} = require('./xhouse-device');

function setupPairing(driver, session, {
  acceptsDevice,
  capabilities,
  defaultSettings = {},
}) {
  let api = null;
  let email = null;
  let password = null;
  let compatibleDevices = [];

  session.setHandler('login', async data => {
    email = String(data?.username || '').trim().toLowerCase();
    password = String(data?.password || '');

    if (!email || !password) {
      throw new Error(driver.homey.__('pair.missing_credentials'));
    }

    if (api) api.close();
    api = new XHouseApi({ logger: createDriverLogger(driver) });

    try {
      await api.login(email, password);
      driver.homey.app.setXHouseSession?.(email, {
        ...api.getSession(),
        password,
      });
      const rawDevices = await api.getDevices();
      const discovered = rawDevices
        .map(normalizeDevice)
        .filter(device => device.idCandidates.length > 0)
        .filter(device => acceptsDevice(device));

      compatibleDevices = [];
      for (const device of discovered) {
        await resolveDiscoveredDevice(driver, api, device);
        compatibleDevices.push(device);
      }
      return true;
    } catch (error) {
      driver.error('XHouse pairing login failed:', error.message);
      throw new Error(`${driver.homey.__('pair.login_failed')} ${error.message}`);
    }
  });

  session.setHandler('list_devices', async () => {
    if (!api || !email || !password) {
      throw new Error(driver.homey.__('pair.login_first'));
    }

    const { token, userId } = api.getSession();
    return compatibleDevices.map(device => ({
      name: device.alias,
      data: {
        // This is Homey's immutable identity. Runtime API calls use the
        // separately resolved apiDeviceId stored below.
        id: device.id,
      },
      capabilities: [...(typeof capabilities === 'function' ? capabilities(device) : capabilities)],
      settings: { ...defaultSettings },
      store: {
        email,
        password,
        token,
        userId,
        alias: device.alias,
        model: device.model,
        deviceType: device.deviceType,
        bleCode: device.bleCode,
        apiDeviceId: device.apiDeviceId || device.id,
        deviceIdCandidates: serializeIdCandidates(device.idCandidates),
      },
    }));
  });
}

function setupRepair(driver, session, device, acceptsDevice) {
  session.setHandler('login', async data => {
    const email = String(data?.username || '').trim().toLowerCase();
    const password = String(data?.password || '');
    if (!email || !password) {
      throw new Error(driver.homey.__('pair.missing_credentials'));
    }

    const api = new XHouseApi({ logger: createDriverLogger(driver) });
    try {
      await api.login(email, password);
      driver.homey.app.setXHouseSession?.(email, {
        ...api.getSession(),
        password,
      });
      const rawDevices = await api.getDevices();
      const discovered = rawDevices
        .map(normalizeDevice)
        .filter(candidate => candidate.idCandidates.length > 0)
        .filter(candidate => acceptsDevice(candidate));

      const matchedDevice = findMatchingDiscoveredDevice(device, discovered);
      if (!matchedDevice) {
        throw new Error(driver.homey.__('pair.device_not_found'));
      }

      await resolveDiscoveredDevice(driver, api, matchedDevice);
      const { token, userId } = api.getSession();
      await device.updateCredentials({
        email,
        password,
        token,
        userId,
        alias: matchedDevice.alias,
        model: matchedDevice.model,
        deviceType: matchedDevice.deviceType,
        bleCode: matchedDevice.bleCode,
        apiDeviceId: matchedDevice.apiDeviceId || matchedDevice.id,
        deviceIdCandidates: matchedDevice.idCandidates,
      });
      return true;
    } catch (error) {
      driver.error('XHouse repair failed:', error.message);
      throw new Error(`${driver.homey.__('pair.login_failed')} ${error.message}`);
    } finally {
      api.close();
    }
  });
}

async function resolveDiscoveredDevice(driver, api, device) {
  try {
    const resolution = await api.resolveDeviceId(device.idCandidates);
    device.apiDeviceId = resolution.deviceId;
    if (resolution.properties?.bleCode) device.bleCode = resolution.properties.bleCode;
    driver.log(
      `XHouse device resolved: ${device.alias} (${device.model}), API ID ${maskId(device.apiDeviceId)}`,
    );
  } catch (error) {
    if (!(error instanceof XHouseDeviceNotFoundError)) throw error;
    device.apiDeviceId = device.id;
    driver.error(
      `Could not verify XHouse API ID for ${device.alias} (${device.model}). `
      + `Candidates: ${device.idCandidates.map(maskId).join(', ')}`,
    );
  }
}

function findMatchingDiscoveredDevice(device, discovered) {
  const criteria = {
    ids: [
      String(device.getData().id || ''),
      String(device.getStoreValue('apiDeviceId') || ''),
      ...parseStoredIdCandidates(device.getStoreValue('deviceIdCandidates')),
    ].filter(Boolean),
    bleCode: String(device.getStoreValue('bleCode') || ''),
    model: String(device.getStoreValue('model') || ''),
    deviceType: String(device.getStoreValue('deviceType') || ''),
  };

  return findBestDeviceMatch(discovered, criteria);
}

function findBestDeviceMatch(discovered, criteria = {}) {
  const devices = Array.isArray(discovered) ? discovered : [];
  if (devices.length === 0) return null;

  const ids = (criteria.ids || []).map(value => String(value || '')).filter(Boolean);
  const byId = devices.filter(candidate => (
    candidate.idCandidates.some(id => ids.includes(String(id)))
  ));
  if (byId.length === 1) return byId[0];
  if (byId.length > 1) return refineUniqueMatch(byId, criteria);

  const bleCode = String(criteria.bleCode || '');
  if (bleCode) {
    const byBle = devices.filter(candidate => String(candidate.bleCode || '') === bleCode);
    if (byBle.length === 1) return byBle[0];
    if (byBle.length > 1) return refineUniqueMatch(byBle, criteria);
  }

  return refineUniqueMatch(devices, criteria);
}

function refineUniqueMatch(devices, criteria = {}) {
  const model = String(criteria.model || '').toUpperCase();
  const deviceType = String(criteria.deviceType || '').toUpperCase();

  if (model && deviceType) {
    const exact = devices.filter(candidate => (
      String(candidate.model || '').toUpperCase() === model
      && String(candidate.deviceType || '').toUpperCase() === deviceType
    ));
    if (exact.length === 1) return exact[0];
  }

  if (model) {
    const modelMatches = devices.filter(candidate => (
      String(candidate.model || '').toUpperCase() === model
    ));
    if (modelMatches.length === 1) return modelMatches[0];
  }

  return devices.length === 1 ? devices[0] : null;
}

function maskId(value) {
  const id = String(value || '');
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function createDriverLogger(driver) {
  return {
    debug: (...args) => driver.log(...args),
    log: (...args) => driver.log(...args),
    warn: (...args) => driver.log(...args),
    error: (...args) => driver.error(...args),
  };
}

module.exports = {
  setupPairing,
  setupRepair,
  findMatchingDiscoveredDevice,
  findBestDeviceMatch,
  maskId,
};
