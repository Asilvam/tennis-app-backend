import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { RegisterController } from './register.controller';
import { RegisterService } from './register.service';
import { PASSWORD_RESET_REQUEST_MESSAGE, PasswordRecoveryService } from './password-recovery.service';

describe('Password recovery HTTP contracts', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const secret = 'isolated-recovery-http-secret';
  const service = { requestReset: jest.fn(), confirmReset: jest.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret })],
      controllers: [RegisterController],
      providers: [JwtStrategy, { provide: ConfigService, useValue: { get: () => secret } }, { provide: RegisterService, useValue: {} }, { provide: CloudinaryService, useValue: {} }, { provide: PasswordRecoveryService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
    jwt = module.get(JwtService);
  });
  beforeEach(() => {
    jest.resetAllMocks();
    service.requestReset.mockResolvedValue({ success: true, message: PASSWORD_RESET_REQUEST_MESSAGE });
    service.confirmReset.mockResolvedValue({ success: true, message: 'Contraseña actualizada.' });
  });
  afterAll(async () => app.close());

  it.each(['password-recovery', 'resetpass'])('allows unauthenticated %s to request a link, never a new password', async route => {
    const result = await request(app.getHttpServer()).post(`/register/${route}`).send({ email: ' MEMBER@TEST.CL ' }).expect(200);
    expect(result.body).toEqual({ success: true, message: PASSWORD_RESET_REQUEST_MESSAGE });
    expect(result.body).not.toHaveProperty('newPassword');
    expect(service.requestReset).toHaveBeenCalledWith('member@test.cl');
  });

  it.each([{ email: 'invalid' }, {}, { email: 'member@test.cl', role: 'admin' }, { email: 'member@test.cl', initiatedByAdmin: true }, { email: 'member@test.cl', ttl: 86400000 }, { email: 'member@test.cl', url: 'https://evil.example' }, { email: { $ne: null } }])('rejects malformed request data and arbitrary link targets: %j', async body => {
    await request(app.getHttpServer()).post('/register/password-recovery').send(body).expect(400);
    expect(service.requestReset).not.toHaveBeenCalled();
  });

  it('requires authentication for the administrative request route', async () => {
    await request(app.getHttpServer()).post('/register/admin/resetpass').send({ email: 'member@test.cl' }).expect(401);
    expect(service.requestReset).not.toHaveBeenCalled();
  });

  it.each(['user', 'profesor'])('rejects role %s on the administrative request route', async role => {
    await request(app.getHttpServer()).post('/register/admin/resetpass').auth(jwt.sign({ email: 'other@test.cl', role }), { type: 'bearer' }).send({ email: 'member@test.cl' }).expect(403);
    expect(service.requestReset).not.toHaveBeenCalled();
  });

  it('allows an administrator to send the same link without changing the password itself', async () => {
    await request(app.getHttpServer()).post('/register/admin/resetpass').auth(jwt.sign({ email: 'admin@test.cl', role: 'admin' }), { type: 'bearer' }).send({ email: 'member@test.cl' }).expect(200);
    expect(service.requestReset).toHaveBeenCalledWith('member@test.cl', true);
    expect(service.confirmReset).not.toHaveBeenCalled();
  });

  const confirm = { token: 'a'.repeat(64), password: 'secret123', passwordConfirmation: 'secret123' };
  it('accepts a token and chosen password without requiring a login session', async () => {
    const result = await request(app.getHttpServer()).post('/register/password-recovery/confirm').send(confirm).expect(200);
    expect(service.confirmReset).toHaveBeenCalledWith(expect.objectContaining(confirm));
    expect(result.body).not.toHaveProperty('password');
    expect(result.body).not.toHaveProperty('token');
  });

  it.each([{ token: '' }, { token: 'invalid' }, { token: 'a'.repeat(65) }, { password: 'short' }, { password: null }, { passwordConfirmation: null }, { email: 'other@test.cl' }, { role: 'admin' }])('rejects invalid confirmation fields: %j', async extra => {
    await request(app.getHttpServer()).post('/register/password-recovery/confirm').send({ ...confirm, ...extra }).expect(400);
    expect(service.confirmReset).not.toHaveBeenCalled();
  });
});
