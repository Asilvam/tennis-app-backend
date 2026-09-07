import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  function createService() {
    const save = jest.fn().mockResolvedValue(undefined);
    const model: any = jest.fn().mockImplementation((data) => ({ ...data, save }));
    model.find = jest.fn();
    model.updateOne = jest.fn();
    const service = new AuditLogService(model);
    return { service, model, save };
  }

  function findQuery(result: unknown[]) {
    return {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(result),
    };
  }

  const reserve = {
    idCourtReserve: 'reserve-1',
    court: 'Cancha 1',
    dateToPlay: '2026-09-10',
    turn: '20:15-22:00',
    player1: 'Player 1',
    player2: 'Player 2',
    player3: undefined,
    player4: undefined,
    isDouble: false,
    isVisit: true,
    isPaidNight: true,
    visitName: 'Visitor',
  };

  beforeEach(() => jest.clearAllMocks());

  it('persists reservation creation details', async () => {
    const { service, model, save } = createService();
    const log = jest.spyOn((service as any).logger, 'log');
    await service.logReserveCreation(reserve, 'ADMIN', 'Admin User', 'admin@example.com');

    expect(model).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'reserve-1',
        action: 'CREATE',
        performedBy: 'ADMIN',
        performedByUser: 'Admin User',
        performedByEmail: 'admin@example.com',
        description: expect.stringContaining('role: admin, email: admin@example.com'),
        metadata: expect.objectContaining({ players: ['Player 1', 'Player 2'], isVisit: true, isPaidNight: true }),
      }),
    );
    expect(save).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      '[AUDIT] Reserve created logged: reserve-1 — role: admin, email: admin@example.com',
    );
  });

  it('persists bulk creation using the default performer', async () => {
    const { service, model } = createService();
    await service.logBulkAdminReserves(3, 'PROFESOR', 'profe@example.com');
    expect(model).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'BULK_OPERATION',
        performedBy: 'PROFESOR',
        performedByEmail: 'profe@example.com',
        metadata: { reservesCount: 3 },
      }),
    );
  });

  it.each([
    [undefined, 'Bloqueado por admin: maintenance'],
    ['weather', 'weather'],
  ])('persists cancellation reasons', async (reason, expectedReason) => {
    const { service, model } = createService();
    await service.logReserveCancellation(
      'reserve-1',
      { ...reserve, blockedMotive: 'maintenance' },
      'ADMIN',
      'Admin',
      reason,
    );
    expect(model).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DELETE',
        metadata: expect.objectContaining({ reason: expectedReason }),
      }),
    );
  });

  it('persists state changes with the default system performer', async () => {
    const { service, model } = createService();
    await service.logStateChange('reserve-1', false, true, true);
    expect(model).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'STATE_CHANGE',
        performedBy: 'SYSTEM',
        beforeData: { state: false },
        afterData: { state: true, wasPaid: true },
      }),
    );
  });

  it('persists payment confirmations', async () => {
    const { service, model } = createService();
    await service.logPaymentConfirmation('reserve-1', 'approved');
    expect(model).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PAYMENT_CONFIRMATION',
        performedBy: 'SYSTEM',
        metadata: { paymentStatus: 'approved' },
      }),
    );
  });

  it('persists match result updates with both default and explicit performers', async () => {
    const { service, model } = createService();
    await service.logMatchResultUpdate('reserve-1');
    await service.logMatchResultUpdate('reserve-2', 'Player 2');
    expect(model).toHaveBeenNthCalledWith(1, expect.objectContaining({ performedByUser: 'USER' }));
    expect(model).toHaveBeenNthCalledWith(2, expect.objectContaining({ performedByUser: 'Player 2' }));
  });

  it.each([
    ['logReserveCreation', [reserve, 'USER']],
    ['logBulkAdminReserves', [1]],
    ['logReserveCancellation', ['reserve-1', reserve, 'USER']],
    ['logStateChange', ['reserve-1', false, true, false]],
    ['logPaymentConfirmation', ['reserve-1', 'approved']],
    ['logMatchResultUpdate', ['reserve-1']],
  ])('swallows persistence failures from %s so business actions continue', async (method, args) => {
    const { service, save } = createService();
    save.mockRejectedValue(new Error('Mongo unavailable'));
    await expect((service as any)[method](...args)).resolves.toBeUndefined();
  });

  it('queries audits by reserve, date range, action and user', async () => {
    const { service, model } = createService();
    const query = findQuery([{ entityId: 'reserve-1' }]);
    model.find.mockReturnValue(query);
    const start = new Date('2026-09-01');
    const end = new Date('2026-09-30');

    await service.getAuditsByReserve('reserve-1');
    expect(model.find).toHaveBeenLastCalledWith({ entityId: 'reserve-1' });
    await service.getAuditsByDateRange(start, end);
    expect(model.find).toHaveBeenLastCalledWith({ timestamp: { $gte: start, $lte: end } });
    await service.getAuditsByAction('DELETE');
    expect(model.find).toHaveBeenLastCalledWith({ action: 'DELETE' });
    expect(query.limit).toHaveBeenCalledWith(100);
    await service.getAuditsByUser('Player 1');
    expect(model.find).toHaveBeenLastCalledWith({ performedByUser: 'Player 1' });
  });

  it.each([
    [undefined, undefined, { action: 'DELETE' }],
    [new Date('2026-09-01'), undefined, { action: 'DELETE', timestamp: { $gte: new Date('2026-09-01') } }],
    [undefined, new Date('2026-09-30'), { action: 'DELETE', timestamp: { $lte: new Date('2026-09-30') } }],
    [
      new Date('2026-09-01'),
      new Date('2026-09-30'),
      { action: 'DELETE', timestamp: { $gte: new Date('2026-09-01'), $lte: new Date('2026-09-30') } },
    ],
  ])('builds cancellation report date filters', async (start, end, expectedQuery) => {
    const { service, model } = createService();
    const logs = [
      { performedBy: 'ADMIN', metadata: { reason: 'weather' } },
      { performedBy: 'PROFESOR', metadata: {} },
      { performedBy: 'USER', metadata: {} },
      { performedBy: 'SYSTEM' },
    ];
    model.find.mockReturnValue(findQuery(logs));

    await expect(service.getCancellationReport(start, end)).resolves.toEqual({
      total: 4,
      byAdmin: 1,
      byProfesor: 1,
      byUser: 1,
      bySystem: 1,
      withReason: 1,
      logs,
    });
    expect(model.find).toHaveBeenCalledWith(expectedQuery);
  });

  it.each([
    [undefined, undefined, { action: { $in: ['CREATE', 'ADMIN_CREATE', 'ADMIN_BULK_CREATE'] } }],
    [
      new Date('2026-09-01'),
      new Date('2026-09-30'),
      {
        action: { $in: ['CREATE', 'ADMIN_CREATE', 'ADMIN_BULK_CREATE'] },
        timestamp: { $gte: new Date('2026-09-01'), $lte: new Date('2026-09-30') },
      },
    ],
  ])('builds creation reports and aggregates metadata', async (start, end, expectedQuery) => {
    const { service, model } = createService();
    const logs = [
      { performedBy: 'ADMIN', metadata: { isPaidNight: true, isVisit: true, isDouble: true } },
      { performedBy: 'PROFESOR', metadata: {} },
      { performedBy: 'USER', metadata: {} },
    ];
    model.find.mockReturnValue(findQuery(logs));

    await expect(service.getCreationReport(start, end)).resolves.toEqual({
      total: 3,
      byAdmin: 1,
      byProfesor: 1,
      byUser: 1,
      paidNight: 1,
      withVisit: 1,
      doubles: 1,
      logs,
    });
    expect(model.find).toHaveBeenCalledWith(expectedQuery);
  });

  it.each([undefined, 7])('aggregates general statistics for the requested period', async (days) => {
    const { service, model } = createService();
    const logs = [
      { action: 'CREATE', performedBy: 'USER' },
      { action: 'ADMIN_CREATE', performedBy: 'ADMIN' },
      { action: 'CREATE', performedBy: 'PROFESOR' },
      { action: 'DELETE', performedBy: 'SYSTEM' },
      { action: 'STATE_CHANGE', performedBy: 'SYSTEM' },
      { action: 'PAYMENT_CONFIRMATION', performedBy: 'SYSTEM' },
    ];
    model.find.mockReturnValue({ exec: jest.fn().mockResolvedValue(logs) });

    const result = await service.getGeneralStats(days);
    expect(result).toEqual({
      period: `Last ${days ?? 30} days`,
      total: 6,
      creates: 3,
      deletes: 1,
      stateChanges: 1,
      paymentConfirmations: 1,
      byPerformer: { user: 1, admin: 1, profesor: 1, system: 3 },
    });
    expect(model.find).toHaveBeenCalledWith({ timestamp: { $gte: expect.any(Date) } });
  });
});
