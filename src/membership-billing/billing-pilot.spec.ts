import { buildBillingPilotPlan, PILOT_MIGRATION_ID } from './billing-pilot';

describe('Explicit two-account billing pilot', () => {
  const memberIds = ['68ca0d7dbe61eb1818ed0256', '69db05e350b53dd24160517d'];
  const member = (i: number) => ({
    _id: memberIds[i],
    namePlayer: `Usuario test ${i + 1}`,
    email: `test${i}@example.invalid`,
    role: 'user',
    statePlayer: true,
    partnerType: 'Titular',
  });
  const input = () => ({
    memberIds,
    members: [member(0), member(1)],
    admin: { ...member(0), _id: '66b81ccd2583eb6b6628f224', role: 'admin' },
    otherEnrolledCount: 0,
    otherFinancialRows: 0,
  });
  it('enrolls only two explicit IDs, without changing their types or turning on blocking', () => {
    const plan = buildBillingPilotPlan(input());
    expect(plan.members.map((row) => row.amount)).toEqual([180, 180]);
    expect(plan.config.autoBlockEnabled).toBe(false);
    expect(plan.config.testPricing.carga).toBe(50);
    expect(plan.startPeriod).toBe('2026-10');
    expect(plan.throughPeriod).toBe('2026-09');
    expect(plan.config.tariffVersions[0]).toMatchObject({ titular: 18000, carga: 5000 });
  });
  it('uses 50 only if an approved account already is a carga', () => {
    const data = input();
    data.members[1].partnerType = 'Carga';
    expect(buildBillingPilotPlan(data).members[1].amount).toBe(50);
  });
  it('is a no-op for a previously applied matching pilot', () => {
    const data = input();
    const prior = buildBillingPilotPlan(data);
    const plan = buildBillingPilotPlan({
      ...data,
      existingConfig: prior.config,
      members: data.members.map((row) => ({
        ...row,
        billingStartPeriod: '2026-10',
        billingBaseline: { migrationId: PILOT_MIGRATION_ID, throughPeriod: '2026-09' },
      })),
    });
    expect(plan.createConfig).toBe(false);
    expect(plan.members.every((row) => !row.enroll)).toBe(true);
  });
  it('refuses a normal member even if its ID was supplied', () => {
    const data = input();
    data.members[1].namePlayer = 'Another member';
    expect(() => buildBillingPilotPlan(data)).toThrow('Only usuario');
  });
  it('accepts stored tariff subdocument IDs without changing the configuration', () => {
    const config = buildBillingPilotPlan(input()).config;
    Object.assign(config.tariffVersions[0], { _id: 'a-stored-subdocument-id' });
    expect(buildBillingPilotPlan({ ...input(), existingConfig: config }).createConfig).toBe(false);
  });
  it('refuses duplicate IDs', () => {
    expect(() =>
      buildBillingPilotPlan({ ...input(), memberIds: [memberIds[0], memberIds[0]] }),
    ).toThrow('distinct');
  });
  it('refuses missing accounts', () => {
    expect(() => buildBillingPilotPlan({ ...input(), members: [member(0)] })).toThrow(
      'unambiguously',
    );
  });
  it('refuses inactive or non-admin actors', () => {
    const data = input();
    data.admin.role = 'user';
    expect(() => buildBillingPilotPlan(data)).toThrow('Active admin');
    data.admin.role = 'admin';
    data.admin.statePlayer = false;
    expect(() => buildBillingPilotPlan(data)).toThrow('Active admin');
  });
  it('refuses inactive test accounts and unknown membership types', () => {
    const data = input();
    data.members[1].statePlayer = false;
    expect(() => buildBillingPilotPlan(data)).toThrow('Active test');
    data.members[1].statePlayer = true;
    data.members[1].partnerType = '';
    expect(() => buildBillingPilotPlan(data)).toThrow();
  });
  it('refuses an existing different baseline', () => {
    expect(() =>
      buildBillingPilotPlan({
        ...input(),
        members: [member(0), { ...member(1), billingStartPeriod: '2026-08' }],
      }),
    ).toThrow('baseline');
  });
  it('refuses enrollment or financial data outside the pilot', () => {
    expect(() => buildBillingPilotPlan({ ...input(), otherEnrolledCount: 1 })).toThrow(
      'Other billing',
    );
    expect(() => buildBillingPilotPlan({ ...input(), otherFinancialRows: 1 })).toThrow(
      'Other billing',
    );
  });
  it('does not overwrite a changed configuration or test allowlist', () => {
    const config = buildBillingPilotPlan(input()).config;
    config.testPricing.memberIds = [memberIds[0]];
    expect(() => buildBillingPilotPlan({ ...input(), existingConfig: config })).toThrow('differs');
  });
  it('does not disable an already enabled or reviewed general system', () => {
    const config = buildBillingPilotPlan(input()).config;
    config.activation = { migrationReviewed: true };
    expect(() => buildBillingPilotPlan({ ...input(), existingConfig: config })).toThrow(
      'general migration',
    );
    config.autoBlockEnabled = true;
    expect(() => buildBillingPilotPlan({ ...input(), existingConfig: config })).toThrow('differs');
  });
});
