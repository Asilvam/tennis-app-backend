import * as mongoose from 'mongoose';
import axios from 'axios';
import { MembershipMpService, MembershipProviderSnapshot } from './billing-mp.service';
import { MembershipBillingService } from './membership-billing.service';
import { BillingPortalService } from './billing-portal.service';
import { BillingAdminService } from './billing-admin.service';
import { MembershipDue, MembershipDueSchema } from './entities/membership-due.entity';
import { MembershipPayment, MembershipPaymentSchema } from './entities/membership-payment.entity';
import {
  MembershipBillingConfig,
  MembershipBillingConfigSchema,
} from './entities/membership-billing-config.entity';
import { Register, RegisterSchema } from '../register/entities/register.entity';
import { AuditLog, AuditLogSchema } from '../audit-log/entities/audit-log.entity';
import { proposedBillingConfiguration } from './billing.types';
import { Controller, INestApplication, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { InternalApiKeyGuard } from '../auth/guards/internal-api-key.guard';
import { MembershipMpController } from './billing-mp.controller';
import { BillingPortalController, MembershipPortalEnabledGuard } from './billing-portal.controller';
import { MembershipAccessGuard } from './membership-access.guard';
import { BillingNotificationsService } from './billing-notifications.service';

@Controller()
class BookingBoundaryFixture {
  @Post('court-reserve') single() {
    return { admitted: true };
  }
  @Post('booking/multiple') multiple() {
    return { admitted: true };
  }
}

const uri = process.env.BILLING_TEST_MONGO_URI;
(uri ? describe : describe.skip)(
  'Monthly checkout/settlement and portal with isolated replica set',
  () => {
    let connection: mongoose.Connection,
      dues: mongoose.Model<MembershipDue>,
      payments: mongoose.Model<MembershipPayment>;
    let members: mongoose.Model<Register>,
      configs: mongoose.Model<MembershipBillingConfig>,
      audit: mongoose.Model<AuditLog>;
    let core: MembershipBillingService,
      mp: MembershipMpService,
      portal: BillingPortalService,
      bank: BillingAdminService;
    let own: string, carga: string, dueIds: string[], now: Date;
    let snapshot: MembershipProviderSnapshot;
    let settings: Record<string, string>;
    let post: jest.SpyInstance;
    let app: INestApplication, base: string, jwt: JwtService;
    const secret = 'isolated-monthly-http-secret';
    const cfg = {
      get: (name: string) => (name === 'SECRET_KEY' ? secret : settings?.[name]),
    } as any;
    const call = async (path: string, body?: unknown, address = email, extra = {}) => {
      const response = await fetch(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(address
            ? { Authorization: `Bearer ${jwt.sign({ email: address, role: 'admin' })}` }
            : {}),
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    };
    const email = 'test1@example.invalid';
    const key = 'monthly-fixture-key-one';
    beforeAll(async () => {
      const target = new URL(uri);
      if (target.hostname !== '127.0.0.1' || !/^\/ctq_billing_test_[\w]+$/.test(target.pathname))
        throw new Error('Isolated localhost billing DB required.');
      target.pathname += '_mp';
      connection = await mongoose
        .createConnection(target.toString(), { autoIndex: false, autoCreate: false })
        .asPromise();
      if (!(await connection.db.admin().command({ hello: 1 })).setName)
        throw new Error('Replica set required.');
      dues = connection.model(MembershipDue.name, MembershipDueSchema);
      payments = connection.model(MembershipPayment.name, MembershipPaymentSchema);
      configs = connection.model(MembershipBillingConfig.name, MembershipBillingConfigSchema);
      members = connection.model(Register.name, RegisterSchema);
      audit = connection.model(AuditLog.name, AuditLogSchema);
      for (const model of [dues, payments, configs, members, audit] as mongoose.Model<any>[]) {
        await model.createCollection();
        await model.createIndexes();
      }
      const portalProxy = {
        enabled: () => portal.enabled(),
        access: (email: string) => portal.access(email),
        home: (email: string, through?: string) => portal.home(email, through),
        history: (email: string, id?: string, page?: number) => portal.history(email, id, page),
      };
      const module = await Test.createTestingModule({
        imports: [
          PassportModule.register({ defaultStrategy: 'jwt' }),
          JwtModule.register({ secret }),
        ],
        controllers: [MembershipMpController, BillingPortalController, BookingBoundaryFixture],
        providers: [
          JwtStrategy,
          InternalApiKeyGuard,
          MembershipPortalEnabledGuard,
          { provide: ConfigService, useValue: cfg },
          { provide: BillingPortalService, useValue: portalProxy },
          {
            provide: MembershipMpService,
            useValue: {
              checkout: (email: string, ids: string[], key: string) => mp.checkout(email, ids, key),
              state: (email: string, reference: string) => mp.state(email, reference),
              reconcile: (email: string, reference: string) => mp.reconcile(email, reference),
              receive: (id: string) => mp.receive(id),
            },
          },
          {
            provide: APP_GUARD,
            useFactory: () => new MembershipAccessGuard(portalProxy as any, cfg),
          },
        ],
      }).compile();
      jwt = module.get(JwtService);
      app = module.createNestApplication();
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
    });
    beforeEach(async () => {
      for (const model of [dues, payments, configs, members, audit] as mongoose.Model<any>[])
        await model.deleteMany({});
      now = new Date('2026-10-17T15:00:00Z');
      const actor = await members.create({
        namePlayer: 'usuario test 1',
        email,
        pwd: 'fixture-only',
        cellular: 'fixture-1',
        statePlayer: true,
        partnerType: 'Titular',
        billingStartPeriod: '2026-10',
      });
      const dependent = await members.create({
        namePlayer: 'usuario test 2',
        email: 'test2@example.invalid',
        pwd: 'fixture-only',
        cellular: 'fixture-2',
        statePlayer: true,
        partnerType: 'Carga',
        titularId: actor._id,
        billingStartPeriod: '2026-10',
      });
      await members.create({
        namePlayer: 'Admin fixture',
        email: 'admin@example.invalid',
        pwd: 'fixture-only',
        cellular: 'fixture-admin',
        statePlayer: true,
        role: 'admin',
        partnerType: 'Titular',
      });
      [own, carga] = [actor, dependent].map((row) => String(row._id));
      const config = proposedBillingConfiguration();
      config.testPricing = { enabled: true, memberIds: [own, carga], titular: 180, carga: 50 };
      await configs.create(config);
      settings = {
        MEMBERSHIP_PORTAL_ENABLED: 'true',
        MP_API_URL: 'http://127.0.0.1:8099/mercadopago',
        INTERNAL_API_KEY: 'isolated-internal-key',
      };
      core = new MembershipBillingService(dues, payments, configs, members, () => now);
      mp = new MembershipMpService(core, cfg, payments, dues, members, audit, () => now);
      portal = new BillingPortalService(core, cfg, members, dues, configs, () => now, mp);
      bank = new BillingAdminService(core, dues, payments, configs, members, audit, () => now);
      const first = await core.prepareDues(own, own);
      const second = await core.prepareDues(own, carga);
      dueIds = [first[0], second[0]].map((row) => String(row._id));
      post = jest.spyOn(axios, 'post').mockImplementation(async (url: string) => {
        if (url.endsWith('/membership/create-preference'))
          return {
            data: {
              preferenceId: 'pref-fixture',
              collectorId: '999',
              liveMode: true,
              initPoint: 'https://www.mercadopago.cl/checkout/v1/redirect?pref_id=fixture',
            },
          };
        if (url.endsWith('/membership/reconcile')) return { data: { queued: 1 } };
        throw new Error('Non-approved external request');
      });
      jest.spyOn(axios, 'get').mockImplementation(async (url: string) => ({
        data: url.endsWith('/membership/configuration')
          ? { ready: true, collectorId: '999', currency: 'CLP' }
          : snapshot,
      }));
    });
    afterEach(() => jest.restoreAllMocks());
    afterAll(async () => {
      if (app) await app.close();
      if (connection) {
        await connection.dropDatabase();
        await connection.close();
      }
    });
    const checkout = async () => {
      const result = await mp.checkout(email, dueIds, key);
      snapshot = {
        paymentId: '123',
        reference: result.reference,
        purpose: 'MEMBERSHIP',
        amount: 230,
        currency: 'CLP',
        status: 'approved',
        collectorId: '999',
        liveMode: true,
        pricingMode: 'TEST',
        approvedAt: '2026-10-17T14:59:00Z',
        refundedAmount: 0,
        preference: { id: 'pref-fixture', collectorId: '999', liveMode: true },
      };
      return result;
    };
    it('creates PENDING intent with server total and no settled dues or fake bank income', async () => {
      const result = await checkout();
      expect(result).toMatchObject({ status: 'PENDING', amount: 230, checkoutStatus: 'READY' });
      expect(post).toHaveBeenCalledWith(
        expect.stringContaining('/membership/create-preference'),
        expect.objectContaining({ amount: 230, purpose: 'MEMBERSHIP', pricingMode: 'TEST' }),
        expect.anything(),
      );
      expect(await dues.countDocuments({ status: 'PAID' })).toBe(0);
      expect((await payments.findOne()).bank).toBeUndefined();
    });
    it('reuses the same idempotent request and forbids changing it', async () => {
      const first = await checkout();
      expect((await mp.checkout(email, dueIds, key)).reference).toBe(first.reference);
      expect(post).toHaveBeenCalledTimes(1);
      await expect(mp.checkout(email, [dueIds[0]], key)).rejects.toMatchObject({ status: 409 });
      expect(await payments.countDocuments()).toBe(1);
    });
    it('prevents overlapping checkout from a second key and concurrent requests', async () => {
      const results = await Promise.all([
        mp.checkout(email, dueIds, key),
        mp.checkout(email, dueIds, key),
      ]);
      expect(results[0].reference).toBe(results[1].reference);
      expect(post).toHaveBeenCalledTimes(1);
      await expect(mp.checkout(email, dueIds, 'another-fixture-key-0001')).rejects.toMatchObject({
        status: 409,
      });
    });
    it('retains UNKNOWN after timeout and never automatically creates a second preference', async () => {
      post.mockRejectedValue(new Error('timeout after sending request'));
      await expect(mp.checkout(email, dueIds, key)).rejects.toMatchObject({ status: 504 });
      expect((await mp.checkout(email, dueIds, key)).checkoutStatus).toBe('UNKNOWN');
      expect(post).toHaveBeenCalledTimes(1);
      expect(await dues.countDocuments({ status: 'PAID' })).toBe(0);
    });
    it('rejects inactive actors, unrelated beneficiaries and missing idempotency keys', async () => {
      await expect(mp.checkout(email, dueIds, '')).rejects.toMatchObject({ status: 400 });
      await expect(mp.checkout('admin@example.invalid', dueIds, key)).rejects.toMatchObject({
        status: 403,
      });
      await members.updateOne({ _id: own }, { $set: { statePlayer: false } });
      await expect(mp.checkout(email, dueIds, key)).rejects.toMatchObject({ status: 403 });
      expect(post).not.toHaveBeenCalled();
    });
    it('confirms provider approval, all dues, audit and pending mail in one transaction', async () => {
      await checkout();
      expect(await mp.receive('123')).toMatchObject({ status: 'CONFIRMED' });
      expect(await dues.countDocuments({ status: 'PAID' })).toBe(2);
      const payment = await payments.findOne();
      expect(payment.provider).toMatchObject({
        paymentId: '123',
        receivedAmount: 230,
        collectorId: '999',
        liveMode: true,
      });
      expect(payment.notifications).toHaveLength(1);
      expect(payment.notifications[0].status).toBe('PENDING');
      expect(payment.registeredBy).toBeUndefined();
      expect(await audit.countDocuments({ action: 'PAYMENT_CONFIRMATION' })).toBe(1);
    });
    it.each([
      [{ amount: 229 }, 'AMOUNT_MISMATCH'],
      [{ currency: 'USD' }, 'CURRENCY_MISMATCH'],
      [{ collectorId: '998' }, 'COLLECTOR_MISMATCH'],
      [{ liveMode: false }, 'MODE_MISMATCH'],
      [{ pricingMode: 'STANDARD' }, 'PRICING_MODE_MISMATCH'],
      [{ approvedAt: 'invalid' }, 'INVALID_APPROVAL_DATE'],
    ])(
      'preserves irregular provider receipts for review without settling any due (%j)',
      async (change, reason) => {
        await checkout();
        Object.assign(snapshot, change);
        expect((await mp.receive('123')).status).toBe('REVIEW_REQUIRED');
        expect((await payments.findOne()).reviewReasons).toContain(reason);
        expect(await dues.countDocuments({ status: 'PAID' })).toBe(0);
      },
    );
    it('does not accept browser-supplied facts or malformed provider evidence', async () => {
      await checkout();
      snapshot.purpose = 'RESERVATION';
      await expect(mp.receive('123')).rejects.toMatchObject({ status: 503 });
      expect(await dues.countDocuments({ status: 'PAID' })).toBe(0);
    });
    it('is idempotent for repeated approval events and retains exactly one mail', async () => {
      await checkout();
      await mp.receive('123');
      expect((await mp.receive('123')).duplicate).toBe(true);
      expect((await payments.findOne()).notifications).toHaveLength(1);
      expect(await audit.countDocuments({ action: 'PAYMENT_CONFIRMATION' })).toBe(1);
    });
    it('does not degrade a confirmed payment with a late pending/rejected event', async () => {
      await checkout();
      await mp.receive('123');
      snapshot.status = 'pending';
      await mp.receive('123');
      expect((await payments.findOne()).status).toBe('CONFIRMED');
      expect((await payments.findOne()).provider.status).toBe('approved');
    });
    it('marks refunds/chargebacks for review without reopening paid dues automatically', async () => {
      await checkout();
      await mp.receive('123');
      snapshot.status = 'refunded';
      snapshot.refundedAmount = 230;
      expect((await mp.receive('123')).status).toBe('REVIEW_REQUIRED');
      expect(await dues.countDocuments({ status: 'PAID' })).toBe(2);
      expect((await payments.findOne()).reviewReasons).toContain('REFUND_OR_CHARGEBACK');
    });
    it('records a second captured transaction as a separate review receipt without double allocation', async () => {
      await checkout();
      await mp.receive('123');
      snapshot.paymentId = '124';
      expect((await mp.receive('124')).status).toBe('REVIEW_REQUIRED');
      expect(await payments.countDocuments()).toBe(2);
      expect((await payments.findOne({ 'provider.paymentId': '124' })).reviewReasons).toContain(
        'DUPLICATE_PROVIDER_PAYMENT',
      );
      expect(await dues.countDocuments({ status: 'PAID' })).toBe(2);
    });
    it('does not partially allocate captured funds if a bank payment already settled one due', async () => {
      await checkout();
      await bank.registerBankPayment(
        'admin@example.invalid',
        {
          method: 'BANK_TRANSFER',
          amount: 180,
          dueIds: [dueIds[0]],
          payerName: 'usuario test 1',
          payerMemberId: own,
          receivedDate: '2026-10-16',
          reference: 'bank-wins',
          verified: true,
        },
        'bank-fixture-key-00001',
      );
      expect((await mp.receive('123')).status).toBe('REVIEW_REQUIRED');
      expect(await dues.countDocuments({ status: 'PAID' })).toBe(1);
      expect((await dues.findById(dueIds[1])).status).toBe('OPEN');
    });
    it('rolls back all settlement changes if mandatory financial audit fails', async () => {
      await checkout();
      const spy = jest
        .spyOn(audit, 'create')
        .mockRejectedValueOnce(new Error('audit down') as never);
      await expect(mp.receive('123')).rejects.toThrow('audit down');
      expect(await dues.countDocuments({ status: 'PAID' })).toBe(0);
      expect((await payments.findOne()).status).toBe('PENDING');
      spy.mockRestore();
      expect((await mp.receive('123')).status).toBe('CONFIRMED');
    });
    it('masks family amounts and checkout URLs from a carga while allowing its own state', async () => {
      const result = await checkout();
      const ownState = await mp.state('test2@example.invalid', result.reference);
      expect(ownState.amount).toBe(50);
      expect(ownState.allocations).toHaveLength(1);
      expect(ownState.initPoint).toBeNull();
      await expect(mp.state('admin@example.invalid', result.reference)).rejects.toMatchObject({
        status: 403,
      });
    });
    it('reconciles only as payer with cooldown and never confirms from a redirect', async () => {
      const result = await checkout();
      post.mockClear();
      await mp.reconcile(email, result.reference);
      await mp.reconcile(email, result.reference);
      expect(post).toHaveBeenCalledTimes(1);
      expect((await payments.findOne()).status).toBe('PENDING');
    });
    it('opens the family portal with only own/linked arrears and current dues', async () => {
      const administrator = await members.findOne({ email: 'admin@example.invalid' });
      for (const id of [own, carga])
        await core.prepareDues(String(administrator._id), id, '2027-01');
      const home = await portal.home(email);
      expect(home.members.map((row) => row.id)).toEqual([own, carga]);
      expect(home.currentPeriod).toBe('2026-10');
      expect(home.dues).toHaveLength(2);
      expect(home.dues.every((row) => row.period <= home.currentPeriod)).toBe(true);
      expect(await dues.countDocuments()).toBe(8);
      expect(home.access.financiallyRestricted).toBe(false);
      const onlyCarga = await portal.home('test2@example.invalid');
      expect(onlyCarga.members).toHaveLength(1);
      await expect(portal.history('test2@example.invalid', own)).rejects.toMatchObject({
        status: 403,
      });
    });
    it('rejects forged future portal requests and checkout IDs without trusting JWT admin claims', async () => {
      expect((await call('/membership-billing/me/dues', { throughPeriod: '2026-11' })).status).toBe(
        400,
      );
      expect(await dues.countDocuments()).toBe(2);
      const administrator = await members.findOne({ email: 'admin@example.invalid' });
      const rows = await core.prepareDues(String(administrator._id), own, '2027-01');
      const result = await call('/membership-billing/checkout', {
        dueIds: rows.map((row) => String(row._id)),
      });
      expect(result.status).toBe(400);
      expect(result.body.message).toContain('mes actual');
      expect(post).not.toHaveBeenCalled();
      expect(await payments.countDocuments()).toBe(0);
    });
    it('returns arrears and current dues using server time after a month rollover', async () => {
      now = new Date('2026-12-01T15:00:00Z');
      const result = await call('/membership-billing/me/dues', {});
      expect(result.status).toBe(201);
      expect(result.body.currentPeriod).toBe('2026-12');
      expect([...new Set(result.body.dues.map((row) => row.period))]).toEqual([
        '2026-10',
        '2026-11',
        '2026-12',
      ]);
    });
    it('retains manual inactive state and restricts legacy financial access without changing flags', async () => {
      await members.updateOne({ _id: own }, { $set: { updatePayment: false } });
      expect(await portal.access(email)).toMatchObject({
        financiallyRestricted: true,
        reason: 'LEGACY_ACCESS_REVIEW',
      });
      await members.updateOne({ _id: own }, { $set: { statePlayer: false } });
      await expect(portal.home(email)).rejects.toMatchObject({ status: 403 });
    });
    it('requires real JWT, rejects browser amounts and has no browser confirmation endpoint', async () => {
      expect((await call('/membership-billing/checkout', { dueIds }, '')).status).toBe(401);
      expect((await call('/membership-billing/checkout', { dueIds, amount: 1 })).status).toBe(400);
      const result = await call('/membership-billing/checkout', { dueIds });
      expect(result.status).toBe(201);
      expect(result.body.amount).toBe(230);
      expect(
        (
          await call(`/membership-billing/payments/${result.body.reference}/confirm`, {
            status: 'approved',
          })
        ).status,
      ).toBe(404);
      expect(await dues.countDocuments({ status: 'PAID' })).toBe(0);
    });
    it('requires the internal key and accepts only an operation ID, never callback monetary claims', async () => {
      await checkout();
      expect(
        (await call('/membership-billing/internal/mercado-pago', { paymentId: '123' }, '')).status,
      ).toBe(401);
      expect(
        (
          await call(
            '/membership-billing/internal/mercado-pago',
            { paymentId: '123', amount: 230, status: 'approved' },
            '',
            { 'x-api-key': 'isolated-internal-key' },
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await call('/membership-billing/internal/mercado-pago', { paymentId: '123' }, '', {
            'x-api-key': 'isolated-internal-key',
          })
        ).body.status,
      ).toBe('CONFIRMED');
    });
    it('denies debtors both booking modes but retains dues/history/checkout and exempts active admins', async () => {
      await members.updateOne({ _id: own }, { $set: { updatePayment: false } });
      for (const route of ['/court-reserve', '/booking/multiple']) {
        const response = await call(route, {});
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('PAYMENTS_ONLY');
        expect((await call(route, {}, '')).status).toBe(401);
        expect((await call(route, {}, 'admin@example.invalid')).status).toBe(201);
      }
      expect((await call('/membership-billing/me/dues', {})).status).toBe(201);
      expect((await call('/membership-billing/me/payments')).status).toBe(200);
      expect((await call('/membership-billing/checkout', { dueIds })).status).toBe(201);
      await members.updateOne({ _id: own }, { $set: { statePlayer: false } });
      expect((await call('/membership-billing/me/dues', {})).status).toBe(403);
    });
    it('enforces member history ownership and feature flags over HTTP', async () => {
      expect(
        (
          await call(
            `/membership-billing/me/payments?beneficiaryId=${own}`,
            undefined,
            'test2@example.invalid',
          )
        ).status,
      ).toBe(403);
      delete settings.MP_API_URL;
      expect((await call('/membership-billing/checkout', { dueIds })).status).toBe(503);
      settings.MEMBERSHIP_PORTAL_ENABLED = 'false';
      expect((await call('/membership-billing/me/dues', {})).status).toBe(503);
    });
    it('expires only after a complete empty provider reconciliation and safety buffer', async () => {
      const result = await checkout();
      post.mockImplementation(async (url: string) => ({
        data: url.endsWith('/membership/reconcile')
          ? { queued: 0 }
          : {
              preferenceId: 'next-pref',
              collectorId: '999',
              liveMode: true,
              initPoint: 'https://www.mercadopago.cl/checkout/v1/redirect?pref_id=next',
            },
      }));
      now = new Date(now.getTime() + 45 * 60000);
      expect((await mp.reconcile(email, result.reference)).status).toBe('PENDING');
      now = new Date(now.getTime() + 16 * 60000);
      expect((await mp.reconcile(email, result.reference)).status).toBe('CANCELLED');
      expect(await dues.countDocuments({ status: 'PAID' })).toBe(0);
      const next = await mp.checkout(email, dueIds, 'fresh-attempt-key-after-expiration');
      expect(next.reference).not.toBe(result.reference);
    });
    it('keeps the portal usable but refuses new checkout when provider readiness cannot be verified', async () => {
      jest.spyOn(axios, 'get').mockRejectedValue(new Error('provider unavailable'));
      expect((await portal.access(email)).mpEnabled).toBe(false);
      expect((await portal.home(email)).members).toHaveLength(2);
      await expect(mp.checkout(email, dueIds, key)).rejects.toMatchObject({ status: 503 });
      expect(await payments.countDocuments()).toBe(0);
      expect(post).not.toHaveBeenCalled();
    });
    it('settles an uncertain creation using provider-verified preference evidence', async () => {
      await checkout();
      await payments.updateOne(
        {},
        {
          $unset: { 'checkout.expectedLiveMode': '', 'provider.preferenceId': '' },
          $set: { 'checkout.creationStatus': 'UNKNOWN' },
        },
      );
      expect((await mp.receive('123')).status).toBe('CONFIRMED');
      expect(await dues.countDocuments({ status: 'PAID' })).toBe(2);
    });
    it('keeps confirmation operational even if the readiness endpoint becomes unavailable', async () => {
      await checkout();
      jest.spyOn(axios, 'get').mockImplementation(async (url: string) => {
        if (url.endsWith('/membership/configuration')) throw new Error('readiness unavailable');
        return { data: snapshot };
      });
      expect((await mp.receive('123')).status).toBe('CONFIRMED');
    });
    it('refuses to settle standard dues with sandbox money', async () => {
      await checkout();
      await payments.updateOne(
        {},
        { $set: { pricingMode: 'STANDARD', 'checkout.expectedLiveMode': false } },
      );
      snapshot.pricingMode = 'STANDARD';
      snapshot.liveMode = false;
      snapshot.preference.liveMode = false;
      expect((await mp.receive('123')).status).toBe('REVIEW_REQUIRED');
      expect((await payments.findOne()).reviewReasons).toContain('SANDBOX_STANDARD_PAYMENT');
      expect(await dues.countDocuments({ status: 'PAID' })).toBe(0);
    });
    it('restores booking after overdue dues settle; automatic blocking remains opt-in', async () => {
      expect((await portal.access(email)).autoBlockEnabled).toBe(false);
      await configs.updateOne(
        {},
        { $set: { autoBlockEnabled: true, 'activation.migrationReviewed': true } },
      );
      now = new Date('2026-11-06T15:00:00Z');
      expect(await portal.access(email)).toMatchObject({
        financiallyRestricted: true,
        reason: 'OVERDUE_DUES',
      });
      expect((await call('/court-reserve', {})).status).toBe(403);
      await checkout();
      snapshot.approvedAt = now.toISOString();
      await mp.receive('123');
      expect((await portal.access(email)).financiallyRestricted).toBe(false);
      expect((await call('/court-reserve', {})).status).toBe(201);
    });
    it('keeps a paid account inactive and never rewrites its administrative flags', async () => {
      await checkout();
      await members.updateOne({ _id: own }, { $set: { statePlayer: false, updatePayment: false } });
      await mp.receive('123');
      expect(await dues.countDocuments({ status: 'PAID' })).toBe(2);
      expect(await members.findById(own)).toMatchObject({
        statePlayer: false,
        updatePayment: false,
      });
      expect((await call('/membership-billing/me/access')).status).toBe(403);
    });
    it('retries Mercado Pago email separately and never rolls back a confirmed payment for mail failure', async () => {
      await checkout();
      await mp.receive('123');
      const emailService = {
        sendEmail: jest
          .fn()
          .mockRejectedValueOnce(new Error('mail down'))
          .mockResolvedValue(undefined),
      };
      const worker = new BillingNotificationsService(payments, emailService as any, cfg, () => now);
      await worker.drain();
      expect((await payments.findOne()).status).toBe('CONFIRMED');
      expect((await payments.findOne()).notifications[0].status).toBe('FAILED');
      now = new Date(now.getTime() + 60001);
      await worker.drain();
      expect(emailService.sendEmail).toHaveBeenCalledTimes(2);
      expect(emailService.sendEmail.mock.calls[1][0].html).toContain('Mercado Pago');
      expect((await payments.findOne()).notifications[0].status).toBe('SENT');
    });
  },
);
