import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import {
  BillingConfiguration,
  BillingDue,
  BillingMember,
  BillingMemberType,
  BILLING_CONFIG_KEY,
  BILLING_TIMEZONE,
} from './billing.types';

export function assertPeriod(period: string): void {
  if (typeof period !== 'string' || !/^[2-9]\d{3}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new BadRequestException('El periodo debe tener formato YYYY-MM.');
  }
}

export function assertMemberId(id: string): void {
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id) || !Types.ObjectId.isValid(id)) {
    throw new BadRequestException('Identificador de socio invalido.');
  }
}

export function assertAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0)
    throw new BadRequestException('El monto debe ser un entero CLP positivo.');
}

export function monthAt(now: Date): string {
  const date = DateTime.fromJSDate(now, { zone: BILLING_TIMEZONE });
  if (!date.isValid) throw new BadRequestException('Fecha invalida.');
  return date.toFormat('yyyy-MM');
}

export function addMonths(period: string, months: number): string {
  assertPeriod(period);
  if (!Number.isSafeInteger(months)) throw new BadRequestException('Cantidad de meses invalida.');
  return DateTime.fromISO(`${period}-01`, { zone: BILLING_TIMEZONE })
    .plus({ months })
    .toFormat('yyyy-MM');
}

export function assertPaymentPeriod(period: string, now: Date, role: string): void {
  assertPeriod(period);
  const latest = addMonths(monthAt(now), role === 'admin' ? 3 : 0);
  if (period > latest)
    throw new BadRequestException(
      role === 'admin'
        ? 'Solo puedes adelantar tres meses ademas del actual.'
        : 'Solo puedes pagar mensualidades atrasadas y del mes actual.',
    );
}

export function periodsBetween(first: string, last: string): string[] {
  assertPeriod(first);
  assertPeriod(last);
  if (first > last) return [];
  const count =
    Math.round(
      DateTime.fromISO(`${last}-01`).diff(DateTime.fromISO(`${first}-01`), 'months').months,
    ) + 1;
  return Array.from({ length: count }, (_, i) => addMonths(first, i));
}

export function dueAt(period: string): Date {
  return DateTime.fromISO(`${addMonths(period, 1)}-06T00:00:00`, { zone: BILLING_TIMEZONE })
    .toUTC()
    .toJSDate();
}

export function assertConfiguration(config: BillingConfiguration): void {
  if (
    !config ||
    config.key !== BILLING_CONFIG_KEY ||
    config.timezone !== BILLING_TIMEZONE ||
    config.dueDayNextMonth !== 5 ||
    config.maxAdvanceMonths !== 3 ||
    typeof config.autoBlockEnabled !== 'boolean'
  ) {
    throw new ServiceUnavailableException('Configuracion de mensualidades no disponible.');
  }
  assertPeriod(config.billingStartsAtPeriod);
  if (
    config.automation &&
    (typeof config.automation.enabled !== 'boolean' ||
      (config.automation.enabled &&
        (!config.activation?.migrationReviewed ||
          !config.automation.approvedBy?.trim() ||
          !Number.isFinite(new Date(config.automation.approvedAt || NaN).getTime()))))
  )
    throw new ServiceUnavailableException('La automatizacion requiere revision y aprobacion.');
  if (config.autoBlockEnabled && !config.activation?.migrationReviewed)
    throw new ServiceUnavailableException('La migracion debe revisarse antes de activar bloqueos.');
  if (
    !config.tariffVersions?.length ||
    !config.testPricing ||
    typeof config.testPricing.enabled !== 'boolean'
  ) {
    throw new ServiceUnavailableException('Tarifas de mensualidades no disponibles.');
  }
  const ids = new Set<string>();
  const starts = new Set<string>();
  for (const tariff of config.tariffVersions) {
    assertPeriod(tariff.effectiveFromPeriod);
    if (
      !tariff.id ||
      ids.has(tariff.id) ||
      starts.has(tariff.effectiveFromPeriod) ||
      tariff.currency !== 'CLP'
    )
      throw new ServiceUnavailableException('Version de tarifa invalida.');
    ids.add(tariff.id);
    starts.add(tariff.effectiveFromPeriod);
    assertAmount(tariff.titular);
    assertAmount(tariff.carga);
  }
  assertAmount(config.testPricing.titular);
  assertAmount(config.testPricing.carga);
  if (
    !Array.isArray(config.testPricing.memberIds) ||
    new Set(config.testPricing.memberIds).size !== config.testPricing.memberIds.length
  )
    throw new ServiceUnavailableException('Lista de socios de prueba invalida.');
  config.testPricing.memberIds.forEach(assertMemberId);
  if (config.testPricing.enabled && !config.testPricing.memberIds.length)
    throw new ServiceUnavailableException('Faltan los IDs autorizados para pruebas.');
}

export function memberType(member: BillingMember): BillingMemberType {
  if (member.partnerType === 'Titular') return 'TITULAR';
  if (member.partnerType === 'Carga' || member.partnerType === 'Familiar') return 'CARGA';
  throw new ConflictException('El socio requiere revision de su tipo de membresia.');
}

export function assertCanManage(actor: BillingMember, beneficiary: BillingMember): void {
  if (!actor?.statePlayer) throw new ForbiddenException('La cuenta no esta activa.');
  if (actor.role === 'admin' || String(actor._id) === String(beneficiary._id)) return;
  if (
    actor.partnerType === 'Titular' &&
    memberType(beneficiary) === 'CARGA' &&
    String(beneficiary.titularId) === String(actor._id)
  )
    return;
  throw new ForbiddenException('No puedes gestionar mensualidades de este socio.');
}

export function priceFor(member: BillingMember, period: string, config: BillingConfiguration) {
  assertConfiguration(config);
  assertPeriod(period);
  const version = [...config.tariffVersions]
    .filter((item) => item.effectiveFromPeriod <= period)
    .sort((a, b) => b.effectiveFromPeriod.localeCompare(a.effectiveFromPeriod))[0];
  if (!version) throw new ConflictException('No existe tarifa para el periodo solicitado.');
  const type = memberType(member);
  const test =
    config.testPricing.enabled && config.testPricing.memberIds.includes(String(member._id));
  const rates = test ? config.testPricing : version;
  return {
    amount: type === 'TITULAR' ? rates.titular : rates.carga,
    currency: 'CLP' as const,
    memberTypeSnapshot: type,
    tariffVersionId: version.id,
    pricingMode: test ? ('TEST' as const) : ('STANDARD' as const),
  };
}

export function assertBillingStart(member: BillingMember, config: BillingConfiguration): string {
  if (!member.billingStartPeriod)
    throw new ConflictException('El socio no tiene un inicio de facturacion aprobado.');
  assertPeriod(member.billingStartPeriod);
  if (member.billingStartPeriod < config.billingStartsAtPeriod)
    throw new ConflictException('El inicio del socio es anterior al inicio del sistema.');
  return member.billingStartPeriod;
}

export function isBillablePeriod(member: BillingMember, period: string): boolean {
  assertPeriod(period);
  if (member.billingPeriods === undefined) return true;
  if (!Array.isArray(member.billingPeriods) || !member.billingPeriods.length)
    throw new ConflictException('El historial de vigencia requiere revision administrativa.');
  let previousEnd: string | undefined;
  for (const [index, interval] of member.billingPeriods.entries()) {
    assertPeriod(interval.fromPeriod);
    if (interval.throughPeriod !== undefined) assertPeriod(interval.throughPeriod);
    if (
      (index === 0 && interval.fromPeriod !== member.billingStartPeriod) ||
      (interval.throughPeriod && interval.throughPeriod < interval.fromPeriod) ||
      (index > 0 && (!previousEnd || interval.fromPeriod <= previousEnd))
    )
      throw new ConflictException('El historial de vigencia requiere revision administrativa.');
    previousEnd = interval.throughPeriod;
  }
  return member.billingPeriods.some(
    (interval) =>
      interval.fromPeriod <= period &&
      (!interval.throughPeriod || period <= interval.throughPeriod),
  );
}

export function assertPaymentSelection(
  selected: BillingDue[],
  allDues: BillingDue[],
  now: Date,
): number {
  if (
    !selected.length ||
    new Set(selected.map((item) => String(item._id))).size !== selected.length
  )
    throw new BadRequestException('Selecciona cuotas sin duplicados.');
  if (selected.some((item) => item.status !== 'OPEN'))
    throw new ConflictException('Una cuota seleccionada ya fue pagada.');
  if (new Set(selected.map((item) => item.pricingMode)).size !== 1)
    throw new BadRequestException('No se pueden mezclar cuotas de prueba con cuotas generales.');
  const latest = addMonths(monthAt(now), 3);
  const beneficiaries = [...new Set(selected.map((item) => String(item.beneficiaryId)))];
  for (const id of beneficiaries) {
    const rows = selected.filter((item) => String(item.beneficiaryId) === id);
    rows.forEach((item) => {
      assertPeriod(item.period);
      assertAmount(item.amount);
      if (item.currency !== 'CLP' || item.period > latest)
        throw new BadRequestException('Cuota fuera de la ventana de pago permitida.');
    });
    const last = rows
      .map((item) => item.period)
      .sort()
      .at(-1);
    const wanted = new Set(rows.map((item) => String(item._id)));
    if (
      allDues.some(
        (item) =>
          String(item.beneficiaryId) === id &&
          item.status === 'OPEN' &&
          item.period <= last &&
          !wanted.has(String(item._id)),
      )
    )
      throw new ConflictException('Debes pagar primero los meses impagos anteriores.');
  }
  const amount = selected.reduce((total, item) => total + item.amount, 0);
  assertAmount(amount);
  return amount;
}

export function financialAccess(
  member: BillingMember,
  dues: BillingDue[],
  config: BillingConfiguration,
  now: Date,
) {
  assertConfiguration(config);
  monthAt(now);
  const overdue = dues.filter(
    (item) =>
      String(item.beneficiaryId) === String(member._id) &&
      item.status === 'OPEN' &&
      item.dueAt.getTime() <= now.getTime(),
  );
  const exempt = member.role === 'admin';
  return {
    accountActive: member.statePlayer,
    hasOverdueDues: overdue.length > 0,
    overduePeriods: overdue.map((item) => item.period).sort(),
    exempt,
    financiallyRestricted:
      member.statePlayer && config.autoBlockEnabled && !exempt && overdue.length > 0,
  };
}
