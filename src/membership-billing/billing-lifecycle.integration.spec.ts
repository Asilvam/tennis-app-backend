import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import * as mongoose from 'mongoose';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  readSnapshot,
  writeBackup,
  validateBackup,
  auditDatabase,
} from '../../scripts/membership-billing-release-check.cjs';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { Register, RegisterSchema } from '../register/entities/register.entity';
import { RegisterService } from '../register/register.service';
import { AuditLog, AuditLogSchema } from '../audit-log/entities/audit-log.entity';
import { MembershipDue, MembershipDueSchema } from './entities/membership-due.entity';
import { MembershipPayment, MembershipPaymentSchema } from './entities/membership-payment.entity';
import {
  MembershipBillingConfig,
  MembershipBillingConfigSchema,
} from './entities/membership-billing-config.entity';
import { MembershipBillingService } from './membership-billing.service';
import { BillingLifecycleService } from './billing-lifecycle.service';
import { BillingLifecycleController } from './billing-lifecycle.controller';
import { BillingAdminController } from './billing-admin.controller';
import { BillingAdminService } from './billing-admin.service';
import { BillingAdminEnabledGuard } from './billing-admin.guard';
import { BillingEnrollmentService } from './billing-enrollment.service';
import { BillingEnrollmentController } from './billing-enrollment.controller';
import { uncertainMembershipPaymentFilter } from './billing-payment-state.policy';
import { proposedBillingConfiguration } from './billing.types';

const uri = process.env.BILLING_TEST_MONGO_URI;
(uri ? describe : describe.skip)(
  'Monthly lifecycle with isolated transactions and HTTP/JWT',
  () => {
    let db: mongoose.Connection;
    let members: mongoose.Model<Register>,
      dues: mongoose.Model<MembershipDue>,
      payments: mongoose.Model<MembershipPayment>;
    let configs: mongoose.Model<MembershipBillingConfig>, audit: mongoose.Model<AuditLog>;
    let core: MembershipBillingService,
      lifecycle: BillingLifecycleService,
      admin: BillingAdminService;
    let app: INestApplication,
      jwt: JwtService,
      base: string,
      now: Date,
      adminId: string,
      own: string,
      carga: string;
    let httpEnabled = true;
    let enrollment: BillingEnrollmentService;
    const mp = { reconcileForBilling: jest.fn() };
    const settings = {
      get: (key: string) =>
        key === 'SECRET_KEY'
          ? 'isolated-lifecycle-secret'
          : key === 'MEMBERSHIP_BILLING_ADMIN_ENABLED' && httpEnabled
            ? 'true'
            : undefined,
    };
    const models = () => [members, dues, payments, configs, audit] as mongoose.Model<any>[];
    const call = async (
      path: string,
      body?: unknown,
      role = 'admin',
      key = 'lifecycle-idempotency-0001',
    ) => {
      const email = role === 'admin' ? 'admin@example.invalid' : 'test1@example.invalid';
      const response = await fetch(`${base}/membership-billing/admin/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${jwt.sign({ email, role })}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
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
      target.pathname += '_lifecycle';
      db = await mongoose
        .createConnection(target.toString(), { autoIndex: false, autoCreate: false })
        .asPromise();
      if (!(await db.db.admin().command({ hello: 1 })).setName)
        throw new Error('Replica set required.');
      members = db.model(Register.name, RegisterSchema);
      dues = db.model(MembershipDue.name, MembershipDueSchema);
      payments = db.model(MembershipPayment.name, MembershipPaymentSchema);
      configs = db.model(MembershipBillingConfig.name, MembershipBillingConfigSchema);
      audit = db.model(AuditLog.name, AuditLogSchema);
      for (const model of models()) {
        await model.createCollection();
        await model.createIndexes();
      }
      core = new MembershipBillingService(dues, payments, configs, members, () => now, audit);
      admin = new BillingAdminService(core, dues, payments, configs, members, audit, () => now);
      enrollment = new BillingEnrollmentService(
        admin,
        members,
        dues,
        payments,
        configs,
        audit,
        () => now,
      );
      lifecycle = new BillingLifecycleService(
        core,
        dues,
        payments,
        configs,
        members,
        audit,
        mp as any,
        settings as any,
        () => now,
      );
      const module = await Test.createTestingModule({
        imports: [
          PassportModule.register({ defaultStrategy: 'jwt' }),
          JwtModule.register({ secret: settings.get('SECRET_KEY') }),
        ],
        controllers: [
          BillingLifecycleController,
          BillingAdminController,
          BillingEnrollmentController,
        ],
        providers: [
          JwtStrategy,
          BillingAdminEnabledGuard,
          { provide: ConfigService, useValue: settings },
          { provide: BillingLifecycleService, useValue: lifecycle },
          { provide: BillingAdminService, useValue: admin },
          { provide: BillingEnrollmentService, useValue: enrollment },
        ],
      }).compile();
      app = module.createNestApplication({ logger: false });
      await app.listen(0, '127.0.0.1');
      base = await app.getUrl();
      jwt = module.get(JwtService);
    });
    beforeEach(async () => {
      jest.restoreAllMocks();
      mp.reconcileForBilling.mockReset().mockResolvedValue(undefined);
      httpEnabled = true;
      now = new Date('2026-10-17T15:00:00Z');
      for (const model of models()) await model.deleteMany({});
      const actor = await members.create({
        namePlayer: 'Admin fixture',
        email: 'admin@example.invalid',
        cellular: 'admin',
        pwd: 'fixture',
        role: 'admin',
        statePlayer: true,
      });
      adminId = String(actor._id);
      const interval = {
        fromPeriod: '2026-10',
        approvedAt: now,
        approvedBy: actor._id,
        reason: 'Alta local aprobada',
      };
      const first = await members.create({
        namePlayer: 'Usuario test 1',
        email: 'test1@example.invalid',
        cellular: 'test1',
        pwd: 'fixture',
        statePlayer: true,
        partnerType: 'Titular',
        billingStartPeriod: '2026-10',
        billingPeriods: [interval],
      });
      own = String(first._id);
      const second = await members.create({
        namePlayer: 'Usuario test 2',
        email: 'test2@example.invalid',
        cellular: 'test2',
        pwd: 'fixture',
        statePlayer: true,
        partnerType: 'Carga',
        titularId: first._id,
        billingStartPeriod: '2026-10',
        billingPeriods: [interval],
      });
      carga = String(second._id);
      const config = proposedBillingConfiguration();
      config.testPricing = { enabled: true, memberIds: [own, carga], titular: 180, carga: 50 };
      config.activation = { migrationReviewed: true };
      config.automation = { enabled: true, approvedAt: now, approvedBy: 'admin@example.invalid' };
      await configs.create(config);
    });
    afterAll(async () => {
      if (app) await app.close();
      if (db) {
        await db.dropDatabase();
        await db.close();
      }
    });
    const jan = () => {
      now = new Date('2027-01-06T03:00:00Z');
    };
    const manual = async (period: string, date: string, id = own) => {
      const row = await dues.findOne({ beneficiaryId: id, period });
      return admin.registerBankPayment(
        'admin@example.invalid',
        {
          method: 'CASH',
          payerName: 'Fixture',
          amount: row.amount,
          dueIds: [String(row._id)],
          verified: true,
          receivedDate: date,
        },
        `manual-lifecycle-${period}-${id}`,
      );
    };
    it('does nothing without explicit reviewed DB activation or with the existing admin switch off', async () => {
      await configs.updateOne({}, { $unset: { automation: '' } });
      expect(await lifecycle.processMember(own)).toEqual({ outcome: 'DISABLED' });
      await lifecycle.tick();
      expect(await dues.countDocuments()).toBe(0);
      expect(await audit.countDocuments()).toBe(0);
      await configs.updateOne(
        {},
        { $set: { automation: { enabled: true, approvedAt: now, approvedBy: 'fixture' } } },
      );
      httpEnabled = false;
      await lifecycle.tick();
      expect(await dues.countDocuments()).toBe(0);
    });
    it('previews read-only, verifies the current admin and protects the HTTP route', async () => {
      jan();
      const before = (await members.findById(own)).__v;
      const preview = await call('automation/preview');
      expect(preview.status).toBe(200);
      expect(preview.body.items.find((row) => row.memberId === own).closure.throughPeriod).toBe(
        '2026-12',
      );
      expect(await dues.countDocuments()).toBe(0);
      expect(await audit.countDocuments()).toBe(0);
      expect((await members.findById(own)).__v).toBe(before);
      expect((await call('automation/preview', undefined, 'user')).status).toBe(403);
      await members.updateOne({ _id: adminId }, { $set: { statePlayer: false } });
      expect((await call('automation/preview')).status).toBe(403);
    });
    it('generates in Chile, includes restricted members and skips inactive or unenrolled accounts', async () => {
      await members.updateOne({ _id: own }, { $set: { updatePayment: false } });
      await members.updateOne({ _id: carga }, { $set: { statePlayer: false } });
      now = new Date('2026-11-01T02:59:59Z');
      await lifecycle.tick();
      expect(await dues.countDocuments({ beneficiaryId: own })).toBe(1);
      now = new Date('2026-11-01T03:00:00Z');
      await lifecycle.tick();
      expect(await dues.countDocuments({ beneficiaryId: own })).toBe(2);
      expect(await dues.countDocuments({ beneficiaryId: carga })).toBe(0);
      expect(await dues.countDocuments({ beneficiaryId: adminId })).toBe(0);
      expect((await dues.findOne({ beneficiaryId: own })).amount).toBe(180);
    });
    it('generates the carga at 50 and all other IDs at standard prices', async () => {
      await lifecycle.processMember(carga);
      expect((await dues.findOne({ beneficiaryId: carga })).amount).toBe(50);
      await configs.updateOne({}, { $set: { 'testPricing.memberIds': [carga] } });
      await lifecycle.processMember(own);
      expect((await dues.findOne({ beneficiaryId: own })).amount).toBe(18000);
    });
    it('concurrent retries issue one due and one generation audit', async () => {
      await Promise.all([
        lifecycle.processMember(own),
        lifecycle.processMember(own),
        lifecycle.processMember(own),
      ]);
      expect(await dues.countDocuments()).toBe(1);
      expect(
        await audit.countDocuments({ 'metadata.reason': 'MEMBERSHIP_MONTHLY_GENERATION' }),
      ).toBe(1);
    });
    it('closes on day 6, keeps Oct-Dec debt and voids January and later issued unpaid dues', async () => {
      now = new Date('2027-01-05T20:00:00Z');
      await core.prepareDues(adminId, own, '2027-04');
      expect((await lifecycle.processMember(own)).outcome).toBe('GENERATED');
      jan();
      const result = await lifecycle.processMember(own);
      expect(result.outcome).toBe('TERMINATED');
      const person = await members.findById(own).select('+billingPeriods +billingClosure').lean();
      expect(person.statePlayer).toBe(false);
      expect(person.billingClosure.effectiveAt).toEqual(now);
      expect(person.billingPeriods[0].throughPeriod).toBe('2026-12');
      expect(await dues.countDocuments({ beneficiaryId: own, status: 'OPEN' })).toBe(3);
      expect(await dues.countDocuments({ beneficiaryId: own, status: 'VOID' })).toBe(4);
      expect((await dues.findOne({ beneficiaryId: own, period: '2027-01' })).voided.reason).toBe(
        'MEMBERSHIP_TERMINATED',
      );
      expect((await members.findById(own).lean()).billingClosure).toBeUndefined();
      await lifecycle.processMember(own);
      expect(
        await audit.countDocuments({ 'metadata.reason': 'MEMBERSHIP_AUTOMATIC_TERMINATION' }),
      ).toBe(1);
    });
    it('recovers a missed run at the original cutoff, not at the restart month', async () => {
      now = new Date('2027-03-15T15:00:00Z');
      await lifecycle.tick();
      const person = await members.findById(own).select('+billingClosure').lean();
      expect(person.billingClosure.effectiveAt.toISOString()).toBe('2027-01-06T03:00:00.000Z');
      expect(await dues.countDocuments({ beneficiaryId: own, status: 'VOID' })).toBe(3);
    });
    it('holds uncertain MP attempts, reconciles first and deduplicates review audits', async () => {
      const rows = await core.prepareDues(adminId, own);
      await payments.create({
        publicReference: 'membership-pending-fixture',
        method: 'MERCADO_PAGO',
        status: 'PENDING',
        amount: 180,
        currency: 'CLP',
        pricingMode: 'TEST',
        payer: { name: 'Fixture' },
        allocations: [{ dueId: rows[0]._id, beneficiaryId: own, period: '2026-10', amount: 180 }],
        checkout: { creationStatus: 'UNKNOWN' },
      });
      jan();
      mp.reconcileForBilling.mockRejectedValue(new Error('Provider unavailable'));
      await lifecycle.tick();
      await lifecycle.tick();
      expect(mp.reconcileForBilling).toHaveBeenCalledWith('membership-pending-fixture');
      expect((await members.findById(own)).statePlayer).toBe(true);
      expect(
        await audit.countDocuments({
          entityId: own,
          'metadata.reason': 'MEMBERSHIP_CLOSURE_REVIEW',
        }),
      ).toBe(1);
      await payments.updateOne(
        {},
        { $set: { status: 'CANCELLED', 'checkout.creationStatus': 'FAILED' } },
      );
      expect((await lifecycle.processMember(own)).outcome).toBe('TERMINATED');
    });
    it('leaves legacy interval-less records in review instead of inventing an approval', async () => {
      await members.updateOne({ _id: own }, { $unset: { billingPeriods: '' } });
      jan();
      expect(await lifecycle.processMember(own)).toMatchObject({
        outcome: 'REVIEW_REQUIRED',
        reasons: ['BILLING_HISTORY_REQUIRES_REVIEW'],
      });
      expect((await members.findById(own)).statePlayer).toBe(true);
    });
    it('does not terminate admin members, or modify their legacy access flags', async () => {
      await members.updateOne({ _id: own }, { $set: { role: 'admin', updatePayment: false } });
      jan();
      await lifecycle.processMember(own);
      expect(await members.findById(own).lean()).toMatchObject({
        statePlayer: true,
        updatePayment: false,
      });
    });
    it('uses effective bank dates, not the date the administrator recorded the receipt', async () => {
      now = new Date('2027-01-07T15:00:00Z');
      await core.prepareDues(adminId, own);
      await manual('2026-10', '2027-01-05');
      expect((await lifecycle.processMember(own)).outcome).toBe('GENERATED');
      expect((await members.findById(own)).statePlayer).toBe(true);
    });
    it('a late verified payment preserves money but does not retroactively avoid termination', async () => {
      now = new Date('2027-01-08T15:00:00Z');
      await core.prepareDues(adminId, own);
      await manual('2026-10', '2027-01-07');
      await lifecycle.processMember(own);
      expect((await members.findById(own)).statePlayer).toBe(false);
      expect((await dues.findOne({ beneficiaryId: own, period: '2026-10' })).status).toBe('PAID');
      expect(await payments.countDocuments({ status: 'CONFIRMED' })).toBe(1);
    });
    it('does not void a prepaid future month or automatically refund it', async () => {
      await core.prepareDues(adminId, own, '2027-01');
      const future = await dues.findOne({ beneficiaryId: own, period: '2027-01' });
      await dues.updateOne(
        { _id: future._id },
        {
          $set: { status: 'PAID', paidAt: now, settlementPaymentId: new mongoose.Types.ObjectId() },
        },
      );
      jan();
      expect(await lifecycle.processMember(own)).toMatchObject({
        outcome: 'REVIEW_REQUIRED',
        reasons: ['PREPAID_PERIOD_REQUIRES_REVIEW'],
      });
      expect((await dues.findById(future._id)).status).toBe('PAID');
    });
    it('rolls back generation, voiding and account state if the financial audit fails', async () => {
      jan();
      jest.spyOn(audit, 'create').mockRejectedValueOnce(new Error('Audit failed') as never);
      await expect(lifecycle.processMember(own)).rejects.toThrow('Audit failed');
      expect(await dues.countDocuments()).toBe(0);
      expect((await members.findById(own)).statePlayer).toBe(true);
      expect((await lifecycle.processMember(own)).outcome).toBe('TERMINATED');
    });
    it('isolates one member failure so the next member can still be processed', async () => {
      await members.updateOne({ _id: own }, { $set: { billingStartPeriod: '2025-01' } });
      await lifecycle.tick();
      expect(await dues.countDocuments({ beneficiaryId: own })).toBe(0);
      expect(await dues.countDocuments({ beneficiaryId: carga })).toBe(1);
    });
    it('re-enrolls in the current month without requiring old debt or losing history', async () => {
      now = new Date('2027-03-15T15:00:00Z');
      await lifecycle.processMember(own);
      const oldIds = (await dues.find({ beneficiaryId: own, period: { $lte: '2026-12' } })).map(
        (row) => String(row._id),
      );
      const preview = await call(`members/${own}/reenrollment/preview`, { startPeriod: '2027-03' });
      expect(preview.status).toBe(201);
      expect(preview.body.total).toBe(180);
      expect(preview.body.historicalTotal).toBe(540);
      expect(await dues.countDocuments({ beneficiaryId: own, status: 'ARCHIVED' })).toBe(0);
      const payload = {
        startPeriod: '2027-03',
        approvalHash: preview.body.approvalHash,
        reason: 'Nueva inscripcion aprobada',
      };
      const results = await Promise.all([
        call(`members/${own}/reenrollment`, payload),
        call(`members/${own}/reenrollment`, payload),
      ]);
      expect(results.every((row) => row.status === 201)).toBe(true);
      const person = await members.findById(own).select('+billingPeriods').lean();
      expect(person.statePlayer).toBe(true);
      expect(person.billingStartPeriod).toBe('2026-10');
      expect(person.billingPeriods).toHaveLength(2);
      expect(person.billingPeriods[1].fromPeriod).toBe('2027-03');
      expect(await dues.countDocuments({ _id: { $in: oldIds }, status: 'ARCHIVED' })).toBe(3);
      expect(await dues.countDocuments({ beneficiaryId: own, status: 'VOID' })).toBe(2);
      expect((await dues.findOne({ beneficiaryId: own, period: '2027-03' })).status).toBe('OPEN');
      expect(await payments.countDocuments()).toBe(0);
      await expect(core.quote(own, [oldIds[0]])).rejects.toThrow();
      await configs.updateOne({}, { $set: { autoBlockEnabled: true } });
      expect(await core.assessFinancialAccess(own)).toMatchObject({ financiallyRestricted: false });
      const current = await dues.findOne({ beneficiaryId: own, period: '2027-03' });
      expect((await core.quote(own, [String(current._id)])).amount).toBe(180);
      expect((await lifecycle.processMember(own)).outcome).toBe('GENERATED');
      expect(
        (await call(`members/${own}/reenrollment`, { ...payload, reason: 'Otro motivo' })).status,
      ).toBe(409);
    });
    it('concurrent termination retries close only once', async () => {
      jan();
      const results = await Promise.all([
        lifecycle.processMember(own),
        lifecycle.processMember(own),
      ]);
      expect(results.filter((row) => row.outcome === 'TERMINATED')).toHaveLength(1);
      expect(
        await audit.countDocuments({ 'metadata.reason': 'MEMBERSHIP_AUTOMATIC_TERMINATION' }),
      ).toBe(1);
      expect(await dues.countDocuments({ beneficiaryId: own, status: 'VOID' })).toBe(1);
    });
    const clearStarts = async () =>
      members.updateMany(
        { _id: { $in: [own, carga] } },
        {
          $unset: { billingStartPeriod: '', billingPeriods: '', billingBaseline: '' },
        },
      );
    const batchInput = (preview) => ({
      startPeriod: preview.startPeriod,
      reason: 'Habilitacion revisada de prueba',
      items: preview.items
        .filter((row) => row.status === 'ELIGIBLE')
        .map((row) => ({ memberId: row.memberId, approvalHash: row.plan.approvalHash })),
    });
    it('previews families read-only and excludes admin from the global batch', async () => {
      await clearStarts();
      const preview = await call('enrollment/preview', {
        startPeriod: '2026-10',
        familyMemberId: own,
      });
      expect(preview.status).toBe(201);
      expect(preview.body.items).toHaveLength(2);
      expect(preview.body.items.map((row) => row.plan.total).sort((a, b) => a - b)).toEqual([
        50, 180,
      ]);
      expect(await dues.countDocuments()).toBe(0);
      expect(await audit.countDocuments()).toBe(0);
      const global = await call('enrollment/preview', { startPeriod: '2026-10' });
      expect(global.body.items).toHaveLength(2);
      expect((await call('enrollment/preview', { startPeriod: '2026-10' }, 'user')).status).toBe(
        403,
      );
    });
    it('manual activation wins a race with the mass preview and is never replaced', async () => {
      await clearStarts();
      now = new Date('2026-11-17T15:00:00Z');
      const preview = await enrollment.previewBatch('admin@example.invalid', {
        startPeriod: '2026-11',
      });
      const manualPlan = await admin.previewEnrollment('admin@example.invalid', own, '2026-10');
      await admin.enroll(
        'admin@example.invalid',
        own,
        {
          startPeriod: '2026-10',
          approvalHash: manualPlan.approvalHash,
          reason: 'Alta manual anterior',
        },
        'manual-before-batch-001',
      );
      const before = JSON.stringify(await members.findById(own).select('+billingPeriods').lean());
      const result = await enrollment.applyBatch(
        'admin@example.invalid',
        batchInput(preview),
        'mass-after-manual-001',
      );
      expect(result.counts).toMatchObject({ enrolled: 1, skipped: 1 });
      expect(JSON.stringify(await members.findById(own).select('+billingPeriods').lean())).toBe(
        before,
      );
      expect((await members.findById(own)).billingStartPeriod).toBe('2026-10');
      expect(await dues.countDocuments({ beneficiaryId: own })).toBe(2);
    });
    it('batch retries and concurrent requests do not duplicate approvals or dues', async () => {
      await clearStarts();
      const preview = await enrollment.previewBatch('admin@example.invalid', {
        startPeriod: '2026-10',
      });
      const payload = batchInput(preview);
      const results = await Promise.all([
        enrollment.applyBatch('admin@example.invalid', payload, 'batch-concurrent-key-001'),
        enrollment.applyBatch('admin@example.invalid', payload, 'batch-concurrent-key-001'),
      ]);
      expect(results.reduce((sum, row) => sum + row.counts.enrolled, 0)).toBe(2);
      expect(await dues.countDocuments()).toBe(2);
      expect(await audit.countDocuments({ 'metadata.reason': 'MEMBERSHIP_ENROLLMENT' })).toBe(2);
      expect(await audit.countDocuments({ 'metadata.reason': 'MEMBERSHIP_BATCH_REQUEST' })).toBe(1);
      await expect(
        enrollment.applyBatch(
          'admin@example.invalid',
          { ...payload, reason: 'Otro motivo distinto' },
          'batch-concurrent-key-001',
        ),
      ).rejects.toThrow('clave');
    });
    it('a reviewed existing member is omitted from all later mass previews', async () => {
      const before = JSON.stringify(await members.findById(own).select('+billingPeriods').lean());
      const preview = await enrollment.previewBatch('admin@example.invalid', {
        startPeriod: '2026-10',
      });
      expect(preview.counts).toMatchObject({ alreadyEnabled: 2, eligible: 0 });
      expect(preview.items[0].plan).toBeUndefined();
      expect(JSON.stringify(await members.findById(own).select('+billingPeriods').lean())).toBe(
        before,
      );
    });
    it('inactive accounts, incomplete baselines and orphan cargas are review-only', async () => {
      await clearStarts();
      await members.updateOne({ _id: own }, { $set: { statePlayer: false } });
      await members.updateOne({ _id: carga }, { $unset: { titularId: '' } });
      const preview = await enrollment.previewBatch('admin@example.invalid', {
        startPeriod: '2026-10',
      });
      expect(preview.counts.reviewRequired).toBe(2);
      expect(preview.counts.eligible).toBe(0);
      expect(await dues.countDocuments()).toBe(0);
    });
    it('rejects forged, duplicate, empty and unreviewed mass requests before applying data', async () => {
      await clearStarts();
      const preview = await enrollment.previewBatch('admin@example.invalid', {
        startPeriod: '2026-10',
      });
      const payload = batchInput(preview);
      for (const body of [
        { ...payload, statePlayer: true },
        { ...payload, items: [] },
        { ...payload, items: [null] },
        {
          ...payload,
          items: Array.from({ length: 26 }, (_, index) => ({
            ...payload.items[0],
            memberId: (index + 1).toString(16).padStart(24, '0'),
          })),
        },
        { ...payload, items: [payload.items[0], payload.items[0]] },
        { ...payload, items: [{ ...payload.items[0], approvalHash: 'invalid' }] },
      ])
        expect((await call('enrollment', body)).status).toBe(400);
      expect(await dues.countDocuments()).toBe(0);
      expect(await audit.countDocuments()).toBe(0);
    });
    it('changed prices require review again and uncertain failures resume the same batch', async () => {
      await clearStarts();
      let preview = await enrollment.previewBatch('admin@example.invalid', {
        startPeriod: '2026-10',
      });
      await configs.updateOne({}, { $set: { 'testPricing.titular': 181 } });
      const stale = await enrollment.applyBatch(
        'admin@example.invalid',
        batchInput(preview),
        'stale-batch-prices-001',
      );
      expect(stale.counts.reviewRequired).toBe(1);
      preview = await enrollment.previewBatch('admin@example.invalid', { startPeriod: '2026-10' });
      jest.spyOn(admin, 'enroll').mockRejectedValueOnce(new Error('Temporarily unavailable'));
      const payload = batchInput(preview);
      expect(
        (await enrollment.applyBatch('admin@example.invalid', payload, 'retry-partial-batch-001'))
          .counts.errors,
      ).toBe(1);
      expect(
        (await enrollment.applyBatch('admin@example.invalid', payload, 'retry-partial-batch-001'))
          .counts.enrolled,
      ).toBe(1);
      expect(await dues.countDocuments()).toBe(2);
    });
    const legacyPaid = async () => {
      await core.prepareDues(adminId, own);
      const row = await dues.findOne({ beneficiaryId: own });
      const receipt = await payments.create({
        publicReference: 'membership-legacy-confirmed-fixture',
        method: 'MERCADO_PAGO',
        status: 'CONFIRMED',
        amount: 180,
        currency: 'CLP',
        pricingMode: 'TEST',
        payer: { name: 'Fixture' },
        allocations: [{ dueId: row._id, beneficiaryId: own, period: '2026-10', amount: 180 }],
        paidAt: now,
        confirmedAt: now,
        provider: {
          name: 'MERCADO_PAGO',
          paymentId: '999001',
          status: 'approved',
          verifiedAt: now,
        },
        checkout: { creationStatus: 'UNKNOWN' },
      });
      await dues.updateOne(
        { _id: row._id },
        { $set: { status: 'PAID', paidAt: now, settlementPaymentId: receipt._id } },
      );
      await members.updateOne(
        { _id: own },
        {
          $unset: { billingPeriods: '' },
          $set: {
            billingBaseline: {
              throughPeriod: '2026-09',
              migrationId: 'ctq-monthly-test-pilot-2026-10',
              establishedAt: now,
              establishedBy: adminId,
            },
          },
        },
      );
    };
    it('completes an old pilot validity without enrolling, repricing, archiving or creating payments', async () => {
      await legacyPaid();
      expect(await payments.countDocuments(uncertainMembershipPaymentFilter(now))).toBe(0);
      const beforeDues = JSON.stringify(await dues.find().lean()),
        beforePayments = JSON.stringify(await payments.find().lean());
      const preview = await call(`members/${own}/billing-history/preview`);
      expect(preview.status).toBe(200);
      expect(await audit.countDocuments()).toBe(0);
      const payload = {
        approvalHash: preview.body.approvalHash,
        reason: 'Vigencia del piloto revisada',
      };
      const results = await Promise.all([
        call(`members/${own}/billing-history`, payload),
        call(`members/${own}/billing-history`, payload),
      ]);
      expect(results.every((row) => row.status === 201)).toBe(true);
      expect((await members.findById(own).select('+billingPeriods')).billingPeriods).toHaveLength(
        1,
      );
      expect(JSON.stringify(await dues.find().lean())).toBe(beforeDues);
      expect(JSON.stringify(await payments.find().lean())).toBe(beforePayments);
      expect(
        await audit.countDocuments({ 'metadata.reason': 'MEMBERSHIP_LEGACY_HISTORY_APPROVAL' }),
      ).toBe(1);
    });
    it('history approval rejects changed ledgers and invalid baselines, and rolls back if audit fails', async () => {
      await legacyPaid();
      let preview = await enrollment.previewHistory('admin@example.invalid', own);
      await dues.updateOne(
        { beneficiaryId: own },
        { $set: { tariffVersionId: 'unchanged-test-version' } },
      );
      // New financial rows invalidate the reviewed snapshot, without rewriting the confirmed receipt.
      await core.prepareDues(adminId, own, '2026-11');
      await expect(
        enrollment.approveHistory(
          'admin@example.invalid',
          own,
          { approvalHash: preview.approvalHash, reason: 'Revision anterior' },
          'history-stale-review-001',
        ),
      ).rejects.toThrow('cambio');
      preview = await enrollment.previewHistory('admin@example.invalid', own);
      jest.spyOn(audit, 'create').mockRejectedValueOnce(new Error('Audit unavailable') as never);
      await expect(
        enrollment.approveHistory(
          'admin@example.invalid',
          own,
          { approvalHash: preview.approvalHash, reason: 'Revision valida' },
          'history-audit-failure-001',
        ),
      ).rejects.toThrow();
      expect(
        (await members.findById(own).select('+billingPeriods')).billingPeriods,
      ).toBeUndefined();
      await members.updateOne(
        { _id: own },
        { $set: { 'billingBaseline.throughPeriod': '2026-08' } },
      );
      await expect(enrollment.previewHistory('admin@example.invalid', own)).rejects.toThrow(
        'vigencia',
      );
    });
    it('real uncertainty still blocks legacy review and refund evidence is not ignored', async () => {
      await legacyPaid();
      await payments.updateOne({}, { $set: { status: 'REVIEW_REQUIRED' } });
      expect(await payments.countDocuments(uncertainMembershipPaymentFilter(now))).toBe(1);
      await expect(enrollment.previewHistory('admin@example.invalid', own)).rejects.toThrow(
        'incierto',
      );
      await payments.updateOne(
        {},
        { $set: { status: 'CONFIRMED', 'provider.status': 'refunded' } },
      );
      expect(await payments.countDocuments(uncertainMembershipPaymentFilter(now))).toBe(1);
      await expect(enrollment.previewHistory('admin@example.invalid', own)).rejects.toThrow(
        'incierto',
      );
    });
    it.each(['worker', 'on-demand'])(
      'restores an excluded future due after reenrollment via %s',
      async (mode) => {
        now = new Date('2027-01-05T15:00:00Z');
        await core.prepareDues(adminId, own, '2027-04');
        const original = await dues.findOne({ beneficiaryId: own, period: '2027-04' }).lean();
        jan();
        await lifecycle.processMember(own);
        now = new Date('2027-03-15T15:00:00Z');
        const preview = await admin.previewEnrollment(
          'admin@example.invalid',
          own,
          '2027-03',
          true,
        );
        await admin.enroll(
          'admin@example.invalid',
          own,
          {
            startPeriod: '2027-03',
            approvalHash: preview.approvalHash,
            reason: 'Nueva vigencia para piloto',
          },
          'future-due-reenrollment-001',
          true,
        );
        await configs.updateOne({}, { $set: { 'testPricing.titular': 181 } });
        now = new Date('2027-04-01T15:00:00Z');
        if (mode === 'worker') await lifecycle.processMember(own);
        else await core.prepareDues(own, own);
        expect(await dues.findById(original._id).lean()).toMatchObject({
          status: 'OPEN',
          amount: 181,
        });
        expect(
          await audit.countDocuments({ 'metadata.reason': 'MEMBERSHIP_REENROLLMENT_FUTURE_DUE' }),
        ).toBe(1);
        await core.prepareDues(own, own);
        expect(
          await audit.countDocuments({ 'metadata.reason': 'MEMBERSHIP_REENROLLMENT_FUTURE_DUE' }),
        ).toBe(1);
        expect(await dues.countDocuments({ beneficiaryId: own, status: 'ARCHIVED' })).toBe(3);
        expect(
          await dues.countDocuments({
            beneficiaryId: own,
            period: { $in: ['2027-01', '2027-02'] },
            status: 'VOID',
          }),
        ).toBe(2);
      },
    );
    it('a readonly release snapshot excludes credentials and never changes billing records', async () => {
      await core.prepareDues(adminId, own);
      const before = JSON.stringify(await members.findById(own).select('+billingPeriods').lean());
      const snapshot = await readSnapshot(db);
      expect(snapshot.register).toHaveLength(3);
      expect(
        snapshot.register.every((row) => !row.pwd && !row.email && !row.passwordResetTokenHash),
      ).toBe(true);
      expect(snapshot.membership_dues).toHaveLength(1);
      expect(await audit.countDocuments()).toBe(0);
      expect(JSON.stringify(await members.findById(own).select('+billingPeriods').lean())).toBe(
        before,
      );
    });
    it('a future-due audit failure rolls back reopening and repricing after reenrollment', async () => {
      now = new Date('2027-01-05T15:00:00Z');
      await core.prepareDues(adminId, own, '2027-04');
      jan();
      await lifecycle.processMember(own);
      now = new Date('2027-03-15T15:00:00Z');
      const preview = await admin.previewEnrollment('admin@example.invalid', own, '2027-03', true);
      await admin.enroll(
        'admin@example.invalid',
        own,
        {
          startPeriod: '2027-03',
          approvalHash: preview.approvalHash,
          reason: 'Piloto con reinscripcion',
        },
        'rollback-future-due-001',
        true,
      );
      await configs.updateOne({}, { $set: { 'testPricing.titular': 181 } });
      now = new Date('2027-04-01T15:00:00Z');
      jest.spyOn(audit, 'create').mockRejectedValueOnce(new Error('Future audit failed') as never);
      await expect(core.prepareDues(own, own)).rejects.toThrow('Future audit failed');
      expect(await dues.findOne({ beneficiaryId: own, period: '2027-04' }).lean()).toMatchObject({
        status: 'VOID',
        amount: 180,
      });
      expect((await members.findById(own)).statePlayer).toBe(true);
      await core.prepareDues(own, own);
      expect(await dues.findOne({ beneficiaryId: own, period: '2027-04' }).lean()).toMatchObject({
        status: 'OPEN',
        amount: 181,
      });
    });
    it('financial backup is private, exclusive, checksum checked and restorable as BSON', async () => {
      await core.prepareDues(adminId, own);
      await manual('2026-10', '2026-10-16');
      const dir = mkdtempSync(join(tmpdir(), 'ctq-billing-stage3-backup-'));
      const file = join(dir, 'financial.ejson');
      const target = db.getClient().db(`${db.name}_restore`);
      if (!target.databaseName.startsWith('ctq_billing_test_'))
        throw new Error('Isolated restore DB required.');
      try {
        const snapshot = await readSnapshot(db);
        writeBackup(file, snapshot, db.name);
        expect(statSync(file).mode & 0o777).toBe(0o600);
        expect(() => writeBackup(file, snapshot, db.name)).toThrow();
        const restored = validateBackup(file);
        for (const [name, rows] of Object.entries(restored.snapshot) as [string, any[]][]) {
          if (rows.length) await target.collection(name).insertMany(rows);
          expect(await target.collection(name).countDocuments()).toBe(rows.length);
        }
        const due = await target.collection('membership_dues').findOne();
        expect(due._id).toBeInstanceOf(mongoose.Types.ObjectId);
        expect(due.paidAt).toBeInstanceOf(Date);
        expect(due.status).toBe('PAID');
        expect(
          (await target.collection('membership_payments').findOne()).cash.receiptNumber,
        ).toBeTruthy();
        const changed = JSON.parse(readFileSync(file, 'utf8'));
        changed.snapshot.membership_dues[0].amount = 1;
        writeFileSync(file, JSON.stringify(changed));
        expect(() => validateBackup(file)).toThrow('checksum');
      } finally {
        await target.dropDatabase();
        rmSync(dir, { recursive: true, force: true });
      }
    });
    it('release audit on an empty local database never creates collections or indexes', async () => {
      const database = `${db.name}_empty_review`;
      const target = db.getClient().db(database);
      try {
        const report = await auditDatabase({ uri, database, pilotIds: [own, carga] });
        expect(report.mode).toBe('READ_ONLY');
        expect(report.pilotReadyForReview).toBe(false);
        expect(await target.listCollections().toArray()).toHaveLength(0);
      } finally {
        await target.dropDatabase();
      }
    });
    it('a closure audit failure rolls back an existing account and issued future dues', async () => {
      now = new Date('2027-01-05T20:00:00Z');
      await core.prepareDues(adminId, own);
      jan();
      jest.spyOn(audit, 'create').mockRejectedValueOnce(new Error('Closure audit failed') as never);
      await expect(lifecycle.processMember(own)).rejects.toThrow('Closure audit failed');
      expect((await members.findById(own)).statePlayer).toBe(true);
      expect(await dues.countDocuments({ beneficiaryId: own, status: 'OPEN' })).toBe(4);
      expect(await dues.countDocuments({ beneficiaryId: own, status: 'VOID' })).toBe(0);
    });
    it('re-enrollment rollback preserves inactive state, old debt and excluded months', async () => {
      now = new Date('2027-03-15T15:00:00Z');
      await lifecycle.processMember(own);
      const preview = await admin.previewEnrollment('admin@example.invalid', own, '2027-03', true);
      const payload = {
        startPeriod: '2027-03',
        approvalHash: preview.approvalHash,
        reason: 'Alta revisada',
      };
      jest
        .spyOn(audit, 'create')
        .mockRejectedValueOnce(new Error('Reenrollment audit failed') as never);
      await expect(
        admin.enroll('admin@example.invalid', own, payload, 'rollback-reenrollment-001', true),
      ).rejects.toThrow();
      expect((await members.findById(own)).statePlayer).toBe(false);
      expect(await dues.countDocuments({ beneficiaryId: own, status: 'ARCHIVED' })).toBe(0);
      expect(await dues.countDocuments({ beneficiaryId: own, status: 'OPEN' })).toBe(3);
      await admin.enroll('admin@example.invalid', own, payload, 'rollback-reenrollment-001', true);
      expect(await dues.countDocuments({ beneficiaryId: own, status: 'ARCHIVED' })).toBe(3);
    });
    it('keeps old real payments and reverses them without resurrecting non-collectible debt', async () => {
      now = new Date('2027-01-08T15:00:00Z');
      await core.prepareDues(adminId, own);
      const receipt = await manual('2026-10', '2027-01-07');
      await lifecycle.processMember(own);
      now = new Date('2027-03-15T15:00:00Z');
      const preview = await admin.previewEnrollment('admin@example.invalid', own, '2027-03', true);
      expect(preview.historicalTotal).toBe(360);
      await admin.enroll(
        'admin@example.invalid',
        own,
        {
          startPeriod: '2027-03',
          approvalHash: preview.approvalHash,
          reason: 'Nueva vigencia revisada',
        },
        're-enroll-preserve-payment-001',
        true,
      );
      expect((await payments.findById(receipt.id)).status).toBe('CONFIRMED');
      expect((await dues.findOne({ beneficiaryId: own, period: '2026-10' })).status).toBe('PAID');
      await admin.reverseBankPayment(
        'admin@example.invalid',
        receipt.id,
        'Correccion de registro historico',
        'reverse-historical-payment-001',
      );
      expect((await payments.findById(receipt.id)).status).toBe('REVERSED');
      expect((await dues.findOne({ beneficiaryId: own, period: '2026-10' })).status).toBe(
        'ARCHIVED',
      );
      await configs.updateOne({}, { $set: { autoBlockEnabled: true } });
      expect(await core.assessFinancialAccess(own)).toMatchObject({ financiallyRestricted: false });
    });
    it('prevents generic activation bypasses and keeps inactive payments disabled', async () => {
      jan();
      await lifecycle.processMember(own);
      const register = new RegisterService(members, {} as any, {} as any);
      await expect(
        register.updateAdminByEmail('test1@example.invalid', { statePlayer: true }),
      ).rejects.toThrow('reinscripcion');
      await expect(core.prepareDues(adminId, own)).rejects.toThrow('inactivos');
      const detail = await call(`members/${own}`);
      expect(detail.body.members[0].canReenroll).toBe(true);
      const listing = await call('members');
      expect(listing.body.items.find((row) => row.id === own).canReenroll).toBe(true);
    });
    it('rejects invalid reenrollment dates, data, accounts and stale approvals', async () => {
      expect(
        (await call(`members/${own}/reenrollment/preview`, { startPeriod: '2026-10' })).status,
      ).toBe(409);
      jan();
      await lifecycle.processMember(own);
      expect(
        (await call(`members/${own}/reenrollment/preview`, { startPeriod: '2026-12' })).status,
      ).toBe(400);
      const preview = await call(`members/${own}/reenrollment/preview`, { startPeriod: '2027-01' });
      const payload = {
        startPeriod: '2027-01',
        approvalHash: preview.body.approvalHash,
        reason: 'Revision aprobada',
      };
      expect(
        (await call(`members/${own}/reenrollment`, { ...payload, statePlayer: true })).status,
      ).toBe(400);
      await configs.updateOne({}, { $set: { 'testPricing.titular': 181 } });
      expect((await call(`members/${own}/reenrollment`, payload)).status).toBe(409);
      await members.updateOne({ _id: own }, { $unset: { billingClosure: '' } });
      expect(
        (await call(`members/${own}/reenrollment/preview`, { startPeriod: '2027-01' })).status,
      ).toBe(409);
    });
  },
);
