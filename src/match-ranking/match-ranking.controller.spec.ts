import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { MatchRankingController } from './match-ranking.controller';
import { MatchRankingService } from './match-ranking.service';

describe('Ranking result HTTP contract', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const service = { create: jest.fn(), getPendingMatches: jest.fn(), validateMatch: jest.fn() };
  const body = { matchId: 'match-test', result: '6:4, 6:3', winnerSide: 'A' };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: 'result-test-secret' })],
      controllers: [MatchRankingController],
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: { get: () => 'result-test-secret' } },
        { provide: MatchRankingService, useValue: service },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    jwt = module.get(JwtService);
  });
  beforeEach(() => {
    jest.clearAllMocks();
    service.create.mockResolvedValue({ matchId: 'match-test' });
    service.getPendingMatches.mockResolvedValue({ matches: [] });
  });
  afterAll(async () => app.close());
  const token = () => jwt.sign({ email: 'ana@test.invalid', role: 'user' });
  it('requires JWT for pending reads, validation and result writes', async () => {
    await request(app.getHttpServer()).get('/match-ranking/pending').expect(401);
    await request(app.getHttpServer())
      .post('/match-ranking/validate-match')
      .send({ id: 'test', pass: 'test' })
      .expect(401);
    await request(app.getHttpServer()).post('/match-ranking').send(body).expect(401);
    expect(service.create).not.toHaveBeenCalled();
  });
  it('passes only the minimal result and the authenticated actor', async () => {
    await request(app.getHttpServer()).post('/match-ranking').auth(token(), { type: 'bearer' }).send(body).expect(201);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining(body),
      expect.objectContaining({ email: 'ana@test.invalid' }),
    );
  });
  it.each([
    { winner: [{ email: 'forged@test.invalid' }] },
    { looser: [] },
    { winnerSide: 'C' },
    { result: 'arbitrary text' },
    { allowExpired: 'true' },
    { result: '' },
    { role: 'admin' },
  ])('rejects invalid or forged payload %j', async (override) => {
    await request(app.getHttpServer())
      .post('/match-ranking')
      .auth(token(), { type: 'bearer' })
      .send({ ...body, ...override })
      .expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });
  it('routes pending before the generic identifier and passes the review target', async () => {
    await request(app.getHttpServer())
      .get('/match-ranking/pending?playerEmail=member@test.invalid')
      .auth(token(), { type: 'bearer' })
      .expect(200);
    expect(service.getPendingMatches).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ana@test.invalid' }),
      'member@test.invalid',
    );
  });
});
