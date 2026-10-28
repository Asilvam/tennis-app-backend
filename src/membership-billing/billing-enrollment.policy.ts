import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { BillingConfiguration, BillingMember } from './billing.types';
import {
  assertConfiguration,
  assertPeriod,
  isBillablePeriod,
  monthAt,
  periodsBetween,
  priceFor,
} from './billing.policy';

type EnrollmentMember = BillingMember & { __v?: number; billingBaseline?: unknown };
export type EnrollmentState = 'ELIGIBLE' | 'ALREADY_ENABLED' | 'REVIEW_REQUIRED';

export function enrollmentState(
  member: EnrollmentMember,
  hasFinance: boolean,
  titularValid: boolean,
): {
  status: EnrollmentState;
  reason: string;
} {
  if (member.billingStartPeriod && member.billingPeriods?.length) {
    try {
      isBillablePeriod(member, member.billingStartPeriod);
      return {
        status: 'ALREADY_ENABLED',
        reason: 'Mensualidades ya habilitadas; se conservan sin cambios.',
      };
    } catch {
      return { status: 'REVIEW_REQUIRED', reason: 'La vigencia registrada requiere revision.' };
    }
  }
  if (
    member.billingStartPeriod ||
    member.billingBaseline ||
    member.billingPeriods !== undefined ||
    hasFinance
  )
    return {
      status: 'REVIEW_REQUIRED',
      reason: 'Tiene inicio o registros previos; requiere revision sin reemplazarlos.',
    };
  if (!member.statePlayer)
    return {
      status: 'REVIEW_REQUIRED',
      reason: 'Cuenta inactiva; no se habilita automaticamente.',
    };
  if (!['Titular', 'Carga', 'Familiar'].includes(member.partnerType))
    return { status: 'REVIEW_REQUIRED', reason: 'Revisa el tipo de socio.' };
  if (member.partnerType !== 'Titular' && !titularValid)
    return { status: 'REVIEW_REQUIRED', reason: 'La carga necesita un titular valido.' };
  return { status: 'ELIGIBLE', reason: 'Sin inicio ni registros financieros previos.' };
}

export function initialEnrollmentPlan(
  member: EnrollmentMember,
  startPeriod: string,
  config: BillingConfiguration,
  now: Date,
) {
  assertConfiguration(config);
  assertPeriod(startPeriod);
  if (startPeriod < config.billingStartsAtPeriod || startPeriod > monthAt(now))
    throw new BadRequestException(
      'El inicio debe estar entre el inicio del sistema y el mes actual.',
    );
  if (!member.statePlayer) throw new ConflictException('Cuenta inactiva.');
  const rows = periodsBetween(startPeriod, monthAt(now)).map((period) => ({
    period,
    ...priceFor(member, period, config),
  }));
  const plan = {
    memberId: String(member._id),
    name: member.namePlayer,
    memberType: member.partnerType,
    startPeriod,
    throughPeriod: monthAt(now),
    rows,
    total: rows.reduce((sum, row) => sum + row.amount, 0),
    currency: 'CLP',
  };
  const approvalHash = createHash('sha256')
    .update(
      JSON.stringify({
        ...plan,
        version: member.__v || 0,
        titularId: String(member.titularId || ''),
      }),
    )
    .digest('hex');
  return { ...plan, approvalHash };
}
