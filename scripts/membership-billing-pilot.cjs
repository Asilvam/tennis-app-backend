// Explicit operational command, never imported by AppModule and dry-run by default.
require('reflect-metadata');
require('ts-node/register');
const { readFileSync, writeFileSync } = require('node:fs');
const { parseArgs } = require('node:util');
const mongoose = require('mongoose');
const { parse } = require('dotenv');
const { buildBillingPilotPlan } = require('../src/membership-billing/billing-pilot');
const { MembershipDue, MembershipDueSchema } = require('../src/membership-billing/entities/membership-due.entity');
const { MembershipPayment, MembershipPaymentSchema } = require('../src/membership-billing/entities/membership-payment.entity');
const { MembershipBillingConfig, MembershipBillingConfigSchema } = require('../src/membership-billing/entities/membership-billing-config.entity');
const { Register, RegisterSchema } = require('../src/register/entities/register.entity');
const { AuditLog, AuditLogSchema } = require('../src/audit-log/entities/audit-log.entity');

async function main() {
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean', default: false },
      'member-id': { type: 'string', multiple: true },
      'admin-id': { type: 'string' },
      backup: { type: 'string' },
    },
  });
  const ids = values['member-id'] || [];
  if (!values['admin-id'] || ids.length !== 2) throw new Error('Explicit admin-id and two member-id flags required.');
  if (values.apply && !values.backup) throw new Error('An exclusive local backup path is required for --apply.');
  const env = parse(readFileSync('.env'));
  const connection = await mongoose
    .createConnection(env.MONGODB_URI, {
      dbName: 'Tennis',
      autoCreate: false,
      autoIndex: false,
      serverSelectionTimeoutMS: 15000,
    })
    .asPromise();
  try {
    if (!(await connection.db.admin().command({ hello: 1 })).setName) throw new Error('Replica set required.');
    const quiet = (schema) => schema.clone().set('autoCreate', false).set('autoIndex', false);
    const members = connection.model(Register.name, quiet(RegisterSchema));
    const audit = connection.model(AuditLog.name, quiet(AuditLogSchema));
    const configs = connection.model(MembershipBillingConfig.name, MembershipBillingConfigSchema);
    const dues = connection.model(MembershipDue.name, MembershipDueSchema);
    const payments = connection.model(MembershipPayment.name, MembershipPaymentSchema);
    const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
    const readInput = async (session) => ({
      memberIds: ids,
      members: await members
        .find({ _id: { $in: objectIds } })
        .select('_id namePlayer email role statePlayer partnerType titularId billingStartPeriod billingBaseline')
        .session(session)
        .lean(),
      admin: await members.findById(values['admin-id']).select('_id namePlayer role statePlayer').session(session).lean(),
      existingConfig: await configs.findOne({ key: 'MONTHLY_MEMBERSHIP' }).session(session).lean(),
      otherEnrolledCount: await members.countDocuments({ _id: { $nin: objectIds }, billingStartPeriod: { $exists: true } }).session(session),
      otherFinancialRows:
        (await dues.countDocuments({ beneficiaryId: { $nin: objectIds } }).session(session)) +
        (await payments.countDocuments({ $or: [{ allocations: { $elemMatch: { beneficiaryId: { $nin: objectIds } } } }, { 'allocations.0': { $exists: false } }] }).session(session)),
    });
    const before = await readInput(null);
    const plan = buildBillingPilotPlan(before);
    console.log(JSON.stringify({ mode: values.apply ? 'apply' : 'dry-run', database: connection.name, ...plan }, null, 2));
    if (!values.apply) return;
    const auditIndexes = await audit.collection.indexes();
    if (!auditIndexes.some((index) => index.unique && Object.keys(index.key).join() === 'eventId')) throw new Error('Existing audit eventId unique index required; no legacy indexes will be changed.');
    writeFileSync(values.backup, JSON.stringify(before, null, 2), { flag: 'wx', mode: 0o600 });
    // Additive indexes only. Never syncIndexes/dropIndexes on existing collections.
    for (const model of [configs, dues, payments]) {
      await model.createCollection();
      await model.createIndexes();
    }
    const session = await connection.startSession();
    try {
      await session.withTransaction(async () => {
        const current = buildBillingPilotPlan(await readInput(session));
        if (current.createConfig) await configs.create([current.config], { session });
        for (const member of current.members.filter((row) => row.enroll)) {
          const updated = await members.updateOne(
            { _id: member.id, billingStartPeriod: { $exists: false }, billingBaseline: { $exists: false } },
            {
              $set: {
                billingStartPeriod: current.startPeriod,
                billingBaseline: {
                  migrationId: current.migrationId,
                  throughPeriod: current.throughPeriod,
                  establishedAt: new Date(),
                  establishedBy: values['admin-id'],
                },
              },
            },
            { session },
          );
          if (updated.modifiedCount !== 1) throw new Error('Member changed during initialization.');
        }
        if (current.createConfig || current.members.some((row) => row.enroll))
          await audit.create(
            [
              {
                eventId: `${current.migrationId}:setup`,
                entityType: 'MEMBERSHIP_PAYMENT',
                entityId: current.migrationId,
                action: 'ADMIN_CREATE',
                performedBy: 'ADMIN',
                performedByUser: before.admin.namePlayer,
                description: 'Piloto de mensualidades habilitado solo para dos usuarios de prueba; sin bloqueo.',
                afterData: current,
                timestamp: new Date(),
              },
            ],
            { session },
          );
      });
    } finally {
      await session.endSession();
    }
    console.log(JSON.stringify({ applied: true, backup: values.backup, verification: buildBillingPilotPlan(await readInput(null)) }, null, 2));
  } finally {
    await connection.close();
  }
}
main().catch((error) => {
  console.error(error.name + ': ' + error.message);
  process.exitCode = 1;
});
