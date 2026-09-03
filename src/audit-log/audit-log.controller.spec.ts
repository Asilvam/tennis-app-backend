import { AuditLogController } from './audit-log.controller';

describe('AuditLogController', () => {
  const service = {
    getAuditsByReserve: jest.fn(),
    getAuditsByDateRange: jest.fn(),
    getAuditsByAction: jest.fn(),
    getAuditsByUser: jest.fn(),
    getCancellationReport: jest.fn(),
    getCreationReport: jest.fn(),
    getGeneralStats: jest.fn(),
  };
  const controller = new AuditLogController(service as any);

  beforeEach(() => jest.clearAllMocks());

  it('delegates reserve, action and user queries', async () => {
    service.getAuditsByReserve.mockResolvedValue([]);
    service.getAuditsByAction.mockResolvedValue([]);
    service.getAuditsByUser.mockResolvedValue([]);

    await controller.getAuditsByReserve('reserve-1');
    await controller.getAuditsByAction('DELETE');
    await controller.getAuditsByUser('Player');

    expect(service.getAuditsByReserve).toHaveBeenCalledWith('reserve-1');
    expect(service.getAuditsByAction).toHaveBeenCalledWith('DELETE');
    expect(service.getAuditsByUser).toHaveBeenCalledWith('Player');
  });

  it('converts date-range query strings to dates', async () => {
    service.getAuditsByDateRange.mockResolvedValue([]);
    await controller.getAuditsByDateRange('2026-09-01', '2026-09-30');
    expect(service.getAuditsByDateRange).toHaveBeenCalledWith(new Date('2026-09-01'), new Date('2026-09-30'));
  });

  it.each([
    [undefined, undefined],
    ['2026-09-01', undefined],
    [undefined, '2026-09-30'],
    ['2026-09-01', '2026-09-30'],
  ])('maps optional cancellation report dates', async (start, end) => {
    service.getCancellationReport.mockResolvedValue({ total: 0 });
    await controller.getCancellationReport(start, end);
    expect(service.getCancellationReport).toHaveBeenCalledWith(
      start ? new Date(start) : undefined,
      end ? new Date(end) : undefined,
    );
  });

  it.each([
    [undefined, undefined],
    ['2026-09-01', '2026-09-30'],
  ])('maps optional creation report dates', async (start, end) => {
    service.getCreationReport.mockResolvedValue({ total: 0 });
    await controller.getCreationReport(start, end);
    expect(service.getCreationReport).toHaveBeenCalledWith(
      start ? new Date(start) : undefined,
      end ? new Date(end) : undefined,
    );
  });

  it.each([
    [undefined, 30],
    ['7', 7],
  ])('parses the general statistics period', async (days, expected) => {
    service.getGeneralStats.mockResolvedValue({ total: 0 });
    await controller.getGeneralStats(days);
    expect(service.getGeneralStats).toHaveBeenCalledWith(expected);
  });
});
