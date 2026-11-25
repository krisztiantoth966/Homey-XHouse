'use strict';

const BaseXHouseDevice = require('../../lib/base-xhouse-device');
const { XHouseProtocolError } = require('../../lib/errors');
const {
  buildBleCommand,
  parseEgaStatus,
  parseEgbStatus,
  parseGateMode,
} = require('../../lib/xhouse-protocol');
const { isEgb, normalizeDevice, toApiId } = require('../../lib/xhouse-device');

class XHouseGateDevice extends BaseXHouseDevice {
  _registerCapabilityListeners() {
    this.registerCapabilityListener('garagedoor_closed', async closed => {
      if (closed) return this.closeGate();
      return this.openGate();
    });

    this.registerCapabilityListener('windowcoverings_state', async state => {
      if (state === 'up') return this.openGate();
      if (state === 'down') return this.closeGate();
      if (state === 'idle') return this.stopGate();
      throw new Error(`Unsupported window covering state: ${state}`);
    });
  }

  async _fetchStatus() {
    const properties = await this._getDeviceProperties();
    if (properties.bleCode && properties.bleCode !== this._bleCode) {
      this._bleCode = properties.bleCode;
      await this.setStoreValue('bleCode', this._bleCode);
    }

    const deviceDescriptor = normalizeDevice({
      id: this.getApiDeviceId(),
      model: this._model,
      deviceType: this._deviceType,
    });

    if (isEgb(deviceDescriptor)) {
      return parseEgbStatus(properties.status) || {
        state: 'unknown',
        position: null,
      };
    }

    const gateMode = parseGateMode(properties.menuCode);
    const status = parseEgaStatus(properties.status, gateMode) || {
      state: 'unknown',
      position: null,
      posLeft: null,
      posRight: null,
    };

    return status;
  }

  async _sendAction(action) {
    if (!this._bleCode) {
      const properties = await this._getDeviceProperties();
      this._bleCode = properties.bleCode || null;
      if (this._bleCode) await this.setStoreValue('bleCode', this._bleCode);
    }

    const actionCodes = {
      open: '01',
      close: '02',
      stop: '03',
    };
    const actionCode = actionCodes[action];
    if (!actionCode) throw new XHouseProtocolError(`Unsupported gate action: ${action}`);

    const value = buildBleCommand(this._bleCode, actionCode);
    await this._sendDeviceCommand(apiDeviceId => ({
      deviceId: toApiId(apiDeviceId),
      userId: toApiId(this._api.userId),
      propertyValue: {
        type: 'SET_MENU',
        object: { value },
      },
      action: '',
    }));
  }
}

module.exports = XHouseGateDevice;
