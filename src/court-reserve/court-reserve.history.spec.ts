import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CourtReserveController } from './court-reserve.controller';
import { CourtReserveService } from './court-reserve.service';
import { ReservationHistoryQueryDto } from './dto/reservation-history-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

describe('Own reservation history pagination', () => {
  function fixture(total = 61) {
    const query: any = {};
    for (const method of ['select', 'sort', 'skip', 'limit', 'lean']) query[method] = jest.fn().mockReturnValue(query);
    query.exec = jest.fn().mockResolvedValue([{ idCourtReserve: 'fixture' }]);
    const model: any = {
      countDocuments: jest
        .fn()
        .mockImplementation((filter) => ({ exec: async () => (filter.state === false ? 13 : total) })),
      find: jest.fn().mockReturnValue(query),
    };
    const register: any = {
      findOneByEmail: jest.fn().mockResolvedValue({
        email: 'owner@example.invalid',
        namePlayer: 'Persisted Name',
        statePlayer: true,
        updatePayment: false,
      }),
    };
    const service = new CourtReserveService(model, register, {} as any, {} as any, {} as any, {} as any);
    return { service, query, model, register };
  }

  it('requires JWT and forwards only authenticated identity and validated pagination', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CourtReserveController.prototype.findMyHistory)).toContain(
      JwtAuthGuard,
    );
    const service: any = { getMyReservationHistory: jest.fn() };
    const dto = new ReservationHistoryQueryDto();
    new CourtReserveController(service).findMyHistory(dto, { user: { email: 'session@example.invalid' } });
    expect(service.getMyReservationHistory).toHaveBeenCalledWith('session@example.invalid', dto);
  });

  it('defaults to 25 and supports 50/100 with transformed integer pages', () => {
    expect(new ReservationHistoryQueryDto()).toEqual({ page: 1, pageSize: 25 });
    for (const pageSize of ['25', '50', '100']) {
      const dto = plainToInstance(ReservationHistoryQueryDto, { page: '2', pageSize });
      expect(validateSync(dto)).toHaveLength(0);
      expect(dto.page).toBe(2);
      expect(dto.pageSize).toBe(Number(pageSize));
    }
  });

  it.each([{ page: 0 }, { page: -1 }, { page: 1.5 }, { page: 'bad' }, { page: 100001 }, { pageSize: 500 }])(
    'rejects invalid paging: %j',
    (value) => {
      expect(validateSync(plainToInstance(ReservationHistoryQueryDto, value)).length).toBeGreaterThan(0);
    },
  );

  it('counts the complete own history while fetching only one ordered page', async () => {
    const f = fixture();
    const result = await f.service.getMyReservationHistory('OWNER@example.invalid', { page: 2, pageSize: 25 });
    expect(f.register.findOneByEmail).toHaveBeenCalledWith('owner@example.invalid');
    expect(f.model.find.mock.calls[0][0]).toEqual({
      $or: ['player1', 'player2', 'player3', 'player4'].map((field) => ({ [field]: 'Persisted Name' })),
    });
    expect(f.query.skip).toHaveBeenCalledWith(25);
    expect(f.query.limit).toHaveBeenCalledWith(25);
    expect(f.query.sort).toHaveBeenCalledWith({ dateToPlay: -1, turn: 1, court: 1, _id: 1 });
    expect(f.query.select.mock.calls[0][0]).not.toMatch(/passCourtReserve|ownerEmail|payment/);
    expect(result).toMatchObject({ total: 61, cancelled: 13, page: 2, pageSize: 25, pages: 3 });
  });

  it('clamps obsolete pages and keeps empty history on page one', async () => {
    for (const total of [0, 61]) {
      const f = fixture(total);
      const result = await f.service.getMyReservationHistory('owner@example.invalid', { page: 999, pageSize: 25 });
      expect(result.page).toBe(total ? 3 : 1);
      expect(f.query.skip).toHaveBeenCalledWith(total ? 50 : 0);
    }
  });

  it.each([null, { statePlayer: false }, { statePlayer: true, namePlayer: '' }])(
    'rejects a missing/inactive/unassociated account without reading reservations',
    async (actor) => {
      const f = fixture();
      f.register.findOneByEmail.mockResolvedValue(actor);
      await expect(
        f.service.getMyReservationHistory('owner@example.invalid', new ReservationHistoryQueryDto()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(f.model.find).not.toHaveBeenCalled();
    },
  );
});
