import { CourtReserveService } from './court-reserve.service';

describe('CourtReserveService audit identity', () => {
  const reservation = {
    idCourtReserve: 'reserve-1',
    court: 'Cancha 1',
    dateToPlay: '2026-09-10',
    turn: '08:15-10:00',
    player1: 'Campeonato - A. Silva vs J. Millar',
    blockedMotive: 'Campeonato - A. Silva vs J. Millar',
  };

  function createService() {
    const savedReservation = {
      ...reservation,
      toObject: jest.fn().mockReturnValue(reservation),
    };
    const courtReserveModel: any = jest.fn().mockImplementation(() => ({
      save: jest.fn().mockResolvedValue(savedReservation),
    }));
    courtReserveModel.findOne = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    });
    courtReserveModel.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 0 });

    const auditLogService = {
      logReserveCreation: jest.fn().mockResolvedValue(undefined),
      logBulkAdminReserves: jest.fn().mockResolvedValue(undefined),
    };
    const service = new CourtReserveService(
      courtReserveModel,
      {} as any,
      {} as any,
      auditLogService as any,
    );

    return { service, auditLogService };
  }

  it.each([
    ['admin', 'ADMIN', 'Admin Bulk Operation', 'admin@example.com'],
    ['profesor', 'PROFESOR', reservation.player1, 'profe@example.com'],
  ])('persists the authenticated %s identity for multiple bookings', async (role, auditRole, userName, email) => {
    const { service, auditLogService } = createService();

    await service.adminReserve([reservation] as any, { role, email: email.toUpperCase() });

    expect(auditLogService.logReserveCreation).toHaveBeenCalledWith(
      reservation,
      auditRole,
      userName,
      email,
    );
    expect(auditLogService.logBulkAdminReserves).toHaveBeenCalledWith(1, auditRole, email);
  });
});
