'use strict';

const Homey = require('homey');

const {
  DEFAULT_REFRESH_INTERVAL,
  FAST_POLL_DURATION_MS,
  FAST_POLL_INTERVAL_MS,
  FAST_POLL_MAX_MS,
  OFFLINE_AFTER_FAILURES,
  MAX_REFRESH_INTERVAL,
  MIN_REFRESH_INTERVAL,
} = require('./constants');
const {
  XHouseAuthError,
  XHouseLoginDeferredError,
  XHouseDeviceOfflineError,
  XHouseDeviceNotFoundError,
} = require('./errors');
const XHouseApi = require('./xhouse-api');
const {
  isBleGate,
  isGarageOpener,
  normalizeDevice,
  parseStoredIdCandidates,
  serializeIdCandidates,
} = require('./xhouse-device');

const VALID_STATES = new Set([
  'closed',
  'open',
  'opening',
  'closing',
  'stopped',
  'unknown',
]);

class BaseXHouseDevice extends Homey.Device {
  async onInit() {
    this._destroyed = false;
    this._pollTimer = null;
    this._fastPollTimer = null;
    this._fastPollDeadline = 0;
    this._pollPromise = null;
    this._bindingRecoveryPromise = null;
    this._consecutiveFailures = 0;
    this._online = null;
    this._hasPolled = false;
    this._lastState = this.hasCapability('xhouse_gate_state')
      ? this.getCapabilityValue('xhouse_gate_state')
      : null;

    this._email = this.getStoreValue('email') || null;
    this._password = this.getStoreValue('password') || null;
    this._alias = this.getStoreValue('alias') || this.getName();
    this._model = this.getStoreValue('model') || 'Unknown';
    this._deviceType = this.getStoreValue('deviceType') || 'Unknown';
    this._bleCode = this.getStoreValue('bleCode') || null;
    this._apiDeviceId = String(
      this.getStoreValue('apiDeviceId') || this.getData().id || '',
    );
    this._deviceIdCandidates = mergeIds(
      [this._apiDeviceId, String(this.getData().id || '')],
      parseStoredIdCandidates(this.getStoreValue('deviceIdCandidates')),
    );

    this._api = new XHouseApi({
      token: this.getStoreValue('token') || null,
      userId: this.getStoreValue('userId') || null,
      logger: this._createLogger(),
    });
    if (this._email) {
      this.homey.app.registerXHouseSession?.(this._email, {
        ...this._api.getSession(),
        password: this._password,
      });
    }

    await this._migrateSettings();
    this._registerCapabilityListeners();
    this._scheduleRegularPolling();
    await this.refreshNow();
    this.log(`Initialized ${this.getName()} (${this._model}).`);
  }

  // 1.0.x defaulted to 30 s; 1.1 polls every 15 s for quicker feedback.
  async _migrateSettings() {
    if (this.getStoreValue('settingsVersion') >= 2) return;
    try {
      if (Number(this.getSetting('refresh_interval')) === 30) {
        await this.setSettings({ refresh_interval: DEFAULT_REFRESH_INTERVAL });
      }
      await this.setStoreValue('settingsVersion', 2);
    } catch (error) {
      this.error('Settings migration failed:', error.message);
    }
  }

  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('refresh_interval')) {
      const interval = clampRefreshInterval(newSettings.refresh_interval);
      if (Number(newSettings.refresh_interval) !== interval) {
        throw new Error(this.homey.__('errors.invalid_refresh_interval'));
      }
      this._scheduleRegularPolling(interval);
    }

    if (changedKeys.includes('debug_mode')) {
      this.log(`Debug logging ${newSettings.debug_mode ? 'enabled' : 'disabled'}.`);
    }

    await this.refreshNow();
  }

  async onDeleted() {
    this._cleanup();
  }

  async onUninit() {
    this._cleanup();
  }

  async updateCredentials({
    email,
    password,
    token,
    userId,
    alias,
    model,
    deviceType,
    bleCode,
    apiDeviceId,
    deviceIdCandidates,
  }) {
    this._email = email;
    this._password = password;
    this._alias = alias || this._alias;
    this._model = model || this._model;
    this._deviceType = deviceType || this._deviceType;
    this._bleCode = bleCode || this._bleCode;
    this._apiDeviceId = String(apiDeviceId || this._apiDeviceId || this.getData().id || '');
    this._deviceIdCandidates = mergeIds(
      [this._apiDeviceId, String(this.getData().id || '')],
      Array.isArray(deviceIdCandidates) ? deviceIdCandidates : [],
      this._deviceIdCandidates,
    );

    const updates = {
      email: this._email,
      password: this._password,
      token,
      userId,
      alias: this._alias,
      model: this._model,
      deviceType: this._deviceType,
      bleCode: this._bleCode,
      apiDeviceId: this._apiDeviceId,
      deviceIdCandidates: serializeIdCandidates(this._deviceIdCandidates),
    };

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && value !== null) {
        await this.setStoreValue(key, value);
      }
    }

    this._api.setSession({ token, userId });
    this.homey.app.setXHouseSession?.(this._email, {
      token,
      userId,
      password: this._password,
    });
    this._online = null;
    await this.refreshNow();
  }

  async openGate() {
    return this._runCommand('open');
  }

  async closeGate() {
    return this._runCommand('close');
  }

  async stopGate() {
    return this._runCommand('stop');
  }

  async refreshNow() {
    if (this._destroyed) return false;
    if (this._pollPromise) return this._pollPromise;

    this._pollPromise = this._poll()
      .catch(async error => {
        await this._handlePollError(error);
        return false;
      })
      .finally(() => {
        this._pollPromise = null;
      });

    return this._pollPromise;
  }

  getCurrentGateState() {
    if (!this.hasCapability('xhouse_gate_state')) return 'unknown';
    return this.getCapabilityValue('xhouse_gate_state') || 'unknown';
  }

  getApiDeviceId() {
    return this._apiDeviceId || String(this.getData().id || '');
  }

  async _poll() {
    if (!this._email || !this._password) {
      throw new XHouseAuthError(this.homey.__('errors.repair_required'));
    }

    const status = await this._withAuthRetry(() => this._fetchStatus());
    await this._applyStatus(status || { state: 'unknown' });
    this._consecutiveFailures = 0;
    await this._setOnline(true);
    return true;
  }

  async _runCommand(action) {
    if (!['open', 'close', 'stop'].includes(action)) {
      throw new Error(`Unsupported action: ${action}`);
    }
    if (!this._email || !this._password) {
      throw new XHouseAuthError(this.homey.__('errors.repair_required'));
    }

    try {
      await this._withAuthRetry(() => this._sendAction(action));
      await this._applyPredictedAction(action);
      this._consecutiveFailures = 0;
      await this._setOnline(true);
      this._startFastPolling();
      return true;
    } catch (error) {
      await this._handlePollError(error);
      throw new Error(this._userMessage(error));
    }
  }

  async _withAuthRetry(operation) {
    await this._syncSharedSession();

    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof XHouseAuthError)) throw error;
    }

    const session = this.homey.app.authenticateXHouse
      ? await this.homey.app.authenticateXHouse(this._email, this._password, this._createLogger())
      : { ...await this._api.login(this._email, this._password), password: this._password };
    await this._applyAuthenticatedSession(session);
    return operation();
  }

  async _syncSharedSession() {
    if (!this._email || !this.homey.app.getXHouseSession) return;
    const session = this.homey.app.getXHouseSession(this._email);
    if (!session?.token || session.userId === undefined || session.userId === null) return;

    const tokenChanged = this._api.token !== String(session.token);
    const userChanged = this._api.userId !== String(session.userId);
    const passwordChanged = Boolean(session.password && session.password !== this._password);
    if (!tokenChanged && !userChanged && !passwordChanged) return;

    await this._applyAuthenticatedSession(session);
  }

  async _applyAuthenticatedSession(session) {
    if (!session?.token || session.userId === undefined || session.userId === null) {
      throw new XHouseAuthError('XHouse login did not return a valid session.');
    }

    this._api.setSession({ token: session.token, userId: session.userId });
    if (session.password) this._password = String(session.password);
    await this.setStoreValue('token', String(session.token));
    await this.setStoreValue('userId', String(session.userId));
    if (this._password) await this.setStoreValue('password', this._password);
    this.homey.app.setXHouseSession?.(this._email, {
      token: session.token,
      userId: session.userId,
      password: this._password,
    });
  }

  /**
   * Fetch properties and automatically repair an obsolete/rounded device ID.
   */
  async _getDeviceProperties() {
    return this._withDeviceBindingRecovery(
      () => this._api.getDeviceProperties(this.getApiDeviceId()),
    );
  }

  /**
   * Send a command and retry once after rediscovering the real XHouse ID.
   */
  async _sendDeviceCommand(buildBody) {
    return this._withDeviceBindingRecovery(
      () => this._api.sendCommand(buildBody(this.getApiDeviceId())),
    );
  }

  async _withDeviceBindingRecovery(operation) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof XHouseDeviceNotFoundError)) throw error;
    }

    const recovered = await this._recoverDeviceBinding();
    if (!recovered) {
      throw new XHouseDeviceNotFoundError(
        'XHouse device could not be matched after rediscovery. Remove it and pair it again.',
      );
    }
    return operation();
  }

  async _recoverDeviceBinding() {
    if (this._bindingRecoveryPromise) return this._bindingRecoveryPromise;

    this._bindingRecoveryPromise = this._recoverDeviceBindingInternal()
      .finally(() => {
        this._bindingRecoveryPromise = null;
      });
    return this._bindingRecoveryPromise;
  }

  async _recoverDeviceBindingInternal() {
    this.log('XHouse device ID was rejected. Rediscovering the device binding...');
    const rawDevices = await this._api.getDevices();
    const discovered = rawDevices
      .map(normalizeDevice)
      .filter(device => device.idCandidates.length > 0)
      .filter(device => (this.driver.id === 'garage'
        ? isGarageOpener(device)
        : isBleGate(device)));

    const orderedMatches = rankDiscoveredDevices(this, discovered);
    for (const device of orderedMatches) {
      try {
        const resolution = await this._api.resolveDeviceId(device.idCandidates);
        await this._persistResolvedDevice(device, resolution);
        return true;
      } catch (error) {
        if (error instanceof XHouseDeviceNotFoundError) continue;
        throw error;
      }
    }

    this.error(
      `XHouse rediscovery could not match ${this._model}. `
      + `Discovered models: ${discovered.map(item => item.model).join(', ') || 'none'}`,
    );
    return false;
  }

  async _persistResolvedDevice(device, resolution) {
    const previousId = this.getApiDeviceId();
    this._apiDeviceId = String(resolution.deviceId);
    this._deviceIdCandidates = mergeIds(
      [this._apiDeviceId, String(this.getData().id || '')],
      device.idCandidates,
      this._deviceIdCandidates,
    );
    this._alias = device.alias || this._alias;
    this._model = device.model || this._model;
    this._deviceType = device.deviceType || this._deviceType;
    this._bleCode = resolution.properties?.bleCode || device.bleCode || this._bleCode;

    await this.setStoreValue('apiDeviceId', this._apiDeviceId);
    await this.setStoreValue('deviceIdCandidates', serializeIdCandidates(this._deviceIdCandidates));
    await this.setStoreValue('alias', this._alias);
    await this.setStoreValue('model', this._model);
    await this.setStoreValue('deviceType', this._deviceType);
    if (this._bleCode) await this.setStoreValue('bleCode', this._bleCode);

    this.log(
      `Recovered XHouse device binding ${maskId(previousId)} -> ${maskId(this._apiDeviceId)} `
      + `for ${this._model}.`,
    );
  }

  async _applyStatus(status) {
    const state = VALID_STATES.has(status.state) ? status.state : 'unknown';
    const previousState = this._lastState;

    await this._setCapabilityIfPresent('xhouse_gate_state', state);

    // Moving gate (e.g. started by a remote or wall button): follow it closely.
    if (state === 'opening' || state === 'closing') this._startFastPolling();

    if (state !== 'unknown') {
      await this._setCapabilityIfPresent('garagedoor_closed', state === 'closed');
      await this._setCapabilityIfPresent(
        'windowcoverings_state',
        state === 'opening' ? 'up' : state === 'closing' ? 'down' : 'idle',
      );
    }

    if (Number.isFinite(status.position)) {
      await this._setCapabilityIfPresent('xhouse_position', Math.max(0, Math.min(100, status.position)));
    }
    if (Number.isFinite(status.posLeft)) {
      await this._setCapabilityIfPresent('xhouse_left_position', Math.max(0, Math.min(100, status.posLeft)));
    }
    if (Number.isFinite(status.posRight)) {
      await this._setCapabilityIfPresent('xhouse_right_position', Math.max(0, Math.min(100, status.posRight)));
    }

    this._lastState = state;
    if (this._hasPolled && previousState && previousState !== state && this.driver.id === 'gate') {
      await this.homey.app.triggerGateState(this, state, {
        previousState,
        position: Number.isFinite(status.position) ? status.position : 0,
      });
    }
    this._hasPolled = true;
  }

  async _applyPredictedAction(action) {
    const stateByAction = {
      open: 'opening',
      close: 'closing',
      stop: 'stopped',
    };
    const predictedState = stateByAction[action];
    const previousState = this._lastState || 'unknown';

    if (action === 'open') {
      await this._setCapabilityIfPresent('garagedoor_closed', false);
      await this._setCapabilityIfPresent('windowcoverings_state', 'up');
    } else if (action === 'close') {
      await this._setCapabilityIfPresent('garagedoor_closed', false);
      await this._setCapabilityIfPresent('windowcoverings_state', 'down');
    } else if (action === 'stop') {
      await this._setCapabilityIfPresent('windowcoverings_state', 'idle');
      await this._setCapabilityIfPresent('garagedoor_closed', false);
    }

    await this._setCapabilityIfPresent('xhouse_gate_state', predictedState);
    this._lastState = predictedState;

    if (this._hasPolled && previousState !== predictedState && this.driver.id === 'gate') {
      await this.homey.app.triggerGateState(this, predictedState, {
        previousState,
        position: this.getCapabilityValue('xhouse_position') || 0,
      });
    }
  }

  async _setCapabilityIfPresent(capability, value) {
    if (!this.hasCapability(capability) || value === undefined || value === null) return;
    if (this.getCapabilityValue(capability) === value) return;
    try {
      await this.setCapabilityValue(capability, value);
    } catch (error) {
      this.error(`Failed to update ${capability}:`, error.message);
    }
  }

  _userMessage(error) {
    if (error instanceof XHouseDeviceOfflineError) return this.homey.__('errors.device_offline');
    if (error instanceof XHouseLoginDeferredError) return this.homey.__('errors.login_deferred');
    if (error instanceof XHouseAuthError) {
      return this._email && this._password
        ? this.homey.__('errors.authentication_failed')
        : this.homey.__('errors.repair_required');
    }
    return `${this.homey.__('errors.connection_failed')} ${error.message}`;
  }

  async _handlePollError(error) {
    this._consecutiveFailures += 1;
    const isOffline = error instanceof XHouseDeviceOfflineError;
    const isCredential = error instanceof XHouseAuthError && !(error instanceof XHouseLoginDeferredError);
    const isNotFound = error instanceof XHouseDeviceNotFoundError;

    // Transient problems (cloud hiccup, deferred login, network not ready after
    // a reboot) keep the device available for a few attempts; the app keeps
    // retrying with the stored credentials and recovers on its own.
    if (isOffline || isNotFound || this._consecutiveFailures >= OFFLINE_AFTER_FAILURES
        || (isCredential && this._consecutiveFailures >= 2)) {
      await this._setOnline(false, this._userMessage(error));
    }

    if (this._isDebugEnabled()) this.error(error);
    else this.error(error.message);
  }

  async _setOnline(online, reason = null) {
    const previous = this._online;
    this._online = online;

    if (online) {
      if (!this.getAvailable()) await this.setAvailable();
    } else if (this.getAvailable()) {
      await this.setUnavailable(reason || this.homey.__('errors.connection_failed'));
    }

    if (previous !== null && previous !== online && this.driver.id === 'gate') {
      await this.homey.app.triggerGateAvailability(this, online);
    }
  }

  _scheduleRegularPolling(intervalOverride = null) {
    if (this._pollTimer) this.homey.clearInterval(this._pollTimer);
    const interval = clampRefreshInterval(
      intervalOverride === null ? this.getSetting('refresh_interval') : intervalOverride,
    );
    this._pollTimer = this.homey.setInterval(() => {
      this.refreshNow().catch(error => this.error(error));
    }, interval * 1000);
  }

  _startFastPolling() {
    const now = Date.now();
    if (!this._fastPollTimer) this._fastPollStarted = now;
    const hardLimit = (this._fastPollStarted || now) + FAST_POLL_MAX_MS;
    this._fastPollDeadline = Math.min(hardLimit, Math.max(this._fastPollDeadline || 0, now + FAST_POLL_DURATION_MS));
    if (this._fastPollTimer) return;

    this._fastPollTimer = this.homey.setInterval(() => {
      const moving = ['opening', 'closing'].includes(this._lastState);
      if (moving) {
        // keep following a moving gate, but never longer than FAST_POLL_MAX_MS
        this._fastPollDeadline = Math.min(
          this._fastPollStarted + FAST_POLL_MAX_MS,
          Math.max(this._fastPollDeadline, Date.now() + 6000),
        );
      }
      if (Date.now() >= this._fastPollDeadline || this._consecutiveFailures >= OFFLINE_AFTER_FAILURES) {
        this.homey.clearInterval(this._fastPollTimer);
        this._fastPollTimer = null;
        return;
      }
      this.refreshNow().catch(error => this.error(error));
    }, FAST_POLL_INTERVAL_MS);
  }

  _cleanup() {
    this._destroyed = true;
    if (this._pollTimer) this.homey.clearInterval(this._pollTimer);
    if (this._fastPollTimer) this.homey.clearInterval(this._fastPollTimer);
    this._pollTimer = null;
    this._fastPollTimer = null;
    if (this._api) this._api.close();
  }

  _createLogger() {
    return {
      debug: (...args) => {
        if (this._isDebugEnabled()) this.log(...args);
      },
      log: (...args) => this.log(...args),
      warn: (...args) => this.log(...args),
      error: (...args) => this.error(...args),
    };
  }

  _isDebugEnabled() {
    return Boolean(this.getSetting('debug_mode'));
  }

  // Implemented by each concrete device.
  _registerCapabilityListeners() {
    throw new Error('_registerCapabilityListeners() must be implemented.');
  }

  async _fetchStatus() {
    throw new Error('_fetchStatus() must be implemented.');
  }

  async _sendAction() {
    throw new Error('_sendAction() must be implemented.');
  }
}

function rankDiscoveredDevices(device, discovered) {
  const knownIds = new Set(mergeIds(
    [device.getApiDeviceId(), String(device.getData().id || '')],
    device._deviceIdCandidates,
  ));
  const storedBle = String(device._bleCode || '');
  const storedModel = String(device._model || '').toUpperCase();
  const storedType = String(device._deviceType || '').toUpperCase();

  const scored = [...discovered]
    .map(candidate => {
      let score = 0;
      if (candidate.idCandidates.some(id => knownIds.has(id))) score += 100;
      if (storedBle && String(candidate.bleCode || '') === storedBle) score += 80;
      if (storedModel && String(candidate.model || '').toUpperCase() === storedModel) score += 40;
      if (storedType && String(candidate.deviceType || '').toUpperCase() === storedType) score += 20;
      return { candidate, score };
    })
    .filter(item => item.score > 0 || discovered.length === 1)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) return [];
  const highestScore = scored[0].score;
  const equallyLikely = scored.filter(item => item.score === highestScore);
  if (equallyLikely.length !== 1) return [];

  // Never fall through to a lower-scored physical gate. If the best match is
  // not accepted by the cloud, require explicit Repair/re-pairing instead.
  return [scored[0].candidate];
}

function mergeIds(...groups) {
  const result = [];
  for (const group of groups) {
    for (const value of group || []) {
      const normalized = String(value || '').trim();
      if (normalized && !result.includes(normalized)) result.push(normalized);
    }
  }
  return result;
}

function maskId(value) {
  const id = String(value || '');
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function clampRefreshInterval(value) {
  const numeric = Number(value || DEFAULT_REFRESH_INTERVAL);
  if (!Number.isFinite(numeric)) return DEFAULT_REFRESH_INTERVAL;
  return Math.max(MIN_REFRESH_INTERVAL, Math.min(MAX_REFRESH_INTERVAL, Math.round(numeric)));
}

module.exports = BaseXHouseDevice;
module.exports.clampRefreshInterval = clampRefreshInterval;
module.exports.rankDiscoveredDevices = rankDiscoveredDevices;
module.exports.mergeIds = mergeIds;
