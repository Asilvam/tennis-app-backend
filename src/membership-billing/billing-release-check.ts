import { assertConfiguration, isBillablePeriod, monthAt, priceFor } from './billing.policy';
import { overdueClosure } from './billing-lifecycle.policy';
import { BillingConfiguration, BillingDue, BillingMember } from './billing.types';

type Row = Record<string, any>;
export interface BillingReleaseSnapshot {
  register: Row[];
  membership_dues: Row[];
  membership_payments: Row[];
  membership_billing_config: Row[];
  audit_logs: Row[];
}

// Operational inspection only. A clean report never grants approval or mutates configuration.
export function buildBillingReleaseReport(
  snapshot: BillingReleaseSnapshot,
  pilotIds: string[],
  indexes: Record<string, { key: Row; unique?: boolean }[]>,
  now = new Date(),
) {
  const issues: { code: string; id?: string }[] = [];
  const flag = (code: string, id?: unknown) =>
    issues.push({ code, ...(id ? { id: String(id) } : {}) });
  const config = snapshot.membership_billing_config.find(
    (row) => row.key === 'MONTHLY_MEMBERSHIP',
  ) as BillingConfiguration;
  let validConfig = true;
  try {
    assertConfiguration(config);
  } catch {
    validConfig = false;
    flag('INVALID_CONFIGURATION');
  }
  const required = {
    membership_dues: [['beneficiaryId', 'period']],
    membership_payments: [
      ['publicReference'],
      ['idempotency.actorId', 'idempotency.key'],
      ['provider.name', 'provider.paymentId'],
    ],
    membership_billing_config: [['key']],
    audit_logs: [['eventId']],
  };
  for (const [collection, keys] of Object.entries(required))
    for (const fields of keys)
      if (
        !indexes[collection]?.some(
          (row) => row.unique && Object.keys(row.key).join(',') === fields.join(','),
        )
      )
        flag(`MISSING_UNIQUE_INDEX:${collection}:${fields.join(',')}`);
  if (pilotIds.length !== 2 || new Set(pilotIds).size !== 2) flag('EXACTLY_TWO_PILOT_IDS_REQUIRED');
  if (
    validConfig &&
    (config.testPricing.titular !== 180 ||
      config.testPricing.carga !== 50 ||
      !config.testPricing.enabled ||
      [...config.testPricing.memberIds].sort().join(',') !== [...pilotIds].sort().join(','))
  )
    flag('PILOT_TEST_PRICING_MISMATCH');
  if (config?.autoBlockEnabled || config?.automation?.enabled)
    flag('PILOT_AUTOMATION_NOT_DISABLED');
  if (validConfig) {
    const standard = [...config.tariffVersions]
      .filter((row) => row.effectiveFromPeriod <= monthAt(now))
      .sort((a, b) => b.effectiveFromPeriod.localeCompare(a.effectiveFromPeriod))[0];
    if (standard?.titular !== 18000 || standard?.carga !== 5000) flag('STANDARD_TARIFF_MISMATCH');
  }
  const pilot = pilotIds.map((id) => snapshot.register.find((row) => String(row._id) === id));
  if (pilot.some((row) => !row?.statePlayer || row.role !== 'user'))
    flag('PILOT_ACCOUNT_NOT_ACTIVE_USER');
  if (
    pilot[0]?.namePlayer?.trim().toLowerCase() !== 'usuario test 1' ||
    pilot[0]?.partnerType !== 'Titular' ||
    pilot[1]?.namePlayer?.trim().toLowerCase() !== 'usuario test 2' ||
    pilot[1]?.partnerType !== 'Carga' ||
    String(pilot[1]?.titularId) !== pilotIds[0]
  )
    flag('PILOT_TITULAR_CARGA_MISMATCH');
  const dues = snapshot.membership_dues;
  const payments = snapshot.membership_payments;
  const uniqueDues = new Set<string>();
  const counts: Record<string, number> = {};
  for (const due of dues) {
    counts[due.status] = (counts[due.status] || 0) + 1;
    const key = `${due.beneficiaryId}:${due.period}`;
    if (uniqueDues.has(key)) flag('DUPLICATE_DUE', due._id);
    uniqueDues.add(key);
    const member = snapshot.register.find((row) => String(row._id) === String(due.beneficiaryId));
    if (!member) flag('MISSING_BENEFICIARY', due._id);
    if (due.pricingMode === 'TEST' && !pilotIds.includes(String(due.beneficiaryId)))
      flag('TEST_PRICE_OUTSIDE_PILOT', due._id);
    if (!['OPEN', 'PAID', 'VOID', 'ARCHIVED'].includes(due.status))
      flag('INVALID_DUE_STATUS', due._id);
    if (
      ['VOID', 'ARCHIVED', 'OPEN'].includes(due.status) &&
      (due.paidAt || due.settlementPaymentId)
    )
      flag('NON_PAID_DUE_HAS_SETTLEMENT', due._id);
    if (due.status === 'VOID' && (!due.voided?.at || !due.voided.effectiveAt || !due.voided.reason))
      flag('VOID_EVIDENCE_MISSING', due._id);
    if (
      due.status === 'ARCHIVED' &&
      (!due.archive?.at || !due.archive.approvedBy || !due.archive.reason)
    )
      flag('ARCHIVE_APPROVAL_MISSING', due._id);
    if (due.status === 'PAID') {
      const payment = payments.find((row) => String(row._id) === String(due.settlementPaymentId));
      if (
        !due.paidAt ||
        !payment ||
        !['CONFIRMED', 'REVIEW_REQUIRED'].includes(payment.status) ||
        !payment.allocations?.some(
          (row) => String(row.dueId) === String(due._id) && row.amount === due.amount,
        )
      )
        flag('SETTLEMENT_EVIDENCE_MISMATCH', due._id);
    }
    if (member && due.status === 'OPEN') {
      try {
        if (!isBillablePeriod(member as BillingMember, due.period))
          flag('OPEN_DUE_OUTSIDE_VALIDITY', due._id);
      } catch {
        flag('INVALID_VALIDITY', member._id);
      }
    }
  }
  for (const payment of payments) {
    if (
      !payment.allocations?.length ||
      payment.allocations.reduce((sum, row) => sum + row.amount, 0) !== payment.amount ||
      new Set(payment.allocations.map((row) => String(row.dueId))).size !==
        payment.allocations.length
    )
      flag('PAYMENT_ALLOCATION_MISMATCH', payment._id);
    for (const allocation of payment.allocations || []) {
      const due = dues.find((row) => String(row._id) === String(allocation.dueId));
      if (
        !due ||
        String(due.beneficiaryId) !== String(allocation.beneficiaryId) ||
        due.period !== allocation.period
      )
        flag('ALLOCATION_DUE_MISMATCH', payment._id);
    }
  }
  const active = snapshot.register.filter((row) => row.statePlayer && row.role !== 'admin');
  const withoutStart = active.filter((row) => !row.billingStartPeriod).length;
  const withoutHistory = active.filter(
    (row) => row.billingStartPeriod && !row.billingPeriods?.length,
  ).length;
  const closureCandidates = snapshot.register.filter((row) => {
    try {
      return Boolean(
        overdueClosure(
          row as BillingMember,
          dues.filter((due) => String(due.beneficiaryId) === String(row._id)) as BillingDue[],
          monthAt(now),
          now,
        ),
      );
    } catch {
      flag('INVALID_LIFECYCLE_DATA', row._id);
      return false;
    }
  }).length;
  const attemptsToReview = payments.filter(
    (row) =>
      ['PENDING', 'REVIEW_REQUIRED'].includes(row.status) ||
      ['CREATING', 'UNKNOWN'].includes(row.checkout?.creationStatus),
  ).length;
  const mailToReview = payments
    .flatMap((row) => row.notifications || [])
    .filter((row) => row.status === 'FAILED').length;
  const pilotAmounts = validConfig
    ? pilot.map((member) => {
        try {
          return member ? priceFor(member as BillingMember, monthAt(now), config).amount : null;
        } catch {
          return null;
        }
      })
    : [];
  return {
    mode: 'READ_ONLY',
    generatedAt: now.toISOString(),
    period: monthAt(now),
    approvalRequired: true,
    mutationAllowed: false,
    pilotReadyForReview: !issues.length,
    generalReadyForReview:
      !issues.length && !withoutStart && !withoutHistory && !attemptsToReview && !mailToReview,
    switches: {
      autoBlockEnabled: config?.autoBlockEnabled === true,
      automationEnabled: config?.automation?.enabled === true,
    },
    counts: {
      members: snapshot.register.length,
      dues: dues.length,
      payments: payments.length,
      activeWithoutApprovedStart: withoutStart,
      activeWithoutValidityHistory: withoutHistory,
      closureCandidates,
      attemptsToReview,
      mailToReview,
      duesByStatus: counts,
    },
    pilot: pilotIds.map((id, index) => ({
      id,
      amount: pilotAmounts[index] ?? null,
      currentDueStatus:
        dues.find((due) => String(due.beneficiaryId) === id && due.period === monthAt(now))
          ?.status || 'NOT_GENERATED',
    })),
    issues,
  };
}
