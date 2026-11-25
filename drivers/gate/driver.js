'use strict';

const Homey = require('homey');

const { setupPairing, setupRepair } = require('../../lib/pairing');
const { isBleGate, isEga } = require('../../lib/xhouse-device');

const BASE_CAPABILITIES = [
  'garagedoor_closed',
  'windowcoverings_state',
  'xhouse_gate_state',
  'xhouse_position',
];

const EGA_CAPABILITIES = [
  ...BASE_CAPABILITIES,
  'xhouse_left_position',
  'xhouse_right_position',
];

class XHouseGateDriver extends Homey.Driver {
  async onInit() {
    this.log('XHouse gate driver initialized.');
  }

  async onPair(session) {
    setupPairing(this, session, {
      acceptsDevice: isBleGate,
      capabilities: device => (isEga(device) ? EGA_CAPABILITIES : BASE_CAPABILITIES),
      defaultSettings: {
        refresh_interval: 30,
        debug_mode: false,
      },
    });
  }

  async onRepair(session, device) {
    setupRepair(this, session, device, isBleGate);
  }
}

module.exports = XHouseGateDriver;
