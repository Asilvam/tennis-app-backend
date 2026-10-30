import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { duesGenerationPlan } from './billing-generation.policy';
import {
  enrollmentReason,
  INITIAL_ENROLLMENT_REASON,
  initialEnrollmentPlan,
} from './billing-enrollment.policy';
import { proposedBillingConfiguration } from './billing.types';
import {
  EnrollMembershipDto,
  PreviewMembershipEnrollmentDto,
  ReenrollMembershipDto,
} from './dto/enroll-membership.dto';
import { PrepareAdminDuesDto, PreviewAdminDuesDto } from './dto/billing-admin-query.dto';

const now = new Date('2026-10-29T18:00:00Z');
const config = proposedBillingConfiguration();
const person = () => ({
  _id: '100000000000000000000001',
  namePlayer: 'Fixture',
  email: 'fixture@example.invalid',
  role: 'user',
  statePlayer: true,
  partnerType: 'Titular',
  billingStartPeriod: '2026-10',
});

describe('Explicit billing range and automatic initial audit reason', () => {
  it('keeps legacy single-month previews identical when the upper bound is omitted', () => {
    expect(initialEnrollmentPlan(person(), '2026-10', config, now)).toEqual(
      initialEnrollmentPlan(person(), '2026-10', config, now, '2026-10'),
    );
  });
  it('previews four months inclusively across a year boundary for titular and carga', () => {
    const own = initialEnrollmentPlan(person(), '2026-10', config, now, '2027-01');
    expect(own.rows.map((row) => row.period)).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
    expect(own.total).toBe(72000);
    expect(
      initialEnrollmentPlan(
        { ...person(), partnerType: 'Carga' },
        '2026-10',
        config,
        now,
        '2027-01',
      ).total,
    ).toBe(20000);
  });
  it.each(['2027-02', '2026-09', '2026-13', null])(
    'rejects an invalid initial upper bound: %s',
    (through) => {
      expect(() =>
        initialEnrollmentPlan(person(), '2026-10', config, now, through as string),
      ).toThrow();
    },
  );
  it('rejects a future start even when the chosen end is within admin allowance', () => {
    expect(() => initialEnrollmentPlan(person(), '2026-11', config, now, '2027-01')).toThrow();
  });
  it('normal enrollment defaults audit reason in backend, while exceptions remain explicit', () => {
    for (const value of [undefined, '', '   '])
      expect(enrollmentReason(value)).toBe(INITIAL_ENROLLMENT_REASON);
    expect(enrollmentReason('  Revision valida  ')).toBe('Revision valida');
    for (const value of [undefined, '', '   ', 'bad', null, 123, 'x'.repeat(1001)])
      expect(() => enrollmentReason(value, true)).toThrow();
    for (const value of [null, false, {}, 'bad']) expect(() => enrollmentReason(value)).toThrow();
  });
  it.each([undefined, '', '   ', 'Motivo antiguo valido'])(
    'accepts initial DTO reason %s without weakening reenrollment',
    async (reason) => {
      const body = {
        startPeriod: '2026-10',
        throughPeriod: '2027-01',
        approvalHash: 'a'.repeat(64),
        ...(reason === undefined ? {} : { reason }),
      };
      expect(await validate(plainToInstance(EnrollMembershipDto, body))).toHaveLength(0);
      const errors = await validate(
        plainToInstance(ReenrollMembershipDto, {
          startPeriod: '2026-10',
          approvalHash: body.approvalHash,
        }),
      );
      expect(errors).not.toHaveLength(0);
    },
  );
  it('rejects nulls, caller-supplied money/actors and future ranges on the exceptional DTO', async () => {
    const options = { whitelist: true, forbidNonWhitelisted: true };
    for (const extra of [
      { reason: null },
      { throughPeriod: null },
      { amount: 1 },
      { actor: 'admin' },
    ])
      expect(
        await validate(
          plainToInstance(EnrollMembershipDto, {
            startPeriod: '2026-10',
            approvalHash: 'a'.repeat(64),
            ...extra,
          }),
          options,
        ),
      ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(ReenrollMembershipDto, {
          startPeriod: '2026-10',
          throughPeriod: '2027-01',
          approvalHash: 'a'.repeat(64),
          reason: 'Motivo valido',
        }),
        options,
      ),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(PreviewMembershipEnrollmentDto, {
          startPeriod: '2026-10',
          throughPeriod: '2027-01',
        }),
        options,
      ),
    ).toHaveLength(0);
    expect(await validate(plainToInstance(PreviewAdminDuesDto, {}), options)).not.toHaveLength(0);
    expect(
      await validate(plainToInstance(PrepareAdminDuesDto, { approvalHash: null }), options),
    ).not.toHaveLength(0);
  });
});

describe('Read-only plan for already enrolled members', () => {
  const due = () => ({
    _id: '200000000000000000000001',
    period: '2026-10',
    status: 'PAID' as const,
    amount: 18000,
    currency: 'CLP',
    pricingMode: 'STANDARD',
    paidAt: now,
    settlementPaymentId: 'payment-fixture',
  });
  it('counts existing dues separately and charges no new amount for a paid row', () => {
    const plan = duesGenerationPlan(person(), [due()], '2027-01', config, now);
    expect(plan.newCount).toBe(3);
    expect(plan.existingCount).toBe(1);
    expect(plan.total).toBe(54000);
    expect(plan.existingRows[0]).toMatchObject({ status: 'PAID', amount: 18000 });
  });
  it('returns a zero-new plan when all requested months already exist', () => {
    const plan = duesGenerationPlan(person(), [due()], '2026-10', config, now);
    expect(plan.newRows).toEqual([]);
    expect(plan.total).toBe(0);
  });
  it('does not reopen cancelled dues or create months between validity intervals', () => {
    expect(() =>
      duesGenerationPlan(person(), [{ ...due(), status: 'VOID' }], '2027-01', config, now),
    ).toThrow();
    const plan = duesGenerationPlan(
      {
        ...person(),
        billingPeriods: [
          { fromPeriod: '2026-10', throughPeriod: '2026-10' },
          { fromPeriod: '2026-12' },
        ],
      },
      [due()],
      '2027-01',
      config,
      now,
    );
    expect(plan.excludedPeriods).toEqual(['2026-11']);
    expect(plan.newRows.map((row) => row.period)).toEqual(['2026-12', '2027-01']);
  });
  it.each([
    { statePlayer: false },
    { billingStartPeriod: undefined },
    { partnerType: 'Unknown' },
    { billingPeriods: [] },
  ])('rejects invalid member eligibility %j', (change) => {
    expect(() =>
      duesGenerationPlan({ ...person(), ...change }, [], '2027-01', config, now),
    ).toThrow();
  });
  it('fingerprints range, member version, settled state, pricing and local calendar month', () => {
    const base = duesGenerationPlan(person(), [due()], '2027-01', config, now).approvalHash;
    const candidates = [
      duesGenerationPlan(person(), [due()], '2026-12', config, now),
      duesGenerationPlan({ ...person(), __v: 1 }, [due()], '2027-01', config, now),
      duesGenerationPlan(person(), [{ ...due(), status: 'OPEN' }], '2027-01', config, now),
      duesGenerationPlan(
        person(),
        [due()],
        '2027-01',
        { ...config, testPricing: { ...config.testPricing, titular: 999 } },
        now,
      ),
      duesGenerationPlan(person(), [due()], '2027-01', config, new Date('2026-11-01T04:00:00Z')),
    ];
    for (const plan of candidates) expect(plan.approvalHash).not.toBe(base);
  });
});
