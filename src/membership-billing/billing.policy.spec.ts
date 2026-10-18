import { Types } from 'mongoose';
import { DateTime } from 'luxon';
import { BillingDue, BillingMember, proposedBillingConfiguration } from './billing.types';
import {
  addMonths,
  assertAmount,
  assertBillingStart,
  assertCanManage,
  assertConfiguration,
  assertMemberId,
  assertPaymentSelection,
  assertPeriod,
  dueAt,
  financialAccess,
  monthAt,
  periodsBetween,
  priceFor,
} from './billing.policy';

const titularId = '100000000000000000000001';
const cargaId = '100000000000000000000002';
const member = (changes: Partial<BillingMember> = {}): BillingMember => ({
  _id: titularId,
  namePlayer: 'usuario test 1',
  email: 'test1@example.invalid',
  role: 'user',
  statePlayer: true,
  partnerType: 'Titular',
  billingStartPeriod: '2026-10',
  ...changes,
});
const due = (period = '2026-10', changes: Partial<BillingDue> = {}): BillingDue => ({
  _id: new Types.ObjectId(),
  beneficiaryId: titularId,
  period,
  dueAt: dueAt(period),
  amount: 18000,
  currency: 'CLP',
  pricingMode: 'STANDARD',
  status: 'OPEN',
  ...changes,
});
const october = new Date('2026-10-17T15:00:00Z');

describe('Membership billing rules (no network or database)', () => {
  it('proposes calendar arrears billing with automatic blocking and test pricing disabled', () => {
    expect(proposedBillingConfiguration()).toMatchObject({
      billingStartsAtPeriod: '2026-10',
      dueDayNextMonth: 5,
      maxAdvanceMonths: 3,
      autoBlockEnabled: false,
      testPricing: { enabled: false, memberIds: [], titular: 180, carga: 50 },
    });
  });
  it.each(['2026-00', '2026-13', '10-2026', '2026-1', '', undefined, '2026-10-extra'])(
    'rejects invalid period %s',
    (period) => {
      expect(() => assertPeriod(period)).toThrow();
    },
  );
  it.each([0, -1, 0.1, 180.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid amount %s',
    (amount) => {
      expect(() => assertAmount(amount)).toThrow();
    },
  );
  it.each(['invalid', '123', '', undefined, 'z00000000000000000000001'])(
    'rejects invalid member ID %s',
    (id) => {
      expect(() => assertMemberId(id)).toThrow();
    },
  );
  it('calculates month and due boundary in Chile instead of server UTC', () => {
    expect(monthAt(new Date('2026-11-01T02:00:00Z'))).toBe('2026-10');
    expect(dueAt('2026-10').toISOString()).toBe('2026-11-06T03:00:00.000Z');
    expect(dueAt('2026-12').toISOString()).toBe('2027-01-06T03:00:00.000Z');
  });
  it.each(['2026-03', '2026-04', '2026-08', '2026-09'])(
    'uses the first valid instant of local day 6 across DST for %s',
    (period) => {
      const local = DateTime.fromJSDate(dueAt(period), { zone: 'America/Santiago' });
      expect(local.toISODate()).toBe(`${addMonths(period, 1)}-06`);
      expect(local.toMillis()).toBe(local.startOf('day').toMillis());
    },
  );
  it('creates a consecutive period range and handles year boundaries', () => {
    expect(periodsBetween('2026-10', '2027-01')).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
    expect(periodsBetween('2027-01', '2026-10')).toEqual([]);
  });
  it('rejects invalid dates and fractional month offsets', () => {
    expect(() => monthAt(new Date('invalid'))).toThrow();
    expect(() => addMonths('2026-10', 1.5)).toThrow();
  });
  it.each([
    ['Titular', 18000],
    ['Carga', 5000],
    ['Familiar', 5000],
  ])('prices %s on server with its own quota', (type, amount) => {
    expect(
      priceFor(member({ partnerType: type as string }), '2026-10', proposedBillingConfiguration()),
    ).toMatchObject({ amount, pricingMode: 'STANDARD', currency: 'CLP' });
  });
  it('uses 180/50 only for explicitly enrolled IDs, not names or arbitrary flags', () => {
    const config = proposedBillingConfiguration();
    config.testPricing = { ...config.testPricing, enabled: true, memberIds: [titularId, cargaId] };
    expect(priceFor(member(), '2026-10', config)).toMatchObject({
      amount: 180,
      pricingMode: 'TEST',
    });
    expect(
      priceFor(member({ _id: cargaId, partnerType: 'Carga' }), '2026-10', config),
    ).toMatchObject({ amount: 50, pricingMode: 'TEST' });
    expect(priceFor(member({ _id: new Types.ObjectId() }), '2026-10', config)).toMatchObject({
      amount: 18000,
      pricingMode: 'STANDARD',
    });
  });
  it('fails closed with enabled test rates and no allowed ID', () => {
    const config = proposedBillingConfiguration();
    config.testPricing.enabled = true;
    expect(() => assertConfiguration(config)).toThrow();
  });
  it('selects tariff versions without changing the configuration', () => {
    const config = proposedBillingConfiguration();
    config.tariffVersions.push({
      id: 'future',
      effectiveFromPeriod: '2027-01',
      currency: 'CLP',
      titular: 20000,
      carga: 6000,
    });
    expect(priceFor(member(), '2026-12', config).amount).toBe(18000);
    expect(priceFor(member(), '2027-01', config).amount).toBe(20000);
    expect(config.tariffVersions[0].id).toBe('standard-2026-10');
    expect(() => priceFor(member(), '2026-09', config)).toThrow();
  });
  it.each([
    { timezone: 'UTC' },
    { maxAdvanceMonths: 4 },
    { dueDayNextMonth: 6 },
    { tariffVersions: [] },
    { autoBlockEnabled: 'true' },
    { testPricing: undefined },
  ])('rejects configuration outside approved rules: %j', (override) => {
    expect(() =>
      assertConfiguration({ ...proposedBillingConfiguration(), ...override } as any),
    ).toThrow();
  });
  it('rejects ambiguous tariff versions and invalid member types', () => {
    const config = proposedBillingConfiguration();
    config.tariffVersions.push({ ...config.tariffVersions[0], id: 'duplicate-date' });
    expect(() => assertConfiguration(config)).toThrow();
    expect(() =>
      priceFor(member({ partnerType: 'unknown' }), '2026-10', proposedBillingConfiguration()),
    ).toThrow();
  });
  it('requires explicit billing start, never infers payments or back debt from a boolean', () => {
    expect(() =>
      assertBillingStart(member({ billingStartPeriod: undefined }), proposedBillingConfiguration()),
    ).toThrow();
    expect(() =>
      assertBillingStart(member({ billingStartPeriod: '2026-09' }), proposedBillingConfiguration()),
    ).toThrow();
    expect(assertBillingStart(member(), proposedBillingConfiguration())).toBe('2026-10');
  });
  it('authorizes self, linked cargas and active admins only', () => {
    const carga = member({ _id: cargaId, partnerType: 'Carga', titularId });
    expect(() => assertCanManage(member(), member())).not.toThrow();
    expect(() => assertCanManage(member(), carga)).not.toThrow();
    expect(() => assertCanManage(member({ role: 'admin' }), carga)).not.toThrow();
    expect(() => assertCanManage(carga, member())).toThrow();
    expect(() =>
      assertCanManage(member(), { ...carga, titularId: new Types.ObjectId() }),
    ).toThrow();
    expect(() => assertCanManage(member({ statePlayer: false, role: 'admin' }), carga)).toThrow();
  });
  it('accepts current month plus three future months, rejecting a rolling fourth advance', () => {
    const rows = periodsBetween('2026-10', '2027-01').map((period) => due(period));
    expect(assertPaymentSelection(rows, rows, october)).toBe(72000);
    const february = due('2027-02');
    expect(() =>
      assertPaymentSelection(
        [february],
        [...rows.map((row) => ({ ...row, status: 'PAID' as const })), february],
        october,
      ),
    ).toThrow();
  });
  it('requires earlier unpaid months, but not an unrelated carga quota', () => {
    const rows = [due('2026-10'), due('2026-11')];
    expect(() => assertPaymentSelection([rows[1]], rows, october)).toThrow();
    expect(
      assertPaymentSelection(rows, [...rows, due('2026-10', { beneficiaryId: cargaId })], october),
    ).toBe(36000);
  });
  it('rejects empty, repeated, settled, foreign-currency and mixed-price selections', () => {
    const row = due();
    expect(() => assertPaymentSelection([], [], october)).toThrow();
    expect(() => assertPaymentSelection([row, row], [row], october)).toThrow();
    expect(() => assertPaymentSelection([{ ...row, status: 'PAID' }], [row], october)).toThrow();
    expect(() => assertPaymentSelection([{ ...row, currency: 'USD' }], [row], october)).toThrow();
    expect(() =>
      assertPaymentSelection([row, due('2026-11', { pricingMode: 'TEST' })], [], october),
    ).toThrow();
  });
  it('does not restrict before the end of day 5 and restricts at day 6', () => {
    const config = {
      ...proposedBillingConfiguration(),
      autoBlockEnabled: true,
      activation: { migrationReviewed: true },
    };
    expect(
      financialAccess(member(), [due()], config, new Date('2026-11-06T02:59:59.999Z'))
        .financiallyRestricted,
    ).toBe(false);
    expect(
      financialAccess(member(), [due()], config, new Date('2026-11-06T03:00:00Z'))
        .financiallyRestricted,
    ).toBe(true);
  });
  it('a newer payment does not excuse an older debt, and an unexpired new month does not block', () => {
    const config = {
      ...proposedBillingConfiguration(),
      autoBlockEnabled: true,
      activation: { migrationReviewed: true },
    };
    const now = new Date('2026-11-10T12:00:00Z');
    expect(
      financialAccess(member(), [due(), due('2026-11', { status: 'PAID' })], config, now)
        .financiallyRestricted,
    ).toBe(true);
    expect(
      financialAccess(member(), [due('2026-10', { status: 'PAID' }), due('2026-11')], config, now)
        .financiallyRestricted,
    ).toBe(false);
  });
  it('respects global control, administrator exemption and manual inactivity independently', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    const config = proposedBillingConfiguration();
    expect(financialAccess(member(), [due()], config, now)).toMatchObject({
      hasOverdueDues: true,
      financiallyRestricted: false,
    });
    config.autoBlockEnabled = true;
    config.activation = { migrationReviewed: true };
    expect(financialAccess(member({ role: 'admin' }), [due()], config, now)).toMatchObject({
      exempt: true,
      hasOverdueDues: true,
      financiallyRestricted: false,
    });
    expect(financialAccess(member({ statePlayer: false }), [], config, now)).toMatchObject({
      accountActive: false,
    });
    expect(
      financialAccess(member(), [due('2026-10', { beneficiaryId: cargaId })], config, now)
        .hasOverdueDues,
    ).toBe(false);
  });
});
