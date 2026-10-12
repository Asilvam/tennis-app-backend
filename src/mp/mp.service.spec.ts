import axios from 'axios';
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
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

  it('exposes default rates without calling Mercado Pago or looking up a reservation', () => {
    const { service, model } = createService(null);
    expect(service.getRates()).toEqual({ currency: 'CLP', nightAmount: 4_000, visitAmount: 7_000, nightVisitAmount: 11_000 });
    expect(model.findOne).not.toHaveBeenCalled();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('exposes configured rates, including an independently configured combined rate', () => {
    const { service } = createService(null, {
      MP_NIGHT_AMOUNT: '5000', MP_VISIT_AMOUNT: '8000', MP_NIGHT_VISIT_AMOUNT: '12000',
    });
    expect(service.getRates()).toEqual({ currency: 'CLP', nightAmount: 5_000, visitAmount: 8_000, nightVisitAmount: 12_000 });
  });

  it.each([
    [true, false, 'nightAmount'],
    [false, true, 'visitAmount'],
    [true, true, 'nightVisitAmount'],
  ])('charges the same configured rate it exposes for night=%s visit=%s', async (isPaidNight, isVisit, rateKey) => {
    const { service } = createService({ idCourtReserve: 'reserve-1', wasPaid: false, isPaidNight, isVisit }, {
      MP_NIGHT_AMOUNT: '5000', MP_VISIT_AMOUNT: '8000', MP_NIGHT_VISIT_AMOUNT: '12000',
    });
    mockedAxios.post.mockResolvedValue({ data: { initPoint: 'https://pay.example' } });
    await service.create({ idCourtReserve: 'reserve-1', amount: 1 } as any);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.any(String), expect.objectContaining({ amount: service.getRates()[rateKey] }), expect.any(Object),
    );
  });

  it.each([
    ['MP_NIGHT_AMOUNT', '0', true, false],
    ['MP_NIGHT_AMOUNT', '-1', true, false],
    ['MP_NIGHT_AMOUNT', '1.5', true, false],
    ['MP_NIGHT_AMOUNT', 'invalid', true, false],
    ['MP_VISIT_AMOUNT', '', false, true],
    ['MP_VISIT_AMOUNT', 'NaN', false, true],
    ['MP_VISIT_AMOUNT', 'Infinity', false, true],
    ['MP_VISIT_AMOUNT', '9007199254740992', false, true],
    ['MP_NIGHT_VISIT_AMOUNT', '0', true, true],
    ['MP_NIGHT_VISIT_AMOUNT', '-100', true, true],
    ['MP_NIGHT_VISIT_AMOUNT', '3.2', true, true],
    ['MP_NIGHT_VISIT_AMOUNT', 'invalid', true, true],
  ])('rejects an invalid configured rate %s=%s for display and payment', async (key, value, isPaidNight, isVisit) => {
    const { service } = createService({ idCourtReserve: 'reserve-1', wasPaid: false, isPaidNight, isVisit }, { [key]: value });
    expect(() => service.getRates()).toThrow(ServiceUnavailableException);
    await expect(service.create({ idCourtReserve: 'reserve-1' } as any)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

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
