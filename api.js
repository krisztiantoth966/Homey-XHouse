'use strict';

module.exports = {
  async getLog({ homey }) {
    return homey.app.logLines || [];
  },
};
