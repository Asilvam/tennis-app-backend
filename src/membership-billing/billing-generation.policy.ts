import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { BillingConfiguration, BillingMember, DueStatus } from './billing.types';
import {
  assertBillingStart,
  assertConfiguration,
  assertPaymentPeriod,
  assertPeriod,
  isBillablePeriod,
  memberType,
  monthAt,
  periodsBetween,
  priceFor,
} from './billing.policy';

type GenerationMember = BillingMember & { __v?: number };
type GenerationDue = {
  _id: unknown;
  period: string;
  status: DueStatus;
  amount: number;
  currency: string;
  pricingMode: string;
  tariffVersionId?: string;
  memberTypeSnapshot?: string;
  settlementPaymentId?: unknown;
  paidAt?: Date;
  voided?: unknown;
  archive?: unknown;
};

export function duesGenerationPlan(
  member: GenerationMember,
  existing: GenerationDue[],
  throughPeriod: string,
  config: BillingConfiguration,
  now: Date,
) {
  assertConfiguration(config);
  assertPeriod(throughPeriod);
  assertPaymentPeriod(throughPeriod, now, 'admin');
  if (!member.statePlayer)
    throw new ConflictException('No se generan cuotas para cuentas inactivas.');
  memberType(member);
  const startPeriod = assertBillingStart(member, config);
  if (throughPeriod < startPeriod)
    throw new BadRequestException('El mes final es anterior al inicio.');
  const stored = new Map(existing.map((row) => [row.period, row]));
  const newRows: {
    period: string;
    amount: number;
    currency: string;
    memberTypeSnapshot: string;
    tariffVersionId: string;
    pricingMode: string;
  }[] = [];
  const existingRows: {
    id: string;
    period: string;
    amount: number;
    status: DueStatus;
    currency: string;
  }[] = [];
  const excludedPeriods: string[] = [];
  for (const period of periodsBetween(startPeriod, throughPeriod)) {
    if (!isBillablePeriod(member, period)) {
      excludedPeriods.push(period);
      continue;
    }
    const due = stored.get(period);
    if (due) {
      // Reopening cancelled months belongs to the existing exceptional reenrollment flow.
      if (due.status === 'VOID')
        throw new ConflictException('Una cuota anulada requiere revision de vigencia.');
      existingRows.push({
        id: String(due._id),
        period,
        amount: due.amount,
        status: due.status,
        currency: due.currency,
      });
    } else newRows.push({ period, ...priceFor(member, period, config) });
  }
  const plan = {
    memberId: String(member._id),
    name: member.namePlayer,
    memberType: member.partnerType,
    startPeriod,
    throughPeriod,
    currentPeriod: monthAt(now),
    currency: 'CLP' as const,
    newRows,
    existingRows,
    excludedPeriods,
    newCount: newRows.length,
    existingCount: existingRows.length,
    total: newRows.reduce((sum, row) => sum + row.amount, 0),
  };
  const approvalHash = createHash('sha256')
    .update(
      JSON.stringify({
        plan,
        version: member.__v || 0,
        titularId: String(member.titularId || ''),
        validity: member.billingPeriods,
        prices: {
          tariffs: config.tariffVersions,
          test: config.testPricing,
          dueDay: config.dueDayNextMonth,
        },
        stored: existing.map((row) => ({ ...row, _id: String(row._id) })),
      }),
    )
    .digest('hex');
  return { ...plan, approvalHash };
}
