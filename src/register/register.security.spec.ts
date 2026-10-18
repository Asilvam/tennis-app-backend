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

describe('Register HTTP permission boundaries', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const secret = 'isolated-register-security-fixture';
  const service = {
    create: jest.fn(), updateProfileByEmail: jest.fn(), updateAdminByEmail: jest.fn(),
    enablePlayerPayment: jest.fn(), blockPlayerPayment: jest.fn(),
  };
  const cloudinary = { uploadImageBuffer: jest.fn() };
  const signup = { namePlayer: ' Member ', email: 'member@test.cl', cellular: '123456789', pwd: 'secret123', partnerType: 'Titular', urlEmail: 'http://localhost:3500/auth' };
  const token = (role = 'user', email = 'member@test.cl') => jwt.sign({ email, role });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret })],
      controllers: [RegisterController],
      providers: [JwtStrategy, { provide: ConfigService, useValue: { get: () => secret } }, { provide: RegisterService, useValue: service }, { provide: CloudinaryService, useValue: cloudinary }, { provide: PasswordRecoveryService, useValue: {} }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
    jwt = module.get(JwtService);
  });
  beforeEach(() => {
    jest.resetAllMocks();
    service.create.mockResolvedValue({ role: 'user' });
    service.updateProfileByEmail.mockResolvedValue({ imageUrlProfile: 'https://images.example/photo.jpg' });
    service.updateAdminByEmail.mockResolvedValue({ role: 'profesor' });
    service.enablePlayerPayment.mockResolvedValue({ success: true });
    service.blockPlayerPayment.mockResolvedValue({ success: true });
    cloudinary.uploadImageBuffer.mockResolvedValue({ secure_url: 'https://images.example/photo.jpg' });
  });
  afterAll(async () => app.close());

  it('keeps basic registration public and validates its existing frontend payload', async () => {
    await request(app.getHttpServer()).post('/register').send(signup).expect(201);
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ ...signup, namePlayer: 'Member' }));
  });

  it.each([
    { role: 'admin' }, { role: 'profesor' }, { statePlayer: true }, { updatePayment: true }, { updatePayment: false },
    { emailVerified: true }, { verificationToken: 'chosen-token' }, { estadoPago: 'Pagado' }, { titularId: '000000000000000000000002' },
    { isLigthNigth: true }, { hasVoted: true }, { socioPrincipal: true }, { montoPagar: 'Titular' },
    { imageUrlProfile: 'https://images.example/photo.jpg' }, { $set: { role: 'admin' } },
  ])('rejects privileged public signup fields: %j', async extra => {
    await request(app.getHttpServer()).post('/register').send({ ...signup, ...extra }).expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('rejects invalid basic signup data', async () => {
    await request(app.getHttpServer()).post('/register').send({ ...signup, email: 'invalid', pwd: 'short' }).expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('requires authentication for profile edits', async () => {
    await request(app.getHttpServer()).patch('/register/member@test.cl').send({ namePlayer: 'Updated' }).expect(401);
    expect(service.updateProfileByEmail).not.toHaveBeenCalled();
  });

  it.each(['user', 'profesor', 'admin'])('allows %s to edit its own safe profile fields', async role => {
    const body = { namePlayer: ' Updated ', cellular: '987654321', imageUrlProfile: 'https://images.example/photo.jpg' };
    await request(app.getHttpServer()).patch('/register/member@test.cl').auth(token(role), { type: 'bearer' }).send(body).expect(200);
    expect(service.updateProfileByEmail).toHaveBeenCalledWith('member@test.cl', expect.objectContaining({ ...body, namePlayer: 'Updated' }));
  });

  it.each(['user', 'profesor', 'admin'])('rejects %s editing someone else through the profile route', async role => {
    await request(app.getHttpServer()).patch('/register/other@test.cl').auth(token(role), { type: 'bearer' }).send({ namePlayer: 'Changed' }).expect(403);
    expect(service.updateProfileByEmail).not.toHaveBeenCalled();
  });

  it('uses the JWT identity rather than a case-variant URL as the update target', async () => {
    await request(app.getHttpServer()).patch('/register/MEMBER@TEST.CL').auth(token(), { type: 'bearer' }).send({ cellular: '987' }).expect(200);
    expect(service.updateProfileByEmail).toHaveBeenCalledWith('member@test.cl', expect.anything());
  });

  it.each([
    { role: 'admin' }, { statePlayer: true }, { updatePayment: true }, { emailVerified: true }, { verificationToken: 'chosen' },
    { email: 'other@test.cl' }, { pwd: 'changed-password' }, { partnerType: 'Titular' }, { titularId: '000000000000000000000002' },
    { estadoPago: 'Pagado' }, { isLigthNigth: true }, { $set: { role: 'admin' } }, { 'role.value': 'admin' },
    { namePlayer: null }, { cellular: null }, { imageUrlProfile: null }, { imageUrlProfile: 'javascript:alert(1)' },
  ])('rejects forbidden or invalid owner-profile fields: %j', async body => {
    await request(app.getHttpServer()).patch('/register/member@test.cl').auth(token(), { type: 'bearer' }).send(body).expect(400);
    expect(service.updateProfileByEmail).not.toHaveBeenCalled();
  });

  it('rejects an expired JWT for profile updates', async () => {
    const expired = jwt.sign({ email: 'member@test.cl', role: 'user' }, { expiresIn: -1 });
    await request(app.getHttpServer()).patch('/register/member@test.cl').auth(expired, { type: 'bearer' }).send({ namePlayer: 'Updated' }).expect(401);
    expect(service.updateProfileByEmail).not.toHaveBeenCalled();
  });

  it('rejects a tampered JWT before performing a profile update', async () => {
    const forged = new JwtService({ secret: 'different-fixture-secret' }).sign({ email: 'member@test.cl', role: 'admin' });
    await request(app.getHttpServer()).patch('/register/member@test.cl').auth(forged, { type: 'bearer' }).send({ namePlayer: 'Updated' }).expect(401);
    expect(service.updateProfileByEmail).not.toHaveBeenCalled();
  });

  it('requires a JWT before accepting an uploaded image', async () => {
    await request(app.getHttpServer()).post('/register/profile').attach('image', Buffer.from('image'), 'photo.png').expect(401);
    expect(cloudinary.uploadImageBuffer).not.toHaveBeenCalled();
  });

  it('allows authenticated profile image upload without making a real Cloudinary request', async () => {
    const result = await request(app.getHttpServer()).post('/register/profile').auth(token(), { type: 'bearer' }).attach('image', Buffer.from('image'), 'photo.png').expect(201);
    expect(result.body).toEqual({ imageUrl: 'https://images.example/photo.jpg' });
    expect(cloudinary.uploadImageBuffer).toHaveBeenCalledWith(Buffer.from('image'));
  });

  describe.each([
    ['enable', 'enablePlayerPayment'], ['block', 'blockPlayerPayment'],
  ] as const)('payment %s permissions', (action, method) => {
    it('rejects anonymous requests', async () => {
      await request(app.getHttpServer()).patch(`/register/payment/${action}/other@test.cl`).expect(401);
      expect(service[method]).not.toHaveBeenCalled();
    });
    it.each(['user', 'profesor'])('rejects role %s even when editing itself', async role => {
      await request(app.getHttpServer()).patch(`/register/payment/${action}/member@test.cl`).auth(token(role), { type: 'bearer' }).expect(403);
      expect(service[method]).not.toHaveBeenCalled();
    });
    it('allows the administrator to update the existing payment flag', async () => {
      await request(app.getHttpServer()).patch(`/register/payment/${action}/other@test.cl`).auth(token('admin'), { type: 'bearer' }).expect(200);
      expect(service[method]).toHaveBeenCalledWith('other@test.cl');
    });
  });

  it('allows only the admin route to change roles and access/payment flags', async () => {
    const body = { role: 'profesor', statePlayer: false, updatePayment: true };
    await request(app.getHttpServer()).patch('/register/admin/other@test.cl').auth(token('admin'), { type: 'bearer' }).send(body).expect(200);
    expect(service.updateAdminByEmail).toHaveBeenCalledWith('other@test.cl', expect.objectContaining(body), 'member@test.cl');
  });

  it.each([{ role: null }, { statePlayer: null }, { updatePayment: null }])('rejects null administrative permission flags: %j', async body => {
    await request(app.getHttpServer()).patch('/register/admin/other@test.cl').auth(token('admin'), { type: 'bearer' }).send(body).expect(400);
    expect(service.updateAdminByEmail).not.toHaveBeenCalled();
  });
});
