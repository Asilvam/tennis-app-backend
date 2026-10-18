export const BILLING_TIMEZONE = 'America/Santiago';
export const BILLING_CONFIG_KEY = 'MONTHLY_MEMBERSHIP';
export const BILLING_START_PERIOD = '2026-10';

export type PricingMode = 'STANDARD' | 'TEST';
export type BillingMemberType = 'TITULAR' | 'CARGA';
export type DueStatus = 'OPEN' | 'PAID';
export type PaymentMethod = 'MERCADO_PAGO' | 'BANK_TRANSFER' | 'BANK_DEPOSIT';
export type PaymentStatus =
  'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED' | 'REVIEW_REQUIRED' | 'REVERSED';

export interface BillingMember {
  _id: unknown;
  namePlayer: string;
  email: string;
  role: string;
  statePlayer: boolean;
  partnerType: string;
  titularId?: unknown;
  billingStartPeriod?: string;
}

export interface TariffVersion {
  id: string;
  effectiveFromPeriod: string;
  currency: 'CLP';
  titular: number;
  carga: number;
}

export interface BillingConfiguration {
  key: string;
  billingStartsAtPeriod: string;
  timezone: string;
  dueDayNextMonth: number;
  maxAdvanceMonths: number;
  autoBlockEnabled: boolean;
  activation?: { migrationReviewed?: boolean };
  tariffVersions: TariffVersion[];
  testPricing: { enabled: boolean; memberIds: string[]; titular: number; carga: number };
}

export interface BillingDue {
  _id: unknown;
  beneficiaryId: unknown;
  period: string;
  dueAt: Date;
  status: DueStatus;
  amount: number;
  currency: string;
  pricingMode: PricingMode;
}

// A proposal only: callers must explicitly approve and persist configuration/baselines.
export function proposedBillingConfiguration(): BillingConfiguration {
  return {
    key: BILLING_CONFIG_KEY,
    billingStartsAtPeriod: BILLING_START_PERIOD,
    timezone: BILLING_TIMEZONE,
    dueDayNextMonth: 5,
    maxAdvanceMonths: 3,
    autoBlockEnabled: false,
    tariffVersions: [
      {
        id: 'standard-2026-10',
        effectiveFromPeriod: BILLING_START_PERIOD,
        currency: 'CLP',
        titular: 18000,
        carga: 5000,
      },
    ],
    testPricing: { enabled: false, memberIds: [], titular: 180, carga: 50 },
  };
}
