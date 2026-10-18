import { isDeepStrictEqual } from 'util';
import { assertConfiguration, assertMemberId, priceFor } from './billing.policy';
import { BillingConfiguration, BillingMember, proposedBillingConfiguration } from './billing.types';

export const PILOT_MIGRATION_ID = 'ctq-monthly-test-pilot-2026-10';
export const PILOT_MEMBER_NAMES = ['usuario test 1', 'usuario test 2'];

type PilotMember = BillingMember & {
  billingBaseline?: { migrationId?: string; throughPeriod?: string };
};

export function buildBillingPilotPlan(input: {
  members: PilotMember[];
  memberIds: string[];
  admin: BillingMember;
  existingConfig?: BillingConfiguration | null;
  otherEnrolledCount: number;
  otherFinancialRows: number;
}) {
  const { admin, members, memberIds, existingConfig } = input;
  if (!admin?.statePlayer || admin.role !== 'admin') throw new Error('Active admin required.');
  assertMemberId(String(admin._id));
  if (memberIds.length !== 2 || new Set(memberIds).size !== 2)
    throw new Error('Exactly two distinct, explicitly approved IDs are required.');
  memberIds.forEach(assertMemberId);
  if (members.length !== 2 || members.some((row) => !memberIds.includes(String(row._id))))
    throw new Error('Approved test accounts were not found unambiguously.');
  const names = members.map((row) => row.namePlayer?.trim().toLowerCase()).sort();
  if (!isDeepStrictEqual(names, PILOT_MEMBER_NAMES))
    throw new Error('Only usuario test 1 and usuario test 2 can join this pilot.');
  if (input.otherEnrolledCount || input.otherFinancialRows)
    throw new Error('Other billing data exists; a separately reviewed migration is required.');
  for (const row of members) {
    if (!row.statePlayer || row.role !== 'user') throw new Error('Active test users required.');
    if (
      (row.billingStartPeriod || row.billingBaseline) &&
      (row.billingStartPeriod !== '2026-10' ||
        row.billingBaseline?.migrationId !== PILOT_MIGRATION_ID ||
        row.billingBaseline?.throughPeriod !== '2026-09')
    )
      throw new Error('An existing member baseline cannot be overwritten by the pilot.');
  }
  const config = proposedBillingConfiguration();
  config.testPricing = { enabled: true, memberIds: [...memberIds].sort(), titular: 180, carga: 50 };
  if (existingConfig) {
    assertConfiguration(existingConfig);
    for (const key of Object.keys(config) as (keyof BillingConfiguration)[]) {
      const actual =
        key === 'testPricing'
          ? {
              ...existingConfig.testPricing,
              memberIds: [...existingConfig.testPricing.memberIds].sort(),
            }
          : key === 'tariffVersions'
            ? existingConfig.tariffVersions.map(
                ({ id, effectiveFromPeriod, currency, titular, carga }) => ({
                  id,
                  effectiveFromPeriod,
                  currency,
                  titular,
                  carga,
                }),
              )
            : existingConfig[key];
      if (!isDeepStrictEqual(actual, config[key]))
        throw new Error(`Existing configuration differs at ${key}; refusing to overwrite it.`);
    }
    if (existingConfig.activation?.migrationReviewed)
      throw new Error('A reviewed general migration cannot be replaced by a test pilot.');
  }
  return {
    migrationId: PILOT_MIGRATION_ID,
    throughPeriod: '2026-09',
    startPeriod: '2026-10',
    config,
    createConfig: !existingConfig,
    members: members.map((row) => ({
      id: String(row._id),
      name: row.namePlayer,
      memberType: row.partnerType,
      enroll: !row.billingStartPeriod,
      amount: priceFor(row, '2026-10', config).amount,
    })),
  };
}
