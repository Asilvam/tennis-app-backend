import { addMonths, dueAt, isBillablePeriod, periodsBetween } from './billing.policy';
import { BillingDue, BillingMember } from './billing.types';

// Evaluate payment effectiveness at each historical cutoff, not webhook arrival time.
export function overdueClosure(
  member: BillingMember,
  rows: BillingDue[],
  through: string,
  now: Date,
) {
  if (!member.billingStartPeriod || member.role === 'admin' || !member.statePlayer) return null;
  const current = member.billingPeriods?.at(-1);
  if (current?.throughPeriod) return null;
  const start = current?.fromPeriod || member.billingStartPeriod;
  const byPeriod = new Map(rows.map((row) => [row.period, row]));
  for (const period of periodsBetween(start, through)) {
    const effectiveAt = dueAt(period);
    if (effectiveAt > now) break;
    const periods = [-2, -1, 0].map((offset) => addMonths(period, offset));
    if (periods[0] < start) continue;
    if (
      periods.every((item) => {
        if (!isBillablePeriod(member, item)) return false;
        const row = byPeriod.get(item);
        if (row?.status === 'VOID' || row?.status === 'ARCHIVED') return false;
        return (
          !row ||
          row.status === 'OPEN' ||
          (row.status === 'PAID' && row.paidAt && row.paidAt >= effectiveAt)
        );
      })
    )
      return { throughPeriod: period, effectiveAt, overduePeriods: periods };
  }
  return null;
}
