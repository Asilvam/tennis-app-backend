import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { MpController } from './mp.controller';
import { MpService } from './mp.service';

describe('MpController rates endpoint', () => {
  let app: INestApplication;
  const rates = { currency: 'CLP', nightAmount: 5000, visitAmount: 8000, nightVisitAmount: 12000 };
  const service = { getRates: jest.fn(), create: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    service.getRates.mockReturnValue(rates);
    const module = await Test.createTestingModule({
      controllers: [MpController],
      providers: [{ provide: MpService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it('returns backend rates without caching or creating a payment', async () => {
    await request(app.getHttpServer()).get('/mp/rates').expect(200).expect('Cache-Control', 'no-store').expect(rates);
    expect(service.getRates).toHaveBeenCalledTimes(1);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('returns 503 instead of exposing an invalid rate', async () => {
    service.getRates.mockImplementation(() => { throw new ServiceUnavailableException('Invalid payment rate'); });
    await request(app.getHttpServer()).get('/mp/rates').expect(503);
  });

  it('keeps the existing preference endpoint unchanged', async () => {
    const payload = { idCourtReserve: 'reserve-1', amount: 1 };
    service.create.mockResolvedValue({ initPoint: 'https://pay.example' });
    await request(app.getHttpServer()).post('/mp/init-point').send(payload).expect(201).expect({ initPoint: 'https://pay.example' });
    expect(service.create).toHaveBeenCalledWith(payload);
  });
});
