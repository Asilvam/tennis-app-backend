import { BillingPortalService } from './billing-portal.service';
import { proposedBillingConfiguration } from './billing.types';

describe('Portal permissions independent of payment-provider availability', () => {
  let actor: any, configuration: any, core: any, provider: any, portal: BillingPortalService;
  beforeEach(() => {
    actor = {
      _id: '100000000000000000000001',
      email: 'member@example.invalid',
      namePlayer: 'Member fixture',
      role: 'user',
      statePlayer: true,
      partnerType: 'Titular',
      updatePayment: true,
    };
    configuration = proposedBillingConfiguration();
    core = {
      assessFinancialAccess: jest
        .fn()
        .mockResolvedValue({ financiallyRestricted: false, overduePeriods: [] }),
    };
    provider = { available: jest.fn().mockResolvedValue(true) };
    portal = new BillingPortalService(
      core,
      { get: () => 'true' } as any,
      { findOne: () => ({ lean: async () => actor }) } as any,
      {} as any,
      { findOne: () => ({ lean: async () => configuration }) } as any,
      () => new Date('2026-10-26T15:00:00Z'),
      provider,
    );
  });
  it('resolves permissions without calling a slow or unresponsive provider', async () => {
    provider.available.mockImplementation(() => new Promise(() => {}));
    expect(await portal.permissions(actor.email)).toMatchObject({
      accountActive: true,
      financiallyRestricted: false,
      role: 'user',
      memberId: actor._id,
    });
    expect(provider.available).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    'retains the provider readiness flag on the portal access response: %s',
    async (ready) => {
      provider.available.mockResolvedValue(ready);
      const permissions = await portal.permissions(actor.email);
      expect(await portal.access(actor.email)).toEqual({ ...permissions, mpEnabled: ready });
      expect(provider.available).toHaveBeenCalledTimes(1);
    },
  );
  it('rechecks current activity without cached permission bypasses', async () => {
    await portal.permissions(actor.email);
    actor.statePlayer = false;
    await expect(portal.permissions(actor.email)).rejects.toMatchObject({ status: 403 });
    expect(provider.available).not.toHaveBeenCalled();
  });
  it('preserves financial restrictions and overdue periods', async () => {
    actor.billingStartPeriod = '2026-10';
    core.assessFinancialAccess.mockResolvedValue({
      financiallyRestricted: true,
      overduePeriods: ['2026-10'],
    });
    expect(await portal.permissions(actor.email)).toMatchObject({
      financiallyRestricted: true,
      reason: 'OVERDUE_DUES',
      overduePeriods: ['2026-10'],
    });
    expect(core.assessFinancialAccess).toHaveBeenCalledWith(actor._id);
    expect(provider.available).not.toHaveBeenCalled();
  });
  it('keeps manual restrictions separate from the active administrator automatic exemption', async () => {
    actor.updatePayment = false;
    expect(await portal.permissions(actor.email)).toMatchObject({
      financiallyRestricted: true,
      reason: 'LEGACY_ACCESS_REVIEW',
    });
    actor.role = 'admin';
    expect(await portal.permissions(actor.email)).toMatchObject({
      financiallyRestricted: true,
      canReserve: false,
      role: 'admin',
    });
    actor.updatePayment = true;
    expect((await portal.permissions(actor.email)).canReserve).toBe(true);
    expect(provider.available).not.toHaveBeenCalled();
  });
  it('fails closed if billing configuration is unavailable', async () => {
    configuration = null;
    await expect(portal.permissions(actor.email)).rejects.toMatchObject({ status: 503 });
    expect(provider.available).not.toHaveBeenCalled();
  });
  it('does not hide failures to calculate financial access', async () => {
    actor.billingStartPeriod = '2026-10';
    core.assessFinancialAccess.mockRejectedValue(new Error('database unavailable'));
    await expect(portal.permissions(actor.email)).rejects.toThrow('database unavailable');
    expect(provider.available).not.toHaveBeenCalled();
  });
  it.each([false, true])('never emits missing months from portal reads (automatic=%s)', async (enabled) => {
    actor.billingStartPeriod = '2026-10';
    configuration.activation = { migrationReviewed: true };
    configuration.automation = {
      enabled,
      approvedAt: new Date('2026-10-01T03:00:00Z'),
      approvedBy: 'admin@example.invalid',
    };
    core.prepareDues = jest.fn().mockRejectedValue(new Error('Reads must not generate dues'));
    const stored = [
      {
        _id: '100000000000000000000002',
        beneficiaryId: actor._id,
        period: '2026-10',
        dueAt: new Date('2026-11-06T03:00:00Z'),
        amount: 180,
        status: 'OPEN',
        pricingMode: 'TEST',
      },
    ];
    portal = new BillingPortalService(
      core,
      { get: () => 'true' } as any,
      {
        findOne: () => ({ lean: async () => actor }),
        find: () => ({ sort: () => ({ lean: async () => [] }) }),
      } as any,
      {
        collection: { indexes: async () => [{ unique: true, key: { beneficiaryId: 1, period: 1 } }] },
        find: () => ({ sort: () => ({ lean: async () => stored }) }),
      } as any,
      { findOne: () => ({ lean: async () => configuration }) } as any,
      () => new Date('2026-12-01T03:00:00Z'),
      provider,
    );
    const response = await portal.home(actor.email);
    expect(response.currentPeriod).toBe('2026-12');
    expect(response.dues.map((row) => row.period)).toEqual(['2026-10']);
    expect(core.prepareDues).not.toHaveBeenCalled();
  });
});
