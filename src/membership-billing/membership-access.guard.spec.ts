import { JwtService } from '@nestjs/jwt';
import { MembershipAccessGuard } from './membership-access.guard';

describe('Approved membership access boundary: login identity and booking capability', () => {
  const secret = 'isolated-access-boundary-secret';
  const jwt = new JwtService({ secret });
  let portal: any, guard: MembershipAccessGuard;
  const request = (path: string, method = 'POST', token?: string, extraHeaders = {}) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          path,
          method,
          headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders },
        }),
      }),
    }) as any;
  const token = () => jwt.sign({ email: 'member@example.invalid', role: 'admin' });
  beforeEach(() => {
    portal = {
      enabled: jest.fn(() => true),
      activeAccount: jest.fn().mockResolvedValue({ role: 'user', accountActive: true }),
      access: jest.fn().mockRejectedValue(new Error('Provider availability must not gate access')),
      permissions: jest
        .fn()
        .mockResolvedValue({ financiallyRestricted: false, accountActive: true, role: 'user' }),
    };
    guard = new MembershipAccessGuard(portal, { get: () => secret } as any);
  });
  it('keeps reservation validation even while the portal flag is disabled', async () => {
    portal.enabled.mockReturnValue(false);
    await expect(guard.canActivate(request('/court-reserve'))).rejects.toMatchObject({
      status: 401,
    });
    portal.permissions.mockResolvedValue({ role: 'user', canReserve: false });
    await expect(
      guard.canActivate(request('/court-reserve', 'POST', token())),
    ).rejects.toMatchObject({ status: 403 });
  });
  it.each(['/court-reserve', '/court-reserve/holds', '/booking/multiple', '/mp/init-point'])(
    'requires a JWT on booking/payment writes: %s',
    async (path) => {
      await expect(guard.canActivate(request(path))).rejects.toMatchObject({ status: 401 });
      await expect(guard.canActivate(request(path, 'POST', 'forged'))).rejects.toMatchObject({
        status: 401,
      });
    },
  );
  it('does not treat an x-api-key as a bypass on ordinary booking routes', async () => {
    await expect(
      guard.canActivate(request('/court-reserve', 'POST', undefined, { 'x-api-key': 'some-key' })),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('uses current database permissions rather than the signed role claim', async () => {
    await expect(
      guard.canActivate(request('/court-reserve/adminreserve', 'POST', token())),
    ).rejects.toMatchObject({ status: 403 });
    portal.permissions.mockResolvedValue({ role: 'admin', financiallyRestricted: false });
    expect(await guard.canActivate(request('/court-reserve/adminreserve', 'POST', token()))).toBe(
      true,
    );
  });
  it('allows a debtor to view and operate outside new reservation creation', async () => {
    portal.permissions.mockResolvedValue({
      role: 'user',
      financiallyRestricted: true,
      reason: 'OVERDUE_DUES',
    });
    for (const path of [
      '/membership-billing/me/access',
      '/membership-billing/me/dues',
      '/membership-billing/me/payments',
      '/membership-billing/checkout',
      '/membership-billing/payments/membership-11111111-1111-4111-8111-111111111111/reconcile',
      '/register/profile',
      '/match-ranking/result',
      '/membership-billing/admin/members',
    ])
      expect(await guard.canActivate(request(path, 'POST', token()))).toBe(true);
    for (const path of ['/court-reserve', '/booking/multiple', '/mp/init-point'])
      await expect(guard.canActivate(request(path, 'POST', token()))).rejects.toMatchObject({
        status: 403,
      });
  });
  it('does not revoke identity for a debtor at login or checkBlocked', async () => {
    expect(await guard.canActivate(request('/auth/login'))).toBe(true);
    expect(await guard.canActivate(request('/auth/checkBlocked'))).toBe(true);
    expect(portal.permissions).not.toHaveBeenCalled();
  });
  it('allows reservation return reads but blocks new checkout writes', async () => {
    portal.permissions.mockResolvedValue({ role: 'user', financiallyRestricted: true });
    expect(await guard.canActivate(request('/mp/reservations/abc123/status', 'GET', token()))).toBe(
      true,
    );
    for (const [path, method] of [
      ['/mp/init-point', 'POST'],
      ['/court-reserve', 'POST'],
    ])
      await expect(guard.canActivate(request(path, method, token()))).rejects.toMatchObject({
        status: 403,
      });
  });
  it('leaves internal callbacks to their mandatory internal-key guards', async () => {
    expect(await guard.canActivate(request('/membership-billing/internal/mercado-pago'))).toBe(
      true,
    );
    expect(await guard.canActivate(request('/court-reserve/UpdateStateReserve/fixture'))).toBe(
      true,
    );
  });
  it('rechecks account activity on every authenticated operation, including the portal', async () => {
    portal.activeAccount.mockRejectedValue(Object.assign(new Error('inactive'), { status: 403 }));
    await expect(
      guard.canActivate(request('/membership-billing/me/dues', 'POST', token())),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('checks permissions without provider availability on authenticated reads', async () => {
    expect(
      await guard.canActivate(request('/membership-billing/admin/members', 'GET', token())),
    ).toBe(true);
    expect(portal.activeAccount).toHaveBeenCalledWith('member@example.invalid');
    expect(portal.access).not.toHaveBeenCalled();
  });
  it('permits cancellation of an existing hold but blocks extending/creating a new one', async () => {
    portal.permissions.mockResolvedValue({
      role: 'user',
      canReserve: false,
      reason: 'OVERDUE_DUES',
    });
    expect(
      await guard.canActivate(request('/court-reserve/holds/fixture', 'DELETE', token())),
    ).toBe(true);
    await expect(
      guard.canActivate(request('/court-reserve/holds/fixture', 'PATCH', token())),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'RESERVATION_BLOCKED' },
    });
  });
});
