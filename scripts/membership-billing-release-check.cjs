// Read-only operation. No AppModule, workers, provider calls or apply mode.
const { readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { parseArgs } = require('node:util');
const mongoose = require('mongoose');
const { EJSON } = mongoose.mongo.BSON;
const collections = [
  'register',
  'membership_dues',
  'membership_payments',
  'membership_billing_config',
  'audit_logs',
];

async function readSnapshot(connection) {
  const snapshot = {};
  const session = await connection.startSession();
  try {
    await session.withTransaction(
      async () => {
        for (const name of collections) {
          const projection =
            name === 'register'
              ? {
                  _id: 1,
                  namePlayer: 1,
                  role: 1,
                  statePlayer: 1,
                  updatePayment: 1,
                  partnerType: 1,
                  titularId: 1,
                  billingStartPeriod: 1,
                  billingBaseline: 1,
                  billingPeriods: 1,
                  billingClosure: 1,
                  __v: 1,
                }
              : undefined;
          const filter = name === 'audit_logs' ? { entityType: 'MEMBERSHIP_PAYMENT' } : {};
          snapshot[name] = await connection.db
            .collection(name)
            .find(filter, { session, projection })
            .sort({ _id: 1 })
            .toArray();
        }
      },
      { readConcern: { level: 'snapshot' }, readPreference: 'primary' },
    );
  } finally {
    await session.endSession();
  }
  return snapshot;
}

function writeBackup(path, snapshot, database) {
  const data = { format: 'CTQ_MEMBERSHIP_BACKUP_V1', createdAt: new Date(), database, snapshot };
  const checksum = createHash('sha256').update(EJSON.stringify(data)).digest('hex');
  writeFileSync(path, EJSON.stringify({ ...data, checksum }), { flag: 'wx', mode: 0o600 });
  return checksum;
}

function validateBackup(path) {
  const { checksum, ...data } = EJSON.parse(readFileSync(path, 'utf8'));
  if (
    data.format !== 'CTQ_MEMBERSHIP_BACKUP_V1' ||
    !/^[a-f\d]{64}$/.test(checksum || '') ||
    createHash('sha256').update(EJSON.stringify(data)).digest('hex') !== checksum ||
    !data.snapshot ||
    Object.keys(data.snapshot).sort().join(',') !== [...collections].sort().join(',') ||
    collections.some((name) => !Array.isArray(data.snapshot[name]))
  )
    throw new Error('Invalid membership backup or checksum.');
  return data;
}

async function auditDatabase({ uri, database, pilotIds, backup }) {
  const { buildBillingReleaseReport } = require('../src/membership-billing/billing-release-check');
  if (!uri || !database)
    throw new Error('Explicit existing MONGODB_URI and database are required.');
  const connection = await mongoose
    .createConnection(uri, {
      dbName: database,
      autoCreate: false,
      autoIndex: false,
      serverSelectionTimeoutMS: 15000,
    })
    .asPromise();
  try {
    if (!(await connection.db.admin().command({ hello: 1 })).setName)
      throw new Error('Snapshot review requires a replica set.');
    const snapshot = await readSnapshot(connection);
    const indexes = {};
    for (const name of collections.filter((name) => name !== 'register')) {
      try {
        indexes[name] = await connection.db.collection(name).indexes();
      } catch (error) {
        if (error.code !== 26) throw error;
        indexes[name] = [];
      }
    }
    const report = buildBillingReleaseReport(snapshot, pilotIds, indexes);
    if (backup) {
      writeBackup(backup, snapshot, database);
      validateBackup(backup);
    }
    return report;
  } finally {
    await connection.close();
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      database: { type: 'string' },
      'pilot-member-id': { type: 'string', multiple: true },
      backup: { type: 'string' },
      'validate-backup': { type: 'string' },
    },
  });
  if (values['validate-backup']) {
    const data = validateBackup(values['validate-backup']);
    console.log(
      JSON.stringify(
        {
          valid: true,
          format: data.format,
          createdAt: data.createdAt,
          counts: Object.fromEntries(collections.map((name) => [name, data.snapshot[name].length])),
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(
    JSON.stringify(
      await auditDatabase({
        uri: process.env.MONGODB_URI,
        database: values.database,
        pilotIds: values['pilot-member-id'] || [],
        backup: values.backup,
      }),
      null,
      2,
    ),
  );
}

module.exports = { readSnapshot, writeBackup, validateBackup, auditDatabase };
if (require.main === module) {
  require('reflect-metadata');
  require('ts-node/register');
  main().catch(() => {
    console.error('Read-only review failed. No automatic change or activation was attempted.');
    process.exitCode = 1;
  });
}
