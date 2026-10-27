import * as mongoose from 'mongoose';
import { MembershipDue, MembershipDueSchema } from './entities/membership-due.entity';
import { MembershipPayment, MembershipPaymentSchema } from './entities/membership-payment.entity';
import {
  MembershipBillingConfig,
  MembershipBillingConfigSchema,
} from './entities/membership-billing-config.entity';
import { Register, RegisterSchema } from '../register/entities/register.entity';
import { AuditLog, AuditLogSchema } from '../audit-log/entities/audit-log.entity';
import { MembershipBillingService } from './membership-billing.service';
import { proposedBillingConfiguration } from './billing.types';

const uri = process.env.BILLING_TEST_MONGO_URI;
(uri ? describe : describe.skip)(
  'Membership billing with an isolated local MongoDB replica set',
  () => {
    let connection: mongoose.Connection;
    let dues: mongoose.Model<MembershipDue>;
    let payments: mongoose.Model<MembershipPayment>;
    let configs: mongoose.Model<MembershipBillingConfig>;
    let members: mongoose.Model<Register>;
    let audit: mongoose.Model<AuditLog>;
    let service: MembershipBillingService;
    let titularId: string;
    let cargaId: string;
    let otherId: string;
    let now: Date;

    beforeAll(async () => {
      const target = new URL(uri);
      if (
        target.hostname !== '127.0.0.1' ||
        !/^\/ctq_billing_test_[a-zA-Z0-9_]+$/.test(target.pathname)
      )
        throw new Error('Only an isolated localhost billing test database is allowed.');
      connection = await mongoose
        .createConnection(uri, {
          serverSelectionTimeoutMS: 10000,
          autoCreate: false,
          autoIndex: false,
        })
        .asPromise();
      const hello = await connection.db.admin().command({ hello: 1 });
      if (!hello.setName) throw new Error('A test replica set is required.');
      dues = connection.model(MembershipDue.name, MembershipDueSchema);
      payments = connection.model(MembershipPayment.name, MembershipPaymentSchema);
      configs = connection.model(MembershipBillingConfig.name, MembershipBillingConfigSchema);
      members = connection.model(Register.name, RegisterSchema);
      audit = connection.model(AuditLog.name, AuditLogSchema);
      for (const model of [dues, payments, configs, members, audit] as mongoose.Model<any>[]) {
        await model.createCollection();
        await model.createIndexes();
      }
      service = new MembershipBillingService(dues, payments, configs, members, () => now, audit);
    });
    beforeEach(async () => {
      for (const model of [dues, payments, configs, members, audit] as mongoose.Model<any>[])
        await model.deleteMany({});
      now = new Date('2026-10-17T15:00:00Z');
      const titular = await members.create({
        namePlayer: 'usuario test 1',
        email: 'test1@example.invalid',
        cellular: 'fixture-1',
        pwd: 'not-a-real-password',
        statePlayer: true,
        partnerType: 'Titular',
        billingStartPeriod: '2026-10',
      });
      const carga = await members.create({
        namePlayer: 'usuario test 2',
        email: 'test2@example.invalid',
        cellular: 'fixture-2',
        pwd: 'not-a-real-password',
        statePlayer: true,
        partnerType: 'Carga',
        titularId: titular._id,
        billingStartPeriod: '2026-10',
      });
      const other = await members.create({
        namePlayer: 'Isolated unrelated fixture',
        email: 'other@example.invalid',
        cellular: 'fixture-3',
        pwd: 'not-a-real-password',
        statePlayer: true,
        billingStartPeriod: '2026-10',
      });
      [titularId, cargaId, otherId] = [titular, carga, other].map((row) => String(row._id));
      const config = proposedBillingConfiguration();
      config.testPricing = {
        enabled: true,
        memberIds: [titularId, cargaId],
        titular: 180,
        carga: 50,
      };
      await configs.create(config);
    });
    afterAll(async () => {
      if (connection) {
        await connection.dropDatabase();
        await connection.close();
      }
    });

    it('creates only October, no baseline payments, and quotes 180+50 for the two authorized IDs', async () => {
      const own = await service.prepareDues(titularId, titularId);
      const carga = await service.prepareDues(titularId, cargaId);
      expect(own.map((row) => row.period)).toEqual(['2026-10']);
      expect(own[0].amount).toBe(180);
      expect(carga[0].amount).toBe(50);
      expect(
        await service.quote(
          titularId,
          [own[0], carga[0]].map((row) => String(row._id)),
        ),
      ).toMatchObject({ amount: 230, pricingMode: 'TEST', currency: 'CLP' });
      expect(await payments.countDocuments()).toBe(0);
    });
    it('deduplicates concurrent generation with real transactions and a unique index', async () => {
      await Promise.all([
        service.prepareDues(titularId, titularId),
        service.prepareDues(titularId, titularId),
      ]);
      expect(await dues.countDocuments({ beneficiaryId: titularId })).toBe(1);
      const existing = await dues.findOne({ beneficiaryId: titularId }).lean();
      await expect(
        dues.create({ ...existing, _id: new mongoose.Types.ObjectId() }),
      ).rejects.toMatchObject({ code: 11000 });
    });
    it('allows admins current+3 only, and rejects paying a later month without earlier ones', async () => {
      await members.updateOne({ _id: titularId }, { $set: { role: 'admin' } });
      const rows = await service.prepareDues(titularId, titularId, '2027-01');
      expect(rows.map((row) => row.period)).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
      await expect(service.prepareDues(titularId, titularId, '2027-02')).rejects.toMatchObject({
        status: 400,
      });
      await expect(service.quote(titularId, [String(rows[3]._id)])).rejects.toMatchObject({
        status: 409,
      });
      expect(
        await service.quote(
          titularId,
          rows.map((row) => String(row._id)),
        ),
      ).toMatchObject({ amount: 720 });
    });
    it('rejects member advance generation and quotes even when an admin prepared the dues', async () => {
      await expect(service.prepareDues(titularId, titularId, '2026-11')).rejects.toMatchObject({
        status: 400,
      });
      await expect(service.prepareDues(titularId, cargaId, '2026-11')).rejects.toMatchObject({
        status: 400,
      });
      expect(await dues.countDocuments()).toBe(0);
      await members.updateOne({ _id: titularId }, { $set: { role: 'admin' } });
      const rows = await service.prepareDues(titularId, titularId, '2027-01');
      await members.updateOne({ _id: titularId }, { $set: { role: 'user' } });
      await expect(
        service.quote(
          titularId,
          rows.map((row) => String(row._id)),
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(await service.quote(titularId, [String(rows[0]._id)])).toMatchObject({
        amount: 180,
      });
      expect(await dues.countDocuments()).toBe(4);
    });
    it('lets members pay all arrears and current month without allowing future dues', async () => {
      now = new Date('2026-12-06T15:00:00Z');
      const rows = await service.prepareDues(titularId, titularId);
      expect(rows.map((row) => row.period)).toEqual(['2026-10', '2026-11', '2026-12']);
      expect(
        await service.quote(
          titularId,
          rows.map((row) => String(row._id)),
        ),
      ).toMatchObject({ amount: 540 });
      await expect(service.quote(titularId, [String(rows[2]._id)])).rejects.toMatchObject({
        status: 409,
      });
    });
    it('does not grant access just because current obligations have not been generated', async () => {
      await configs.updateOne(
        {},
        { $set: { autoBlockEnabled: true, 'activation.migrationReviewed': true } },
      );
      now = new Date('2026-11-06T03:00:00Z');
      expect(await service.assessFinancialAccess(titularId)).toMatchObject({
        financiallyRestricted: true,
        overduePeriods: ['2026-10'],
      });
      expect(await dues.countDocuments({ beneficiaryId: titularId })).toBe(2);
    });
    it('preserves rate snapshots when configured rates change', async () => {
      const before = await service.prepareDues(titularId, titularId);
      await configs.updateOne({}, { $set: { 'testPricing.titular': 181 } });
      now = new Date('2026-11-01T15:00:00Z');
      const after = await service.prepareDues(titularId, titularId, '2026-11');
      expect(after[0].amount).toBe(before[0].amount);
      expect(after[1].amount).toBe(181);
    });
    it('does not manufacture an initial billing period for an unenrolled member', async () => {
      await members.updateOne({ _id: titularId }, { $unset: { billingStartPeriod: 1 } });
      await expect(service.prepareDues(titularId, titularId)).rejects.toMatchObject({
        status: 409,
      });
      expect(await dues.countDocuments()).toBe(0);
    });
    it('uses real rates for other isolated fixtures and rejects mixing with test dues', async () => {
      await members.updateOne({ _id: titularId }, { $set: { role: 'admin' } });
      const standard = await service.prepareDues(titularId, otherId);
      const test = await service.prepareDues(titularId, titularId);
      expect(standard[0].amount).toBe(18000);
      await expect(
        service.quote(titularId, [String(standard[0]._id), String(test[0]._id)]),
      ).rejects.toMatchObject({ status: 400 });
    });
    it('rejects foreign beneficiaries, inactive actors and carga paying for titular', async () => {
      await expect(service.prepareDues(titularId, otherId)).rejects.toMatchObject({ status: 403 });
      await expect(service.prepareDues(cargaId, titularId)).rejects.toMatchObject({ status: 403 });
      await members.updateOne({ _id: titularId }, { $set: { statePlayer: false } });
      await expect(service.prepareDues(titularId, titularId)).rejects.toMatchObject({
        status: 403,
      });
    });
    it('rolls back every generated due when a later write fails', async () => {
      await members.updateOne({ _id: titularId }, { $set: { role: 'admin' } });
      const before = (await members.findById(titularId)).__v;
      const original = dues.updateOne.bind(dues);
      let writes = 0;
      const spy = jest.spyOn(dues, 'updateOne').mockImplementation(((...args: any[]) => {
        if (++writes === 2) throw new Error('isolated quota failure');
        return original(...(args as [any, any, any]));
      }) as any);
      try {
        await expect(service.prepareDues(titularId, titularId, '2026-11')).rejects.toThrow(
          'isolated quota failure',
        );
      } finally {
        spy.mockRestore();
      }
      expect(await dues.countDocuments()).toBe(0);
      expect((await members.findById(titularId)).__v).toBe(before);
    });
    it('deduplicates provider transactions but allows multiple pending checkouts without provider IDs', async () => {
      const rows = await service.prepareDues(titularId, titularId);
      const base = {
        payer: { memberId: titularId, name: 'usuario test 1' },
        method: 'MERCADO_PAGO',
        amount: 180,
        currency: 'CLP',
        pricingMode: 'TEST',
        allocations: [
          { dueId: rows[0]._id, beneficiaryId: titularId, period: '2026-10', amount: 180 },
        ],
      };
      await payments.create({ ...base, publicReference: 'pending-one' });
      await payments.create({ ...base, publicReference: 'pending-two' });
      await payments.create({
        ...base,
        publicReference: 'provider-one',
        provider: { name: 'MERCADO_PAGO', paymentId: '123' },
      });
      await expect(
        payments.create({
          ...base,
          publicReference: 'provider-duplicate',
          provider: { name: 'MERCADO_PAGO', paymentId: '123' },
        }),
      ).rejects.toMatchObject({ code: 11000 });
    });
    it('shows only a carga allocation while the payer sees the full grouped transaction', async () => {
      const own = await service.prepareDues(titularId, titularId);
      const carga = await service.prepareDues(titularId, cargaId);
      await payments.create({
        publicReference: 'grouped',
        payer: { memberId: titularId, name: 'usuario test 1', email: 'private@example.invalid' },
        method: 'BANK_TRANSFER',
        amount: 230,
        currency: 'CLP',
        pricingMode: 'TEST',
        allocations: [
          { dueId: own[0]._id, beneficiaryId: titularId, period: '2026-10', amount: 180 },
          { dueId: carga[0]._id, beneficiaryId: cargaId, period: '2026-10', amount: 50 },
        ],
      });
      const ownHistory = await service.paymentHistory(titularId);
      const cargaHistory = await service.paymentHistory(cargaId);
      expect(ownHistory.items[0]).toMatchObject({ amount: 230, allocations: expect.any(Array) });
      expect(ownHistory.items[0].allocations).toHaveLength(2);
      expect(cargaHistory.items[0]).toMatchObject({
        amount: 50,
        payer: { name: 'usuario test 1' },
      });
      expect(cargaHistory.items[0].allocations).toHaveLength(1);
      expect(cargaHistory.items[0].payer).not.toHaveProperty('email');
      await expect(service.paymentHistory(otherId, cargaId)).rejects.toMatchObject({ status: 403 });
    });
    it('rejects missing config, invalid selection and unbounded history pagination', async () => {
      await expect(service.quote(titularId, [])).rejects.toMatchObject({ status: 400 });
      await expect(service.paymentHistory(titularId, titularId, 1, 101)).rejects.toMatchObject({
        status: 400,
      });
      await configs.deleteMany({});
      await expect(service.prepareDues(titularId, titularId)).rejects.toMatchObject({
        status: 503,
      });
      expect(await dues.countDocuments()).toBe(0);
    });
    it('does not reveal former payer transactions to a new titular if they cover unrelated beneficiaries', async () => {
      const own = await service.prepareDues(cargaId, cargaId);
      await payments.create({
        publicReference: 'former-payer',
        payer: { memberId: cargaId, name: 'usuario test 2' },
        method: 'BANK_TRANSFER',
        amount: 50,
        currency: 'CLP',
        pricingMode: 'TEST',
        allocations: [{ dueId: own[0]._id, beneficiaryId: otherId, period: '2026-10', amount: 50 }],
      });
      expect((await service.paymentHistory(cargaId)).total).toBe(1);
      expect((await service.paymentHistory(titularId, cargaId)).total).toBe(0);
    });
    it('does not remove manual inactivity or financial history when blocking is disabled', async () => {
      await service.prepareDues(titularId, titularId);
      now = new Date('2026-11-10T12:00:00Z');
      expect(await service.assessFinancialAccess(titularId)).toMatchObject({
        hasOverdueDues: true,
        financiallyRestricted: false,
      });
      await members.updateOne({ _id: titularId }, { $set: { statePlayer: false } });
      expect(await service.assessFinancialAccess(titularId)).toMatchObject({
        accountActive: false,
        financiallyRestricted: false,
      });
    });
    it('exempts an administrator without generating or changing account status', async () => {
      await members.updateOne({ _id: titularId }, { $set: { role: 'admin' } });
      await configs.updateOne(
        {},
        { $set: { autoBlockEnabled: true, 'activation.migrationReviewed': true } },
      );
      now = new Date('2026-11-10T12:00:00Z');
      expect(await service.assessFinancialAccess(titularId)).toMatchObject({
        exempt: true,
        financiallyRestricted: false,
      });
      expect(await dues.countDocuments()).toBe(0);
    });
    it('refuses an obsolete test authorization and never infers permission from the name', async () => {
      const rows = await service.prepareDues(titularId, titularId);
      await configs.updateOne({}, { $set: { 'testPricing.enabled': false } });
      await expect(service.quote(titularId, [String(rows[0]._id)])).rejects.toMatchObject({
        status: 409,
      });
    });
    it('deduplicates idempotency keys per actor, but not across unrelated actors', async () => {
      const rows = await service.prepareDues(titularId, titularId);
      const base = {
        payer: { memberId: titularId },
        method: 'MERCADO_PAGO',
        amount: 180,
        currency: 'CLP',
        pricingMode: 'TEST',
        allocations: [
          { dueId: rows[0]._id, beneficiaryId: titularId, period: '2026-10', amount: 180 },
        ],
      };
      await payments.create({
        ...base,
        publicReference: 'idem-one',
        idempotency: { actorId: titularId, key: 'same-key', hash: 'same-content' },
      });
      await expect(
        payments.create({
          ...base,
          publicReference: 'idem-two',
          idempotency: { actorId: titularId, key: 'same-key', hash: 'other-content' },
        }),
      ).rejects.toMatchObject({ code: 11000 });
      await payments.create({
        ...base,
        publicReference: 'idem-three',
        idempotency: { actorId: cargaId, key: 'same-key', hash: 'same-content' },
      });
    });
    it('preserves a settled October and permits an unexpired November without changing manual flags', async () => {
      const rows = await service.prepareDues(titularId, titularId);
      const paidAt = new Date('2026-11-03T15:00:00Z');
      const record = await payments.create({
        publicReference: 'confirmed-fixture',
        payer: { memberId: titularId },
        registeredBy: titularId,
        bank: { reference: 'isolated-bank-ref', receivedAt: paidAt },
        paidAt,
        confirmedAt: paidAt,
        status: 'CONFIRMED',
        method: 'BANK_TRANSFER',
        amount: 180,
        currency: 'CLP',
        pricingMode: 'TEST',
        allocations: [
          { dueId: rows[0]._id, beneficiaryId: titularId, period: '2026-10', amount: 180 },
        ],
      });
      const settled = await dues.findById(rows[0]._id);
      settled.status = 'PAID';
      settled.settlementPaymentId = record._id;
      settled.paidAt = paidAt;
      await settled.save();
      await configs.updateOne(
        {},
        { $set: { autoBlockEnabled: true, 'activation.migrationReviewed': true } },
      );
      now = new Date('2026-11-10T12:00:00Z');
      expect(await service.assessFinancialAccess(titularId)).toMatchObject({
        financiallyRestricted: false,
        hasOverdueDues: false,
      });
      expect((await dues.findById(settled._id)).status).toBe('PAID');
      expect((await service.paymentHistory(titularId.toUpperCase())).items[0]).toMatchObject({
        amount: 180,
        method: 'BANK_TRANSFER',
        status: 'CONFIRMED',
      });
      expect((await members.findById(titularId)).statePlayer).toBe(true);
    });
  },
);
