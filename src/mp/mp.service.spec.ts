import axios from 'axios';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MpService } from './mp.service';

jest.mock('axios');

describe('MpService', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;

  function createService(reserve: Record<string, unknown> | null, config: Record<string, string> = {}) {
    const query = {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(reserve),
    };
    const model = { findOne: jest.fn().mockReturnValue(query) };
    const values = {
      MP_API_URL: 'https://mp.internal',
      INTERNAL_API_KEY: 'internal-secret',
      ...config,
    };
    const configService = {
      get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
    };
    return { service: new MpService(configService as any, model as any), model };
  }

  beforeEach(() => jest.clearAllMocks());

  it.each([
    [{ isPaidNight: true, isVisit: false }, 4_000],
    [{ isPaidNight: false, isVisit: true }, 7_000],
    [{ isPaidNight: true, isVisit: true }, 11_000],
  ])('derives the trusted amount from the persisted reservation', async (flags, expectedAmount) => {
    const reserve = {
      idCourtReserve: 'reserve-1',
      court: 'court-from-db',
      dateToPlay: '2026-09-01',
      turn: '20:15-22:00',
      player1: 'Player from DB',
      wasPaid: false,
      ...flags,
    };
    const { service } = createService(reserve);
    mockedAxios.post.mockResolvedValue({ data: { initPoint: 'https://pay.example' } });

    await service.create({
      courtId: 'forged-court',
      date: '2000-01-01',
      time: '00:00',
      player1: 'Forged player',
      amount: 1,
      idCourtReserve: 'reserve-1',
    });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://mp.internal/create-preference',
      expect.objectContaining({
        courtId: 'court-from-db',
        player1: 'Player from DB',
        amount: expectedAmount,
      }),
      expect.objectContaining({ headers: { 'x-api-key': 'internal-secret' } }),
    );
  });

  it('rejects a missing reservation', async () => {
    const { service } = createService(null);
    await expect(service.create({ idCourtReserve: 'missing' } as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an already paid reservation', async () => {
    const { service } = createService({ idCourtReserve: 'reserve-1', wasPaid: true });
    await expect(service.create({ idCourtReserve: 'reserve-1' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a reservation that does not require payment', async () => {
    const { service } = createService({
      idCourtReserve: 'reserve-1',
      wasPaid: false,
      isPaidNight: false,
      isVisit: false,
    });
    await expect(service.create({ idCourtReserve: 'reserve-1' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});
