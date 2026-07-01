'use strict';

require('dotenv').config();

const appName = process.env.NEW_RELIC_APP_NAME || 'tennis-app-backend';
const hasLicenseKey = Boolean(process.env.NEW_RELIC_LICENSE_KEY);
const isEnabled = process.env.NEW_RELIC_ENABLED !== 'false' && hasLicenseKey;

exports.config = {
  app_name: [appName],
  license_key: process.env.NEW_RELIC_LICENSE_KEY,
  agent_enabled: isEnabled,
  logging: {
    level: process.env.NEW_RELIC_LOG_LEVEL || 'info',
  },
};
