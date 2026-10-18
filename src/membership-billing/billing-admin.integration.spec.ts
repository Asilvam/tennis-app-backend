import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import * as mongoose from 'mongoose';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { AuditLog, AuditLogSchema } from '../audit-log/entities/audit-log.entity';
import { AuditLogController } from '../audit-log/audit-log.controller';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Register, RegisterSchema } from '../register/entities/register.entity';
import { MembershipDue, MembershipDueSchema } from './entities/membership-due.entity';
import { MembershipPayment, MembershipPaymentSchema } from './entities/membership-payment.entity';
import {
  MembershipBillingConfig,
  MembershipBillingConfigSchema,
} from './entities/membership-billing-config.entity';
import { MembershipBillingService } from './membership-billing.service';
import { BillingAdminService } from './billing-admin.service';
import { BillingAdminController } from './billing-admin.controller';
import { BillingAdminEnabledGuard } from './billing-admin.guard';
import { BillingNotificationsService } from './billing-notifications.service';
import { proposedBillingConfiguration } from './billing.types';
import { RegisterBankPaymentDto } from './dto/register-bank-payment.dto';

const uri = process.env.BILLING_TEST_MONGO_URI;
(uri ? describe : describe.skip)(
  'Admin bank payments with real HTTP/JWT and isolated MongoDB',
  () => {
    let connection: mongoose.Connection;
    let dues: mongoose.Model<MembershipDue>;
    let payments: mongoose.Model<MembershipPayment>;
    let configs: mongoose.Model<MembershipBillingConfig>;
    let members: mongoose.Model<Register>;
    let audit: mongoose.Model<AuditLog>;
    let core: MembershipBillingService;
    let admin: BillingAdminService;
    let worker: BillingNotificationsService;
    let app: INestApplication;
    let base: string;
    let jwt: JwtService;
    let enabled = true;
    let now: Date;
    let titularId: string;
    let cargaId: string;
    let adminId: string;
    const adminEmail = 'admin@example.invalid';
    const email = { sendEmail: jest.fn() };
    const config = {
      get: (key: string) =>
        key === 'SECRET_KEY'
          ? 'isolated-test-secret-never-production'
          : key === 'MEMBERSHIP_BILLING_ADMIN_ENABLED' && enabled
            ? 'true'
            : undefined,
    };
    const key = (suffix = '') => `isolated-payment-key-${suffix || 'one'}`;
    const token = (address = adminEmail, role = 'admin') => jwt.sign({ email: address, role });
    const call = async (
      path: string,
      body?: unknown,
      authorization = token(),
      idempotencyKey = key(),
    ) => {
      const response = await fetch(`${base}/membership-billing/admin/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${authorization}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    };
    beforeAll(async () => {
      const target = new URL(uri);
      if (
        target.hostname !== '127.0.0.1' ||
        !/^\/ctq_billing_test_[a-zA-Z0-9_]+$/.test(target.pathname)
      )
        throw new Error('Only isolated localhost billing databases are allowed.');
      target.pathname += '_admin';
      connection = await mongoose
        .createConnection(target.toString(), {
          serverSelectionTimeoutMS: 10000,
          autoCreate: false,
          autoIndex: false,
        })
        .asPromise();
      if (!(await connection.db.admin().command({ hello: 1 })).setName)
        throw new Error('Test replica set required.');
      dues = connection.model(MembershipDue.name, MembershipDueSchema);
      payments = connection.model(MembershipPayment.name, MembershipPaymentSchema);
      configs = connection.model(MembershipBillingConfig.name, MembershipBillingConfigSchema);
      members = connection.model(Register.name, RegisterSchema);
      audit = connection.model(AuditLog.name, AuditLogSchema);
      for (const model of [dues, payments, configs, members, audit] as mongoose.Model<any>[]) {
        await model.createCollection();
        await model.createIndexes();
      }
      core = new MembershipBillingService(dues, payments, configs, members, () => now);
      admin = new BillingAdminService(core, dues, payments, configs, members, audit, () => now);
      worker = new BillingNotificationsService(payments, email as any, config as any, () => now);
      const module = await Test.createTestingModule({
        imports: [
          PassportModule.register({ defaultStrategy: 'jwt' }),
          JwtModule.register({ secret: config.get('SECRET_KEY') }),
        ],
        controllers: [BillingAdminController, AuditLogController],
        providers: [
          JwtStrategy,
          BillingAdminEnabledGuard,
          { provide: ConfigService, useValue: config },
          { provide: BillingAdminService, useValue: admin },
          { provide: AuditLogService, useValue: new AuditLogService(audit) },
        ],
      }).compile();
      jwt = module.get(JwtService);
      app = module.createNestApplication();
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
    });
    beforeEach(async () => {
      enabled = true;
      now = new Date('2026-10-17T15:00:00Z');
      email.sendEmail.mockReset().mockResolvedValue(undefined);
      for (const model of [dues, payments, configs, members, audit] as mongoose.Model<any>[])
        await model.deleteMany({});
      const titular = await members.create({
        namePlayer: 'usuario test 1',
        email: 'test1@example.invalid',
        cellular: 'fixture-1',
        pwd: 'not-a-password',
        statePlayer: true,
        partnerType: 'Titular',
        billingStartPeriod: '2026-10',
      });
      const carga = await members.create({
        namePlayer: 'usuario test 2',
        email: 'test2@example.invalid',
        cellular: 'fixture-2',
        pwd: 'not-a-password',
        statePlayer: true,
        partnerType: 'Carga',
        titularId: titular._id,
        billingStartPeriod: '2026-10',
      });
      const actor = await members.create({
        namePlayer: 'Administrador de prueba',
        email: adminEmail,
        cellular: 'fixture-admin',
        pwd: 'not-a-password',
        statePlayer: true,
        role: 'admin',
      });
      [titularId, cargaId, adminId] = [titular, carga, actor].map((row) => String(row._id));
      const settings = proposedBillingConfiguration();
      settings.testPricing = {
        ...settings.testPricing,
        enabled: true,
        memberIds: [titularId, cargaId],
      };
      await configs.create(settings);
    });
    afterAll(async () => {
      if (app) await app.close();
      if (connection) {
        await connection.dropDatabase();
        await connection.close();
      }
    });
    const draft = async (changes: Partial<RegisterBankPaymentDto> = {}) => {
      const own = await core.prepareDues(adminId, titularId);
      const carga = await core.prepareDues(adminId, cargaId);
      return {
        dueIds: [String(own[0]._id), String(carga[0]._id)],
        method: 'BANK_TRANSFER' as const,
        amount: 230,
        payerName: 'usuario test 1',
        payerMemberId: titularId,
        receivedDate: '2026-10-16',
        reference: 'BANK-FIXTURE-123',
        verified: true,
        ...changes,
      };
    };

    it('reads a member detail without generating dues, modifying the member or creating audit events', async () => {
      const before = await members.findById(titularId).lean();
      const response = await call(`members/${titularId}`);
      expect(response.status).toBe(200);
      expect(response.body.memberId).toBe(titularId);
      expect(response.body.members.map((row) => row.id)).toEqual([titularId, cargaId]);
      expect(response.body.members[0]).toMatchObject({
        name: 'usuario test 1',
        memberType: 'Titular',
        active: true,
      });
      expect(response.body.members[0]).not.toHaveProperty('pwd');
      expect(response.body.dues).toEqual([]);
      expect(await dues.countDocuments()).toBe(0);
      expect(await audit.countDocuments()).toBe(0);
      expect(await members.findById(titularId).lean()).toEqual(before);
    });
    it('allows reading inactive/unenrolled members without enrolling or activating them', async () => {
      await members.updateOne(
        { _id: cargaId },
        { $set: { statePlayer: false }, $unset: { billingStartPeriod: '' } },
      );
      const response = await call(`members/${cargaId}`);
      expect(response.status).toBe(200);
      expect(response.body.members).toHaveLength(1);
      expect(response.body.members[0]).toMatchObject({
        id: cargaId,
        active: false,
        enrolled: false,
      });
      expect(await dues.countDocuments()).toBe(0);
    });
    it('validates member detail IDs and active admin authorization', async () => {
      expect((await call('members/not-an-id')).status).toBe(400);
      expect((await call(`members/${new mongoose.Types.ObjectId()}`)).status).toBe(404);
      expect(
        (await call(`members/${titularId}`, undefined, token('test1@example.invalid', 'user')))
          .status,
      ).toBe(403);
      await members.updateOne({ _id: adminId }, { $set: { statePlayer: false } });
      expect((await call(`members/${titularId}`)).status).toBe(403);
    });
    it('filters history by beneficiary rather than by the person who paid', async () => {
      const body = await draft();
      await call('payments', { ...body, dueIds: [body.dueIds[1]], amount: 50 });
      const own = await call(`payments?beneficiaryId=${titularId}`);
      const carga = await call(`payments?beneficiaryId=${cargaId}`);
      expect(own.body.total).toBe(0);
      expect(carga.body.total).toBe(1);
      expect(carga.body.items[0].payer.memberId).toBe(titularId);
    });
    it('matches period and beneficiary within the same allocation in a family payment', async () => {
      await payments.create({
        publicReference: 'isolated-cross-allocation-fixture',
        payer: { memberId: titularId, name: 'usuario test 1' },
        method: 'BANK_TRANSFER',
        status: 'PENDING',
        amount: 230,
        currency: 'CLP',
        pricingMode: 'TEST',
        allocations: [
          {
            dueId: new mongoose.Types.ObjectId(),
            beneficiaryId: titularId,
            period: '2026-11',
            amount: 180,
          },
          {
            dueId: new mongoose.Types.ObjectId(),
            beneficiaryId: cargaId,
            period: '2026-10',
            amount: 50,
          },
        ],
      });
      expect((await call(`payments?beneficiaryId=${titularId}&period=2026-10`)).body.total).toBe(0);
      expect((await call(`payments?beneficiaryId=${titularId}&period=2026-11`)).body.total).toBe(1);
      expect((await call(`payments?beneficiaryId=${cargaId}&period=2026-10`)).body.total).toBe(1);
    });
    it('records transfer, allocations and responsible admin atomically through authenticated HTTP', async () => {
      const response = await call('payments', await draft());
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ status: 'CONFIRMED', duplicate: false });
      expect(await dues.countDocuments({ status: 'PAID' })).toBe(2);
      const payment = await payments.findById(response.body.id).lean();
      expect(String(payment.registeredBy)).toBe(adminId);
      expect(String(payment.payer.memberId)).toBe(titularId);
      expect(payment.amount).toBe(230);
      expect(payment.notifications[0].status).toBe('PENDING');
      expect((await audit.findOne({ entityId: response.body.id })).performedByEmail).toBe(
        adminEmail,
      );
      const history = await call('payments?period=2026-10&method=BANK_TRANSFER');
      expect(history.body.items[0]).toMatchObject({
        method: 'BANK_TRANSFER',
        registeredBy: 'Administrador de prueba',
        bank: { reference: 'BANK-FIXTURE-123' },
      });
      expect(history.body.items[0].allocations.map((row) => row.name)).toEqual([
        'usuario test 1',
        'usuario test 2',
      ]);
      expect((await members.findById(titularId)).updatePayment).toBe(true);
    });
    it('requires actual active admin role, not only a signed role claim', async () => {
      expect((await call('members', undefined, 'invalid')).status).toBe(401);
      expect(
        (await call('members', undefined, token('test1@example.invalid', 'user'))).status,
      ).toBe(403);
      expect(
        (await call('members', undefined, token('test1@example.invalid', 'admin'))).status,
      ).toBe(403);
      await members.updateOne({ _id: adminId }, { $set: { statePlayer: false } });
      expect((await call('members')).status).toBe(403);
    });
    it('leaves endpoints disabled by default without creating configuration or obligations', async () => {
      enabled = false;
      await configs.deleteMany({});
      expect((await call('members')).status).toBe(503);
      expect(await dues.countDocuments()).toBe(0);
      expect(await configs.countDocuments()).toBe(0);
    });
    it('rejects spoofed actor, partial/excess amounts, unverified deposits, future and invalid dates', async () => {
      const body = await draft();
      for (const change of [
        { actorId: adminId },
        { amount: 229 },
        { amount: 231 },
        { verified: false },
        { receivedDate: '2026-10-18' },
        { receivedDate: '2026-02-30' },
        { reference: '  ' },
        { method: 'MERCADO_PAGO' },
      ])
        expect((await call('payments', { ...body, ...change })).status).toBe(400);
      expect(await payments.countDocuments()).toBe(0);
      expect(await dues.countDocuments({ status: 'PAID' })).toBe(0);
    });
    it('deduplicates the same confirmed request and rejects a changed body on the same key', async () => {
      const body = await draft();
      const first = await admin.registerBankPayment(adminEmail, body, key());
      expect(await admin.registerBankPayment(adminEmail, body, key())).toMatchObject({
        id: first.id,
        duplicate: true,
      });
      await expect(
        admin.registerBankPayment(adminEmail, { ...body, reference: 'other' }, key()),
      ).rejects.toMatchObject({ status: 409 });
      expect(await payments.countDocuments()).toBe(1);
      expect(await audit.countDocuments()).toBe(1);
    });
    it('handles concurrent same-key submissions without a duplicate payment', async () => {
      const body = await draft();
      const results = await Promise.all([
        admin.registerBankPayment(adminEmail, body, key()),
        admin.registerBankPayment(adminEmail, body, key()),
      ]);
      expect(new Set(results.map((result) => result.id)).size).toBe(1);
      expect(await payments.countDocuments()).toBe(1);
    });
    it('allows only one of two distinct registrations to settle the same dues', async () => {
      const body = await draft();
      const results = await Promise.allSettled([
        admin.registerBankPayment(adminEmail, body, key('one')),
        admin.registerBankPayment(adminEmail, body, key('two')),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(await payments.countDocuments()).toBe(1);
      expect(await dues.countDocuments({ status: 'PAID' })).toBe(2);
    });
    it('rolls back payment, all dues and member locks when mandatory audit fails', async () => {
      const body = await draft();
      const before = (await members.findById(adminId)).__v;
      const spy = jest
        .spyOn(audit, 'create')
        .mockRejectedValueOnce(new Error('isolated audit failure') as never);
      try {
        await expect(admin.registerBankPayment(adminEmail, body, key())).rejects.toThrow(
          'isolated audit failure',
        );
      } finally {
        spy.mockRestore();
      }
      expect(await payments.countDocuments()).toBe(0);
      expect(await dues.countDocuments({ status: 'PAID' })).toBe(0);
      expect((await members.findById(adminId)).__v).toBe(before);
    });
    it('records a bank deposit with an external payer without inventing a user or sending an email', async () => {
      const body = await draft({
        method: 'BANK_DEPOSIT',
        payerMemberId: undefined,
        payerName: 'Persona externa',
      });
      const result = await admin.registerBankPayment(adminEmail, body, key());
      const payment = await payments.findById(result.id);
      expect(payment.method).toBe('BANK_DEPOSIT');
      expect(payment.payer.memberId).toBeUndefined();
      expect(payment.notifications).toHaveLength(0);
      expect(await members.countDocuments()).toBe(3);
    });
    it('keeps a confirmed payment if email delivery fails, then retries without another charge', async () => {
      const result = await admin.registerBankPayment(adminEmail, await draft(), key());
      email.sendEmail.mockRejectedValueOnce(new Error('simulated SMTP failure'));
      await worker.drain();
      let payment = await payments.findById(result.id);
      expect(payment.status).toBe('CONFIRMED');
      expect(payment.notifications[0]).toMatchObject({ status: 'FAILED', attempts: 1 });
      now = new Date(now.getTime() + 120000);
      await worker.drain();
      payment = await payments.findById(result.id);
      expect(payment.notifications[0]).toMatchObject({ status: 'SENT', attempts: 2 });
      await worker.drain();
      expect(email.sendEmail).toHaveBeenCalledTimes(2);
      expect(await payments.countDocuments()).toBe(1);
      expect(email.sendEmail.mock.calls[0][1]).toBe(email.sendEmail.mock.calls[1][1]);
    });
    it('leases notifications across two workers without sending twice', async () => {
      await admin.registerBankPayment(adminEmail, await draft(), key());
      const second = new BillingNotificationsService(
        payments,
        email as any,
        config as any,
        () => now,
      );
      await Promise.all([worker.drain(), second.drain()]);
      expect(email.sendEmail).toHaveBeenCalledTimes(1);
    });
    it('reverses a bank entry without deleting evidence or refunding money', async () => {
      const result = await admin.registerBankPayment(adminEmail, await draft(), key());
      const response = await call(
        `payments/${result.id}/reversal`,
        { reason: 'Correccion de fixture' },
        token(),
        key('reverse'),
      );
      expect(response.status).toBe(201);
      expect(response.body.status).toBe('REVERSED');
      expect(await dues.countDocuments({ status: 'OPEN' })).toBe(2);
      expect(await payments.countDocuments()).toBe(1);
      expect(await audit.countDocuments()).toBe(2);
      expect((await payments.findById(result.id)).notifications[0].status).toBe('CANCELLED');
      await worker.drain();
      expect(email.sendEmail.mock.calls[0][0].subject).toContain('anulado');
      expect(
        (
          await admin.reverseBankPayment(
            adminEmail,
            result.id,
            'Correccion de fixture',
            key('reverse'),
          )
        ).duplicate,
      ).toBe(true);
    });
    it('rolls back reversal if one allocation no longer points at the original payment', async () => {
      const result = await admin.registerBankPayment(adminEmail, await draft(), key());
      const rows = await dues.find({ status: 'PAID' });
      await dues.updateOne(
        { _id: rows[1]._id },
        { $set: { settlementPaymentId: new mongoose.Types.ObjectId() } },
      );
      await expect(
        admin.reverseBankPayment(adminEmail, result.id, 'Correccion de fixture', key('reverse')),
      ).rejects.toMatchObject({ status: 409 });
      expect(await dues.countDocuments({ status: 'PAID' })).toBe(2);
      expect((await payments.findById(result.id)).status).toBe('CONFIRMED');
    });
    it('fails closed if the unique payment index is missing', async () => {
      const body = await draft();
      await payments.collection.dropIndex('publicReference_1');
      try {
        await expect(admin.registerBankPayment(adminEmail, body, key())).rejects.toMatchObject({
          status: 503,
        });
      } finally {
        await payments.createIndexes();
      }
      expect(await payments.countDocuments()).toBe(0);
    });
    it('requires an audited review for a second income matching bank reference/date/amount', async () => {
      const original = await admin.registerBankPayment(adminEmail, await draft(), key());
      const data = await admin.memberDues(adminEmail, titularId, '2026-11');
      const body = await draft({
        dueIds: data.dues.filter((row) => row.period === '2026-11').map((row) => row.id),
      });
      await expect(
        admin.registerBankPayment(adminEmail, body, key('matching')),
      ).rejects.toMatchObject({ response: { code: 'BANK_REFERENCE_REVIEW' } });
      expect(await payments.countDocuments()).toBe(1);
      const second = await admin.registerBankPayment(
        adminEmail,
        { ...body, matchingReferenceVerified: true },
        key('matching-reviewed'),
      );
      expect(
        (await audit.findOne({ entityId: second.id })).afterData.matchingReferencePaymentId,
      ).toBe(original.id);
      expect(await payments.countDocuments()).toBe(2);
    });
    it('ends an exhausted notification lease after a simulated worker crash', async () => {
      const result = await admin.registerBankPayment(adminEmail, await draft(), key());
      await payments.updateOne(
        { _id: result.id },
        {
          $set: {
            'notifications.0.status': 'PROCESSING',
            'notifications.0.attempts': 6,
            'notifications.0.lockedAt': new Date(now.getTime() - 360000),
          },
        },
      );
      await worker.drain();
      expect((await payments.findById(result.id)).notifications[0].status).toBe('FAILED');
      expect(email.sendEmail).not.toHaveBeenCalled();
    });
    it('rolls back a reversal if its mandatory audit fails', async () => {
      const result = await admin.registerBankPayment(adminEmail, await draft(), key());
      const spy = jest
        .spyOn(audit, 'create')
        .mockRejectedValueOnce(new Error('isolated reversal audit failure') as never);
      try {
        await expect(
          admin.reverseBankPayment(adminEmail, result.id, 'Correccion de fixture', key('reverse')),
        ).rejects.toThrow('isolated reversal audit failure');
      } finally {
        spy.mockRestore();
      }
      expect((await payments.findById(result.id)).status).toBe('CONFIRMED');
      expect(await dues.countDocuments({ status: 'PAID' })).toBe(2);
      expect(await audit.countDocuments()).toBe(1);
    });
    it('does not expose financial audit events through the legacy user-accessible audit routes', async () => {
      const result = await admin.registerBankPayment(adminEmail, await draft(), key());
      const paths = [
        `reserve/${result.id}`,
        'date-range?start=2026-10-01&end=2026-11-01',
        'action/ADMIN_CREATE',
        `user/${encodeURIComponent('Administrador de prueba')}`,
        'report/creations?start=2026-10-01&end=2026-11-01',
      ];
      for (const path of paths) {
        const response = await fetch(`${base}/audit-logs/${path}`, {
          headers: { Authorization: `Bearer ${token('test1@example.invalid', 'user')}` },
        });
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(Array.isArray(data) ? data : data.logs).toEqual([]);
      }
    });
    it('retains authenticated admin payment of current plus three future months', async () => {
      const data = await admin.memberDues(adminEmail, titularId, '2027-01');
      const body = await draft({ dueIds: data.dues.map((row) => row.id), amount: 920 });
      const result = await call('payments', body);
      expect(result.status).toBe(201);
      expect(result.body.status).toBe('CONFIRMED');
      expect(await dues.countDocuments({ status: 'PAID' })).toBe(8);
      const payment = await payments.findById(result.body.id);
      expect(payment.amount).toBe(920);
      expect([...new Set(payment.allocations.map((row) => row.period))]).toEqual([
        '2026-10',
        '2026-11',
        '2026-12',
        '2027-01',
      ]);
      await expect(admin.memberDues(adminEmail, titularId, '2027-02')).rejects.toMatchObject({
        status: 400,
      });
    });
    it('searches literal names safely and validates query pagination', async () => {
      expect((await call('members?search=usuario%20test')).body.total).toBe(2);
      expect((await call('members?search=.*')).body.total).toBe(0);
      expect((await call('payments?page=0')).status).toBe(400);
      expect((await call('payments?unknown=true')).status).toBe(400);
      const response = await call(`members/${titularId}/dues`, { throughPeriod: '2027-01' });
      expect(response.body.dues).toHaveLength(8);
      expect(response.body.members).toHaveLength(2);
    });
  },
);
