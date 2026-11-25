'use strict';

const Homey = require('homey');

const { setupPairing, setupRepair } = require('../../lib/pairing');
const { isGarageOpener } = require('../../lib/xhouse-device');

const CAPABILITIES = [
  'garagedoor_closed',
  'xhouse_gate_state',
  'xhouse_position',
];

class XHouseGarageDriver extends Homey.Driver {
  async onInit() {
    this.log('XHouse garage opener driver initialized.');
  }

  async onPair(session) {
    setupPairing(this, session, {
      acceptsDevice: isGarageOpener,
      capabilities: CAPABILITIES,
      defaultSettings: {
        refresh_interval: 30,
        debug_mode: false,
      },
    });
  }

  async onRepair(session, device) {
    setupRepair(this, session, device, isGarageOpener);
  }
}

module.exports = XHouseGarageDriver;
