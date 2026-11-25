'use strict';

const BaseXHouseDevice = require('../../lib/base-xhouse-device');
const { XHouseProtocolError } = require('../../lib/errors');
const { toApiId } = require('../../lib/xhouse-device');

class XHouseGarageDevice extends BaseXHouseDevice {
  _registerCapabilityListeners() {
    this.registerCapabilityListener('garagedoor_closed', async closed => {
      if (closed) return this.closeGate();
      return this.openGate();
    });
  }

  async _fetchStatus() {
    const properties = await this._getDeviceProperties();
    const isOpen = String(properties.Switch_1) === '1';
    return {
      state: isOpen ? 'open' : 'closed',
      position: isOpen ? 100 : 0,
    };
  }

  async _sendAction(action) {
    if (action === 'stop') {
      throw new XHouseProtocolError(this.homey.__('errors.stop_not_supported'));
    }
    const value = action === 'open' ? 1 : 0;
    await this._sendDeviceCommand(apiDeviceId => ({
      deviceId: toApiId(apiDeviceId),
      userId: toApiId(this._api.userId),
      propertyValue: { Switch_1: value },
      action: value ? 'On' : 'Off',
    }));
  }
}

module.exports = XHouseGarageDevice;
