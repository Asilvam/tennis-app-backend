import * as mongoose from 'mongoose';
import axios from 'axios';
import { MembershipDue, MembershipDueSchema } from './entities/membership-due.entity';
import { MembershipPayment, MembershipPaymentSchema } from './entities/membership-payment.entity';
import {
  MembershipBillingConfig,
  MembershipBillingConfigSchema,
} from './entities/membership-billing-config.entity';
import { Register, RegisterSchema } from '../register/entities/register.entity';
import { AuditLog, AuditLogSchema } from '../audit-log/entities/audit-log.entity';
import { MembershipBillingService } from './membership-billing.service';
import { BillingDueAdjustmentService } from './billing-due-adjustment.service';
import { MembershipMpService } from './billing-mp.service';
import { RegisterService } from '../register/register.service';
import { TipoSocio } from '../register/enums/tipo-socio.enum';
import { proposedBillingConfiguration } from './billing.types';

const uri = process.env.BILLING_TEST_MONGO_URI;
(uri ? describe : describe.skip)('Atomic membership type and open-dues repricing', () => {
  let connection: mongoose.Connection,
    members: mongoose.Model<Register>,
    dues: mongoose.Model<MembershipDue>;
  let payments: mongoose.Model<MembershipPayment>,
    configs: mongoose.Model<MembershipBillingConfig>,
    audit: mongoose.Model<AuditLog>;
  let register: RegisterService, core: MembershipBillingService, mp: MembershipMpService;
  let titular: string, member: string, rows: any[];
  const now = new Date('2026-10-17T22:00:00Z');
  const email = 'test2@example.invalid',
    admin = 'admin@example.invalid';
  const change = (extra = {}) =>
    register.updateAdminByEmail(
      email,
      { partnerType: TipoSocio.CARGA, titularId: titular, ...extra },
      admin,
    );
  beforeAll(async () => {
    const target = new URL(uri);
    if (target.hostname !== '127.0.0.1' || !/^\/ctq_billing_test_[\w]+$/.test(target.pathname))
      throw new Error('Isolated localhost database required.');
    target.pathname += '_repricing';
    connection = await mongoose
      .createConnection(target.toString(), { autoIndex: false, autoCreate: false })
      .asPromise();
    if (!(await connection.db.admin().command({ hello: 1 })).setName)
      throw new Error('Replica set required.');
    members = connection.model(Register.name, RegisterSchema);
    dues = connection.model(MembershipDue.name, MembershipDueSchema);
    payments = connection.model(MembershipPayment.name, MembershipPaymentSchema);
    configs = connection.model(MembershipBillingConfig.name, MembershipBillingConfigSchema);
    audit = connection.model(AuditLog.name, AuditLogSchema);
    for (const model of [members, dues, payments, configs, audit] as mongoose.Model<any>[]) {
      await model.createCollection();
      await model.createIndexes();
    }
  });
  beforeEach(async () => {
    for (const model of [members, dues, payments, configs, audit] as mongoose.Model<any>[])
      await model.deleteMany({});
    const first = await members.create({
      namePlayer: 'usuario test 1',
      email: 'test1@example.invalid',
      pwd: 'fixture',
      cellular: '1',
      partnerType: 'Titular',
      statePlayer: true,
      billingStartPeriod: '2026-10',
    });
    const second = await members.create({
      namePlayer: 'usuario test 2',
      email,
      pwd: 'fixture',
      cellular: '2',
      partnerType: 'Titular',
      statePlayer: true,
      billingStartPeriod: '2026-10',
    });
    await members.create({
      namePlayer: 'Admin fixture',
      email: admin,
      pwd: 'fixture',
      cellular: 'admin',
      role: 'admin',
      statePlayer: true,
    });
    [titular, member] = [first, second].map((row) => String(row._id));
    const config = proposedBillingConfiguration();
    config.testPricing = { enabled: true, memberIds: [titular, member], titular: 180, carga: 50 };
    await configs.create(config);
    core = new MembershipBillingService(dues, payments, configs, members, () => now);
    const adjust = new BillingDueAdjustmentService(
      dues,
      payments,
      configs,
      members,
      audit,
      () => now,
    );
    register = new RegisterService(members, {} as any, {} as any, adjust);
    const settings = {
      MP_API_URL: 'http://127.0.0.1:8099/mercadopago',
      INTERNAL_API_KEY: 'fixture',
    };
    mp = new MembershipMpService(
      core,
      { get: (key) => settings[key] } as any,
      payments,
      dues,
      members,
      audit,
      () => now,
    );
    rows = await core.prepareDues(member, member, '2027-01');
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
      await connection.close();
    }
  });
  const attempt = (status: string, creationStatus: string, expiresAt: Date) =>
    payments.create({
      publicReference: 'membership-11111111-1111-4111-8111-111111111111',
      method: 'MERCADO_PAGO',
      status,
      amount: 180,
      currency: 'CLP',
      pricingMode: 'TEST',
      payer: { memberId: member, name: 'usuario test 2' },
      allocations: [{ dueId: rows[0]._id, beneficiaryId: member, period: '2026-10', amount: 180 }],
      checkout: { creationStatus, expiresAt },
    });
  it('changes open current/future TEST dues from $180 to $50 with stable IDs and audit', async () => {
    const result = await change();
    expect(result.partnerType).toBe('Carga');
    const updated = await dues.find().sort({ period: 1 }).lean();
    expect(updated.map((row) => String(row._id))).toEqual(rows.map((row) => String(row._id)));
    expect(updated.map((row) => row.amount)).toEqual([50, 50, 50, 50]);
    expect(updated.every((row) => row.memberTypeSnapshot === 'CARGA')).toBe(true);
    const logs = await audit.find().lean();
    expect(logs).toHaveLength(4);
    expect(logs[0]).toMatchObject({
      entityType: 'MEMBERSHIP_PAYMENT',
      performedBy: 'ADMIN',
      performedByEmail: admin,
      beforeData: { amount: 180, memberTypeSnapshot: 'TITULAR' },
      afterData: { amount: 50, memberTypeSnapshot: 'CARGA' },
    });
  });
  it('also reprices STANDARD dues $18000 to $5000 without changing pricing mode', async () => {
    await dues.deleteMany({});
    await configs.updateOne({}, { $set: { 'testPricing.enabled': false } });
    await core.prepareDues(member, member);
    await change();
    expect(await dues.findOne().lean()).toMatchObject({
      amount: 5000,
      pricingMode: 'STANDARD',
      memberTypeSnapshot: 'CARGA',
    });
  });
  it('reprices the reverse change from carga into titular', async () => {
    await change();
    await register.updateAdminByEmail(
      email,
      { partnerType: TipoSocio.TITULAR, titularId: null },
      admin,
    );
    expect(await dues.countDocuments({ amount: 180, memberTypeSnapshot: 'TITULAR' })).toBe(4);
  });
  it('never rewrites previous months or any paid due, including a future paid month', async () => {
    const old = await dues.create({
      ...rows[0],
      _id: new mongoose.Types.ObjectId(),
      period: '2026-09',
    });
    await dues.updateMany(
      { _id: { $in: [rows[0]._id, rows[1]._id] } },
      { $set: { status: 'PAID', settlementPaymentId: new mongoose.Types.ObjectId(), paidAt: now } },
    );
    await change();
    expect(await dues.findById(old._id).lean()).toMatchObject({
      amount: 180,
      status: 'OPEN',
      memberTypeSnapshot: 'TITULAR',
    });
    expect(
      await dues.countDocuments({ status: 'PAID', amount: 180, memberTypeSnapshot: 'TITULAR' }),
    ).toBe(2);
    expect(await dues.countDocuments({ status: 'OPEN', amount: 50 })).toBe(2);
  });
  it.each([
    ['PENDING', 'READY', -1],
    ['PENDING', 'CREATING', 1],
    ['CANCELLED', 'UNKNOWN', -1],
    ['REVIEW_REQUIRED', 'READY', -1],
    ['REJECTED', 'READY', 1],
    ['CANCELLED', 'READY', 1],
  ])(
    'rejects an active or uncertain checkout (%s/%s) and rolls back the entire edit',
    async (status, creation, future) => {
      await attempt(
        status as string,
        creation as string,
        new Date(now.getTime() + Number(future) * 60000),
      );
      await expect(change({ namePlayer: 'Not saved' })).rejects.toMatchObject({ status: 409 });
      expect(await members.findById(member).lean()).toMatchObject({
        partnerType: 'Titular',
        namePlayer: 'usuario test 2',
      });
      expect((await members.findById(member)).titularId).toBeUndefined();
      expect(await dues.countDocuments({ amount: 180 })).toBe(4);
      expect(await audit.countDocuments()).toBe(0);
    },
  );
  it('allows a safely closed attempt while preserving its historical quoted amount', async () => {
    await attempt('CANCELLED', 'FAILED', new Date(now.getTime() - 60000));
    await change();
    expect((await payments.findOne()).amount).toBe(180);
    expect(await dues.countDocuments({ amount: 50 })).toBe(4);
  });
  it('rolls back membership and all dues if mandatory audit fails', async () => {
    jest.spyOn(audit, 'create').mockRejectedValueOnce(new Error('audit unavailable') as never);
    await expect(change()).rejects.toThrow('audit unavailable');
    expect((await members.findById(member)).partnerType).toBe('Titular');
    expect(await dues.countDocuments({ amount: 180 })).toBe(4);
  });
  it('repairs the already changed type on a repeated admin save and is idempotent afterward', async () => {
    await members.updateOne(
      { _id: member },
      { $set: { partnerType: 'Carga', titularId: titular } },
    );
    await change();
    await change();
    expect(await dues.countDocuments({ amount: 50 })).toBe(4);
    expect(await audit.countDocuments()).toBe(4);
  });
  it('does not silently switch a frozen TEST due into a full STANDARD tariff', async () => {
    await configs.updateOne({}, { $set: { 'testPricing.enabled': false } });
    await expect(change()).rejects.toMatchObject({ status: 409 });
    expect((await members.findById(member)).partnerType).toBe('Titular');
  });
  it('does not generate dues or require financial configuration for a non-enrolled legacy account', async () => {
    await dues.deleteMany({});
    await configs.deleteMany({});
    await change();
    expect(await dues.countDocuments()).toBe(0);
    expect(await audit.countDocuments()).toBe(0);
  });
  it('serializes checkout and type changes without a stale payment amount', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        preferenceId: 'fixture',
        collectorId: '999',
        liveMode: true,
        initPoint: 'https://www.mercadopago.cl/checkout/v1/redirect?pref_id=fixture',
      },
    });
    jest
      .spyOn(axios, 'get')
      .mockResolvedValue({ data: { ready: true, collectorId: '999', currency: 'CLP' } });
    const results = await Promise.allSettled([
      change(),
      mp.checkout(email, [String(rows[0]._id)], 'concurrent-type-checkout'),
    ]);
    expect(results[1].status).toBe('fulfilled');
    const due = await dues.findById(rows[0]._id),
      payment = await payments.findOne(),
      person = await members.findById(member);
    expect(payment.amount).toBe(due.amount);
    expect(due.amount).toBe(person.partnerType === 'Carga' ? 50 : 180);
    if (results[0].status === 'rejected') expect(results[0].reason.status).toBe(409);
  });
});
