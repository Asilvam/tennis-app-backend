import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { PlayerCategoryPointsController } from './player-category-points.controller';
import { PlayerCategoryPointsService, categoryRevision } from './player-category-points.service';

describe('Member category editor HTTP contracts', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const secret = 'isolated-category-test-secret';
  const service = { getEditor: jest.fn(), saveAssignments: jest.fn(), updatePlayerPoints: jest.fn(), addCategoryToPlayer: jest.fn(), deactivateCategory: jest.fn(), removePlayerCategory: jest.fn(), getPlayerCategories: jest.fn() };
  const body = { revision: 'a'.repeat(64), activeCategories: ['1', 'Dobles'], pointAdjustments: [] };
  const root = '/player-category-points/member@test.invalid';
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret })],
      controllers: [PlayerCategoryPointsController],
      providers: [JwtStrategy, { provide: ConfigService, useValue: { get: () => secret } }, { provide: PlayerCategoryPointsService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
    jwt = module.get(JwtService);
  });
  beforeEach(() => {
    jest.resetAllMocks();
    service.saveAssignments.mockResolvedValue({ revision: 'b'.repeat(64) });
    service.getPlayerCategories.mockResolvedValue([]);
  });
  afterAll(async () => app.close());
  const token = (role = 'admin') => jwt.sign({ email: 'admin@test.invalid', role });
  it('keeps the ranking/profile read route public', async () => {
    await request(app.getHttpServer()).get(root).expect(200);
  });
  it.each(['user', 'profesor'])('rejects %s on editor reads and writes', async (role) => {
    await request(app.getHttpServer()).get(`${root}/editor`).auth(token(role), { type: 'bearer' }).expect(403);
    await request(app.getHttpServer()).put(`${root}/assignments`).auth(token(role), { type: 'bearer' }).send(body).expect(403);
    expect(service.saveAssignments).not.toHaveBeenCalled();
  });
  it('requires authentication for every administrative mutation', async () => {
    await request(app.getHttpServer()).get(`${root}/editor`).expect(401);
    await request(app.getHttpServer()).put(`${root}/assignments`).send(body).expect(401);
    await request(app.getHttpServer()).put(`${root}/points`).send({ categories: [] }).expect(401);
    await request(app.getHttpServer()).post(`${root}/add-category`).send({ category: '1' }).expect(401);
    await request(app.getHttpServer()).patch(`${root}/deactivate`).send({ category: '1' }).expect(401);
    await request(app.getHttpServer()).delete(`${root}/1`).expect(401);
  });
  it('accepts a valid admin save without including old points', async () => {
    await request(app.getHttpServer()).put(`${root}/assignments`).auth(token(), { type: 'bearer' }).send(body).expect(200);
    expect(service.saveAssignments).toHaveBeenCalledWith('member@test.invalid', expect.objectContaining(body));
  });
  it.each([
    { revision: 'bad' },
    { activeCategories: ['Unknown'] },
    { activeCategories: ['1', '1'] },
    { activeCategories: null },
    { pointAdjustments: [{ category: '1', points: -1 }] },
    { pointAdjustments: [{ category: '1', points: 1.2 }] },
    { pointAdjustments: [{ category: '1', points: '10' }] },
    { pointAdjustments: [{ category: '1', points: 9007199254740992 }] },
    {
      pointAdjustments: [
        { category: '1', points: 10 },
        { category: '1', points: 20 },
      ],
    },
    { pointAdjustments: [{ category: '1', points: 10, extra: true }] },
    { pointAdjustments: [null] },
    { role: 'admin' },
  ])('rejects invalid input: %j', async (override) => {
    await request(app.getHttpServer())
      .put(`${root}/assignments`)
      .auth(token(), { type: 'bearer' })
      .send({ ...body, ...override })
      .expect(400);
    expect(service.saveAssignments).not.toHaveBeenCalled();
  });
  it('revision is order independent and changes when points or activation change', () => {
    const rows = [
      { category: '1', points: 30, isActive: true },
      { category: '2', points: 50, isActive: false },
    ];
    expect(categoryRevision(rows)).toBe(categoryRevision([...rows].reverse()));
    expect(categoryRevision(rows)).not.toBe(categoryRevision([{ ...rows[0], points: 31 }, rows[1]]));
    expect(categoryRevision(rows)).not.toBe(categoryRevision([{ ...rows[0], isActive: false }, rows[1]]));
  });
});
