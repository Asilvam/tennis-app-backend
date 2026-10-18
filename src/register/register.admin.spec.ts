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
import { PasswordRecoveryService } from './password-recovery.service';

describe('Administrative member edit HTTP authorization', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const secret = 'isolated-jwt-test-secret-not-production';
  const service = { updateAdminByEmail: jest.fn(), updateProfileByEmail: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret })],
      controllers: [RegisterController],
      providers: [JwtStrategy, { provide: ConfigService, useValue: { get: () => secret } }, { provide: RegisterService, useValue: service }, { provide: CloudinaryService, useValue: {} }, { provide: PasswordRecoveryService, useValue: {} }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
    jwt = module.get(JwtService);
  });
  beforeEach(() => { jest.resetAllMocks(); service.updateAdminByEmail.mockResolvedValue({ partnerType: 'Carga' }); });
  afterAll(async () => app.close());

  it('requires a JWT', async () => {
    await request(app.getHttpServer()).patch('/register/admin/member@test.cl').send({ partnerType: 'Carga' }).expect(401);
    expect(service.updateAdminByEmail).not.toHaveBeenCalled();
  });

  it.each(['user', 'profesor'])('rejects a valid JWT with role %s', async role => {
    await request(app.getHttpServer()).patch('/register/admin/member@test.cl').auth(jwt.sign({ email: 'test@test.cl', role }), { type: 'bearer' }).send({ partnerType: 'Titular' }).expect(403);
    expect(service.updateAdminByEmail).not.toHaveBeenCalled();
  });

  it('accepts an admin JWT and delegates only validated editable fields', async () => {
    const body = { partnerType: 'Carga', titularId: '000000000000000000000002', namePlayer: ' Updated ' };
    await request(app.getHttpServer()).patch('/register/admin/member@test.cl').auth(jwt.sign({ email: 'admin@test.cl', role: 'admin' }), { type: 'bearer' }).send(body).expect(200);
    expect(service.updateAdminByEmail).toHaveBeenCalledWith('member@test.cl', expect.objectContaining({ ...body, namePlayer: 'Updated' }), 'admin@test.cl');
  });

  it.each([
    { partnerType: 'Unknown' }, { titularId: 'invalid' }, { role: 'superadmin' },
    { email: 'other@test.cl' }, { pwd: 'not-allowed' }, { $set: { titularId: '000000000000000000000002' } },
  ])('rejects invalid or non-editable fields: %j', async body => {
    await request(app.getHttpServer()).patch('/register/admin/member@test.cl').auth(jwt.sign({ email: 'admin@test.cl', role: 'admin' }), { type: 'bearer' }).send(body).expect(400);
    expect(service.updateAdminByEmail).not.toHaveBeenCalled();
  });

  it('rejects an expired JWT', async () => {
    await request(app.getHttpServer()).patch('/register/admin/member@test.cl').auth(jwt.sign({ email: 'admin@test.cl', role: 'admin' }, { expiresIn: -1 }), { type: 'bearer' }).send({ partnerType: 'Titular' }).expect(401);
    expect(service.updateAdminByEmail).not.toHaveBeenCalled();
  });

  it('allows a regular member JWT to update its own photo without requiring admin', async () => {
    service.updateProfileByEmail.mockResolvedValue({ imageUrlProfile: 'https://image.example/profile.jpg' });
    await request(app.getHttpServer()).patch('/register/member@test.cl').auth(jwt.sign({ email: 'member@test.cl', role: 'user' }), { type: 'bearer' }).send({ imageUrlProfile: 'https://image.example/profile.jpg' }).expect(200);
    expect(service.updateProfileByEmail).toHaveBeenCalledTimes(1);
  });
});
