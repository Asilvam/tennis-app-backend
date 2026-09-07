import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BookingService } from './booking.service';

describe('BookingService', () => {
  const courtReserveService = {
    adminReserve: jest.fn(),
  };
  const registerService = {
    findOneByEmail: jest.fn(),
  };
  const service = new BookingService(courtReserveService as any, registerService as any);

  const dto = {
    courts: ['Cancha 1'],
    dates: ['2026-09-10'],
    turns: ['08:15-10:00'],
    motive: 'Campeonato',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    courtReserveService.adminReserve.mockImplementation(async (bookings) => bookings);
  });

  it('keeps the selected motive for an administrator', async () => {
    const result = await service.createMultiple(dto, { email: 'admin@example.com', role: 'admin' });

    expect(result).toEqual([
      expect.objectContaining({
        blockedMotive: 'Campeonato',
        player1: 'Campeonato',
      }),
    ]);
    expect(registerService.findOneByEmail).not.toHaveBeenCalled();
  });

  it('forces classes and the account name for a professor', async () => {
    registerService.findOneByEmail.mockResolvedValue({ namePlayer: 'V. Saavedra' });

    const result = await service.createMultiple(dto, { email: 'PROFE@example.com', role: 'profesor' });

    expect(registerService.findOneByEmail).toHaveBeenCalledWith('profe@example.com');
    expect(result).toEqual([
      expect.objectContaining({
        blockedMotive: 'Clases - V. Saavedra',
        player1: 'Clases - V. Saavedra',
      }),
    ]);
  });

  it('rejects roles without multi-booking permission', async () => {
    await expect(service.createMultiple(dto, { email: 'user@example.com', role: 'user' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(courtReserveService.adminReserve).not.toHaveBeenCalled();
  });

  it('rejects a professor account without an associated name', async () => {
    registerService.findOneByEmail.mockResolvedValue(null);

    await expect(
      service.createMultiple(dto, { email: 'missing@example.com', role: 'profesor' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(courtReserveService.adminReserve).not.toHaveBeenCalled();
  });
});
