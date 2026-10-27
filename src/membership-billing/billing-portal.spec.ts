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
  it('retains legacy restrictions and the active administrator exemption', async () => {
    actor.updatePayment = false;
    expect(await portal.permissions(actor.email)).toMatchObject({
      financiallyRestricted: true,
      reason: 'LEGACY_ACCESS_REVIEW',
    });
    actor.role = 'admin';
    expect(await portal.permissions(actor.email)).toMatchObject({
      financiallyRestricted: false,
      role: 'admin',
    });
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
});
