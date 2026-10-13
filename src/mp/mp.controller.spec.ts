import { GatewayTimeoutException, INestApplication, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { MpController } from './mp.controller';
import { MpService } from './mp.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

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
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate(context) {
      const req = context.switchToHttp().getRequest();
      if (req.headers.authorization !== 'Bearer local-test-session') throw new UnauthorizedException();
      req.user = { email: 'owner@test.cl' };
      return true;
    } }).compile();
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
    await request(app.getHttpServer()).post('/mp/init-point').set('Authorization', 'Bearer local-test-session').send(payload).expect(201).expect({ initPoint: 'https://pay.example' });
    expect(service.create).toHaveBeenCalledWith(payload, 'owner@test.cl');
  });

  it('returns a controlled 504 message to the frontend when preference creation times out', async () => {
    const message = 'Mercado Pago no respondió a tiempo. El enlace de pago podría haberse creado. Revisa tu reserva antes de intentar nuevamente.';
    service.create.mockRejectedValueOnce(new GatewayTimeoutException(message));
    await request(app.getHttpServer()).post('/mp/init-point').set('Authorization', 'Bearer local-test-session').send({ idCourtReserve: 'reserve-1' }).expect(504).expect({
      statusCode: 504, message, error: 'Gateway Timeout',
    });
    expect(service.create).toHaveBeenCalledTimes(1);
  });

  it('does not create a checkout without an authenticated session', async () => {
    await request(app.getHttpServer()).post('/mp/init-point').send({ idCourtReserve: 'reserve-1' }).expect(401);
    expect(service.create).not.toHaveBeenCalled();
  });
});
