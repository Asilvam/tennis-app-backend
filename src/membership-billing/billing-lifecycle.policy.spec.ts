import { dueAt } from './billing.policy';
import { overdueClosure } from './billing-lifecycle.policy';
import { BillingDue, BillingMember } from './billing.types';

const member: BillingMember = {
  _id: 'member',
  namePlayer: 'Fixture',
  email: 'test@example.invalid',
  partnerType: 'Titular',
  role: 'user',
  statePlayer: true,
  billingStartPeriod: '2026-10',
  billingPeriods: [{ fromPeriod: '2026-10' }],
};
const rows = (): BillingDue[] =>
  ['2026-10', '2026-11', '2026-12', '2027-01'].map((period) => ({
    _id: period,
    beneficiaryId: 'member',
    period,
    dueAt: dueAt(period),
    status: 'OPEN',
    amount: 18000,
    currency: 'CLP',
    pricingMode: 'STANDARD',
  }));
describe('Monthly lifecycle cutoff policy', () => {
  it('keeps January 5 inclusive and closes at Chile midnight January 6', () => {
    expect(
      overdueClosure(member, rows(), '2027-01', new Date('2027-01-06T02:59:59.999Z')),
    ).toBeNull();
    expect(overdueClosure(member, rows(), '2027-01', new Date('2027-01-06T03:00:00Z'))).toEqual({
      throughPeriod: '2026-12',
      effectiveAt: new Date('2027-01-06T03:00:00Z'),
      overduePeriods: ['2026-10', '2026-11', '2026-12'],
    });
  });
  it('recovers the earliest effective cutoff after missed runs', () => {
    expect(
      overdueClosure(member, [], '2027-04', new Date('2027-04-20T15:00:00Z'))?.throughPeriod,
    ).toBe('2026-12');
  });
  it('requires consecutive unpaid months, not a count of arbitrary debts', () => {
    const data = rows();
    data[1].status = 'PAID';
    data[1].paidAt = new Date('2026-12-02T15:00:00Z');
    expect(overdueClosure(member, data, '2027-02', new Date('2027-02-06T15:00:00Z'))).toBeNull();
  });
  it.each(['2027-01-05T22:00:00Z', '2027-01-06T02:59:59.999Z'])(
    'uses verified payment effectiveness %s even if evidence arrived later',
    (effective) => {
      const data = rows();
      data[0].status = 'PAID';
      data[0].paidAt = new Date(effective);
      expect(overdueClosure(member, data, '2027-01', new Date('2027-01-10T15:00:00Z'))).toBeNull();
    },
  );
  it('does not let a late payment retroactively avoid the original cutoff', () => {
    const data = rows();
    data[0].status = 'PAID';
    data[0].paidAt = new Date('2027-01-07T15:00:00Z');
    expect(
      overdueClosure(member, data, '2027-01', new Date('2027-01-10T15:00:00Z'))?.throughPeriod,
    ).toBe('2026-12');
  });
  it('a payment effective exactly at day 6 is outside the day 5 deadline', () => {
    const data = rows();
    data[0].status = 'PAID';
    data[0].paidAt = new Date('2027-01-06T03:00:00Z');
    expect(
      overdueClosure(member, data, '2027-01', new Date('2027-01-06T03:00:00Z'))?.throughPeriod,
    ).toBe('2026-12');
  });
  it.each([{ role: 'admin' }, { statePlayer: false }])('exempts %j', (change) => {
    expect(
      overdueClosure({ ...member, ...change }, [], '2027-03', new Date('2027-03-10')),
    ).toBeNull();
  });
  it('starts a new delinquency cycle on reenrollment without deleting historical debt', () => {
    const renewed = {
      ...member,
      billingPeriods: [
        { fromPeriod: '2026-10', throughPeriod: '2026-12' },
        { fromPeriod: '2027-03' },
      ],
    };
    expect(overdueClosure(renewed, rows(), '2027-03', new Date('2027-03-20'))).toBeNull();
    expect(
      overdueClosure(renewed, rows(), '2027-06', new Date('2027-06-06T15:00:00Z'))?.throughPeriod,
    ).toBe('2027-05');
  });
  it('does not treat voided months or closed intervals as collectible debt', () => {
    const data = rows();
    data[1].status = 'VOID';
    expect(overdueClosure(member, data, '2027-01', new Date('2027-01-10'))).toBeNull();
    expect(
      overdueClosure(
        { ...member, billingPeriods: [{ fromPeriod: '2026-10', throughPeriod: '2026-12' }] },
        [],
        '2027-03',
        new Date('2027-03-10'),
      ),
    ).toBeNull();
  });
});
