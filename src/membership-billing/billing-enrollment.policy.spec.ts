import { enrollmentState, initialEnrollmentPlan } from './billing-enrollment.policy';
import { proposedBillingConfiguration } from './billing.types';
const member = () => ({
  _id: '100000000000000000000001',
  namePlayer: 'Fixture',
  role: 'user',
  email: 'fixture@example.invalid',
  statePlayer: true,
  partnerType: 'Titular',
});
describe('Enrollment eligibility and shared previews', () => {
  it('permits an active member without financial or baseline records', () => {
    expect(enrollmentState(member(), false, false).status).toBe('ELIGIBLE');
  });
  it('never replaces a reviewed enrollment even if the member later became inactive', () => {
    expect(
      enrollmentState(
        {
          ...member(),
          statePlayer: false,
          billingStartPeriod: '2026-10',
          billingPeriods: [{ fromPeriod: '2026-10' }],
        },
        true,
        false,
      ).status,
    ).toBe('ALREADY_ENABLED');
  });
  it.each([
    { statePlayer: false },
    { partnerType: 'Unknown' },
    { billingStartPeriod: '2026-10' },
    { billingBaseline: {} },
    { billingPeriods: [] },
    { partnerType: 'Carga' },
  ])('reviews ambiguous data %j', (change) => {
    expect(enrollmentState({ ...member(), ...change }, false, false).status).toBe(
      'REVIEW_REQUIRED',
    );
  });
  it('reviews financial records instead of treating them as a fresh activation', () => {
    expect(enrollmentState(member(), true, true).status).toBe('REVIEW_REQUIRED');
  });
  it('permits a carga only with a validated titular', () => {
    expect(enrollmentState({ ...member(), partnerType: 'Carga' }, false, true).status).toBe(
      'ELIGIBLE',
    );
  });
  it('computes prices on server and fingerprints member changes', () => {
    const config = proposedBillingConfiguration(),
      now = new Date('2026-10-27');
    expect(initialEnrollmentPlan(member(), '2026-10', config, now).total).toBe(18000);
    expect(
      initialEnrollmentPlan({ ...member(), partnerType: 'Carga' }, '2026-10', config, now).total,
    ).toBe(5000);
    expect(
      initialEnrollmentPlan({ ...member(), __v: 2 }, '2026-10', config, now).approvalHash,
    ).not.toBe(initialEnrollmentPlan(member(), '2026-10', config, now).approvalHash);
    expect(() => initialEnrollmentPlan(member(), '2026-11', config, now)).toThrow();
  });
});
