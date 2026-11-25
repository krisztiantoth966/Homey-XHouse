'use strict';

const Homey = require('homey');

const XHouseApi = require('./lib/xhouse-api');

class XHouseApp extends Homey.App {
  async onInit() {
    this._xhouseAccounts = new Map();
    this._stateTriggers = {
      open: this.homey.flow.getDeviceTriggerCard('gate_opened'),
      closed: this.homey.flow.getDeviceTriggerCard('gate_closed'),
      opening: this.homey.flow.getDeviceTriggerCard('gate_opening'),
      closing: this.homey.flow.getDeviceTriggerCard('gate_closing'),
      stopped: this.homey.flow.getDeviceTriggerCard('gate_stopped'),
    };
    this._onlineTrigger = this.homey.flow.getDeviceTriggerCard('gate_online');
    this._offlineTrigger = this.homey.flow.getDeviceTriggerCard('gate_offline');

    this.homey.flow.getActionCard('open_gate')
      .registerRunListener(async ({ device }) => device.openGate());
    this.homey.flow.getActionCard('close_gate')
      .registerRunListener(async ({ device }) => device.closeGate());
    this.homey.flow.getActionCard('stop_gate')
      .registerRunListener(async ({ device }) => device.stopGate());
    this.homey.flow.getActionCard('refresh_gate')
      .registerRunListener(async ({ device }) => {
        const refreshed = await device.refreshNow();
        if (!refreshed) throw new Error('XHouse status refresh failed.');
        return true;
      });

    this.homey.flow.getConditionCard('gate_is_state')
      .registerRunListener(async ({ device, state }) => device.getCurrentGateState() === state);
    this.homey.flow.getConditionCard('gate_is_online')
      .registerRunListener(async ({ device }) => device.getAvailable());

    this.log('XHouse Gate app initialized.');
  }

  registerXHouseSession(email, session = {}) {
    const account = this._getXHouseAccount(email);
    if (!account.token && session.token) account.token = String(session.token);
    if (!account.userId && session.userId !== undefined && session.userId !== null) {
      account.userId = String(session.userId);
    }
    if (!account.password && session.password) account.password = String(session.password);
    return this.getXHouseSession(email);
  }

  setXHouseSession(email, session = {}) {
    const account = this._getXHouseAccount(email);
    if (session.token) account.token = String(session.token);
    if (session.userId !== undefined && session.userId !== null) {
      account.userId = String(session.userId);
    }
    if (session.password) account.password = String(session.password);
    return this.getXHouseSession(email);
  }

  getXHouseSession(email) {
    const account = this._getXHouseAccount(email);
    return {
      token: account.token,
      userId: account.userId,
      password: account.password,
    };
  }

  async authenticateXHouse(email, password, logger = null) {
    const account = this._getXHouseAccount(email);
    const loginPassword = String(password || account.password || '');
    if (!loginPassword) throw new Error('XHouse password is missing. Repair the device.');

    if (account.loginPromise) return account.loginPromise;

    account.loginPromise = (async () => {
      const api = new XHouseApi({ logger });
      try {
        const session = await api.login(email, loginPassword);
        return this.setXHouseSession(email, {
          ...session,
          password: loginPassword,
        });
      } finally {
        api.close();
      }
    })();

    try {
      return await account.loginPromise;
    } finally {
      account.loginPromise = null;
    }
  }

  _getXHouseAccount(email) {
    if (!this._xhouseAccounts) this._xhouseAccounts = new Map();
    const key = String(email || '').trim().toLowerCase();
    if (!key) throw new Error('XHouse email is missing.');
    if (!this._xhouseAccounts.has(key)) {
      this._xhouseAccounts.set(key, {
        token: null,
        userId: null,
        password: null,
        loginPromise: null,
      });
    }
    return this._xhouseAccounts.get(key);
  }

  async triggerGateState(device, state, { previousState = 'unknown', position = 0 } = {}) {
    const trigger = this._stateTriggers[state];
    if (!trigger) return;
    try {
      await trigger.trigger(device, {
        position: Number(position) || 0,
        previous_state: previousState,
      }, { state });
    } catch (error) {
      this.error(`Failed to trigger ${state} Flow:`, error.message);
    }
  }

  async triggerGateAvailability(device, online) {
    const trigger = online ? this._onlineTrigger : this._offlineTrigger;
    if (!trigger) return;
    try {
      await trigger.trigger(device, {}, { online });
    } catch (error) {
      this.error('Failed to trigger availability Flow:', error.message);
    }
  }
}

module.exports = XHouseApp;
