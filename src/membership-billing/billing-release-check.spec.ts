import { Types } from 'mongoose';
import { buildBillingReleaseReport, BillingReleaseSnapshot } from './billing-release-check';
import { proposedBillingConfiguration } from './billing.types';
import { dueAt } from './billing.policy';

const ids = ['100000000000000000000001', '100000000000000000000002'];
const now = new Date('2026-10-27T15:00:00Z');
const indexes = {
  membership_dues: [{ key: { beneficiaryId: 1, period: 1 }, unique: true }],
  membership_payments: [
    { key: { publicReference: 1 }, unique: true },
    { key: { 'idempotency.actorId': 1, 'idempotency.key': 1 }, unique: true },
    { key: { 'provider.name': 1, 'provider.paymentId': 1 }, unique: true },
  ],
  membership_billing_config: [{ key: { key: 1 }, unique: true }],
  audit_logs: [{ key: { eventId: 1 }, unique: true }],
};
function fixture(): BillingReleaseSnapshot {
  const config = proposedBillingConfiguration();
  config.testPricing = { enabled: true, memberIds: ids, titular: 180, carga: 50 };
  return {
    register: ids.map((id, index) => ({
      _id: new Types.ObjectId(id),
      namePlayer: `Usuario test ${index + 1}`,
      statePlayer: true,
      role: 'user',
      partnerType: index ? 'Carga' : 'Titular',
      ...(index ? { titularId: new Types.ObjectId(ids[0]) } : {}),
      billingStartPeriod: '2026-10',
      billingPeriods: [
        {
          fromPeriod: '2026-10',
          approvedAt: now,
          approvedBy: new Types.ObjectId(),
          reason: 'Alta de prueba',
        },
      ],
    })),
    membership_dues: ids.map((id, index) => ({
      _id: new Types.ObjectId(),
      beneficiaryId: new Types.ObjectId(id),
      period: '2026-10',
      dueAt: dueAt('2026-10'),
      status: 'OPEN',
      amount: index ? 50 : 180,
      pricingMode: 'TEST',
    })),
    membership_payments: [],
    membership_billing_config: [config],
    audit_logs: [],
  };
}
describe('Read-only release readiness', () => {
  it('reports pilot prices but never authorizes changes, charges or general activation', () => {
    const input = fixture(),
      before = JSON.stringify(input);
    const report = buildBillingReleaseReport(input, ids, indexes, now);
    expect(report).toMatchObject({
      mode: 'READ_ONLY',
      mutationAllowed: false,
      approvalRequired: true,
      pilotReadyForReview: true,
      issues: [],
      switches: { autoBlockEnabled: false, automationEnabled: false },
    });
    expect(report.pilot.map((row) => row.amount)).toEqual([180, 50]);
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(report)).not.toContain('namePlayer');
  });
  it('does not permit new billing initialization based only on an active account', () => {
    const input = fixture();
    delete input.register[1].billingStartPeriod;
    delete input.register[1].billingPeriods;
    const report = buildBillingReleaseReport(input, ids, indexes, now);
    expect(report.counts.activeWithoutApprovedStart).toBe(1);
    expect(report.generalReadyForReview).toBe(false);
    expect(input.register[1].billingStartPeriod).toBeUndefined();
  });
  it('requires approved validity history before a general release review', () => {
    const input = fixture();
    delete input.register[0].billingPeriods;
    expect(
      buildBillingReleaseReport(input, ids, indexes, now).counts.activeWithoutValidityHistory,
    ).toBe(1);
    expect(buildBillingReleaseReport(input, ids, indexes, now).generalReadyForReview).toBe(false);
  });
  it.each(['autoBlockEnabled', 'automation'])(
    'flags already enabled %s instead of disabling it',
    (key) => {
      const input = fixture();
      const config = input.membership_billing_config[0];
      config.activation = { migrationReviewed: true };
      config[key] =
        key === 'automation' ? { enabled: true, approvedAt: now, approvedBy: 'fixture' } : true;
      expect(
        buildBillingReleaseReport(input, ids, indexes, now).issues.map((row) => row.code),
      ).toContain('PILOT_AUTOMATION_NOT_DISABLED');
      expect(config[key]).toBeTruthy();
    },
  );
  it('rejects incorrect test allowlists, normal rates and a carga assigned to another titular', () => {
    const input = fixture();
    input.membership_billing_config[0].testPricing.memberIds = [ids[0]];
    input.membership_billing_config[0].tariffVersions[0].titular = 180;
    input.register[1].titularId = new Types.ObjectId();
    expect(
      buildBillingReleaseReport(input, ids, indexes, now).issues.map((row) => row.code),
    ).toEqual(
      expect.arrayContaining([
        'PILOT_TEST_PRICING_MISMATCH',
        'STANDARD_TARIFF_MISMATCH',
        'PILOT_TITULAR_CARGA_MISMATCH',
      ]),
    );
  });
  it('requires existing unique indexes without creating them', () => {
    const report = buildBillingReleaseReport(fixture(), ids, {}, now);
    expect(report.pilotReadyForReview).toBe(false);
    expect(report.issues.filter((row) => row.code.startsWith('MISSING_UNIQUE_INDEX'))).toHaveLength(
      6,
    );
  });
  it('detects duplicate dues and test pricing outside the two approved IDs', () => {
    const input = fixture();
    input.membership_dues.push({ ...input.membership_dues[0] });
    input.membership_dues.push({
      ...input.membership_dues[0],
      beneficiaryId: new Types.ObjectId(),
    });
    expect(
      buildBillingReleaseReport(input, ids, indexes, now).issues.map((row) => row.code),
    ).toEqual(
      expect.arrayContaining(['DUPLICATE_DUE', 'TEST_PRICE_OUTSIDE_PILOT', 'MISSING_BENEFICIARY']),
    );
  });
  it('does not report a paid due without a matching confirmed receipt', () => {
    const input = fixture();
    input.membership_dues[0].status = 'PAID';
    expect(
      buildBillingReleaseReport(input, ids, indexes, now).issues.map((row) => row.code),
    ).toContain('SETTLEMENT_EVIDENCE_MISMATCH');
  });
  it('flags mismatched payments and allocations, instead of fixing financial records', () => {
    const input = fixture();
    input.membership_payments.push({
      _id: new Types.ObjectId(),
      amount: 180,
      allocations: [
        { dueId: new Types.ObjectId(), beneficiaryId: ids[0], amount: 50, period: '2026-10' },
      ],
    });
    expect(
      buildBillingReleaseReport(input, ids, indexes, now).issues.map((row) => row.code),
    ).toEqual(expect.arrayContaining(['PAYMENT_ALLOCATION_MISMATCH', 'ALLOCATION_DUE_MISMATCH']));
  });
  it('keeps uncertain attempts and failed email visible without retrying external effects', () => {
    const input = fixture();
    input.membership_payments.push({
      status: 'PENDING',
      amount: 180,
      checkout: { creationStatus: 'UNKNOWN' },
      notifications: [{ status: 'FAILED' }],
      allocations: [
        {
          dueId: input.membership_dues[0]._id,
          beneficiaryId: ids[0],
          amount: 180,
          period: '2026-10',
        },
      ],
    });
    expect(buildBillingReleaseReport(input, ids, indexes, now)).toMatchObject({
      generalReadyForReview: false,
      counts: { attemptsToReview: 1, mailToReview: 1 },
    });
    expect(input.membership_payments[0].status).toBe('PENDING');
  });
});
