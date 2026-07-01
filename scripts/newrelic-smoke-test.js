'use strict';

const newrelic = require('newrelic');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  const appName = process.env.NEW_RELIC_APP_NAME || 'tennis-app-backend';
  const enabled = process.env.NEW_RELIC_ENABLED !== 'false';
  const hasLicenseKey = Boolean(process.env.NEW_RELIC_LICENSE_KEY);

  console.log('[newrelic-smoke] app:', appName);
  console.log('[newrelic-smoke] enabled flag:', enabled);
  console.log('[newrelic-smoke] license key present:', hasLicenseKey);

  if (!enabled || !hasLicenseKey) {
    console.error('[newrelic-smoke] New Relic is disabled or missing NEW_RELIC_LICENSE_KEY.');
    process.exitCode = 1;
    return;
  }

  await new Promise((resolve, reject) => {
    newrelic.startBackgroundTransaction('newrelic_smoke_test', 'SmokeTest', async () => {
      try {
        const transaction = newrelic.getTransaction();

        newrelic.addCustomAttributes({
          smokeTest: true,
          source: 'local-cli',
          appName,
        });

        newrelic.recordCustomEvent('SmokeTestEvent', {
          appName,
          source: 'local-cli',
          status: 'started',
        });

        await sleep(500);

        newrelic.recordCustomEvent('SmokeTestEvent', {
          appName,
          source: 'local-cli',
          status: 'completed',
        });

        transaction.end();
        resolve();
      } catch (error) {
        newrelic.noticeError(error);
        reject(error);
      }
    });
  });

  await sleep(2000);
  console.log('[newrelic-smoke] Smoke test transaction sent. Check APM and query SmokeTestEvent in New Relic.');
}

run().catch((error) => {
  console.error('[newrelic-smoke] failed:', error);
  process.exitCode = 1;
});
