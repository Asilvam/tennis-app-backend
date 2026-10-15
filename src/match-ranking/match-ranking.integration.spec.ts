import * as mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { MatchRankingService } from './match-ranking.service';
import { MatchRanking, MatchResultSchema } from './entities/match-ranking.entity';
import { CourtReserve, CourtReserveSchema } from '../court-reserve/entities/court-reserve.entity';
import { RankingMatchPolicyService } from '../court-reserve/ranking-match-policy.service';
import { Register, RegisterSchema } from '../register/entities/register.entity';
import {
  PlayerCategoryPoints,
  PlayerCategoryPointsSchema,
} from '../player-category-points/entities/player-category-points.entity';

const uri = process.env.RESULTS_TEST_MONGO_URI;
(uri ? describe : describe.skip)('Ranking transactions with an isolated MongoDB replica set', () => {
  let connection: mongoose.Connection;
  let members: mongoose.Model<Register>;
  let reserves: mongoose.Model<CourtReserve>;
  let points: mongoose.Model<PlayerCategoryPoints>;
  let results: mongoose.Model<MatchRanking>;
  let policy: RankingMatchPolicyService;
  let service: MatchRankingService;
  const email = 'ana@test.invalid';
  const emails = { sendEmail: jest.fn().mockResolvedValue(undefined) };
  const actor = { email, role: 'user' };
  const dto = { matchId: 'oldest', result: '6:4, 6:3', winnerSide: 'A' as const };
  const date = () => DateTime.now().setZone('America/Santiago').minus({ days: 1 }).toISODate();
  const match = (id: string, turn = '08:15-10:00', extra = {}) => ({
    idCourtReserve: id,
    passCourtReserve: 'test',
    court: '1',
    dateToPlay: date(),
    turn,
    player1: 'Ana',
    player2: 'Beto',
    isForRanking: true,
    ...extra,
  });
  beforeAll(async () => {
    const target = new URL(uri);
    if (target.hostname !== '127.0.0.1' || !/^\/ctq_results_test_/.test(target.pathname))
      throw new Error('Only an isolated localhost test database is allowed.');
    connection = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 10000 }).asPromise();
    members = connection.model(Register.name, RegisterSchema);
    reserves = connection.model(CourtReserve.name, CourtReserveSchema);
    points = connection.model(PlayerCategoryPoints.name, PlayerCategoryPointsSchema);
    results = connection.model(MatchRanking.name, MatchResultSchema);
    await Promise.all([members.init(), reserves.init(), points.init(), results.init()]);
    policy = new RankingMatchPolicyService(reserves, members);
    service = new MatchRankingService(
      results as any,
      reserves as any,
      members as any,
      { logResultMatchUpdate: jest.fn() } as any,
      {} as any,
      {} as any,
      emails as any,
      {} as any,
      points,
      policy,
    );
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    await Promise.all([members.deleteMany({}), reserves.deleteMany({}), points.deleteMany({}), results.deleteMany({})]);
    await members.create([
      { namePlayer: 'Ana', email, cellular: 'test-ana', pwd: 'test-only', statePlayer: true },
      { namePlayer: 'Beto', email: 'beto@test.invalid', cellular: 'test-beto', pwd: 'test-only', statePlayer: true },
    ]);
    await points.create(
      [email, 'beto@test.invalid'].map((playerEmail) => ({ playerEmail, category: '4', points: 100, isActive: true })),
    );
    await reserves.create(match('oldest'));
  });
  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
      await connection.close();
    }
  });
  it('commits only one result and one points award under competing participant submissions', async () => {
    const attempts = await Promise.allSettled([
      service.create(dto, actor),
      service.create(dto, { email: 'beto@test.invalid', role: 'user' }),
    ]);
    expect(attempts.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(await results.countDocuments({ matchId: dto.matchId })).toBe(1);
    expect((await points.findOne({ playerEmail: email, category: '4' })).points).toBe(400);
    expect((await points.findOne({ playerEmail: 'beto@test.invalid', category: '4' })).points).toBe(150);
    expect(emails.sendEmail).toHaveBeenCalledTimes(2);
  });
  it('rolls back points, member versions and result flags if the final insert fails', async () => {
    const before = await members.findOne({ email }).lean();
    const spy = jest.spyOn(results.prototype, 'save').mockRejectedValue(new Error('isolated insert failure'));
    try {
      await expect(service.create(dto, actor)).rejects.toThrow('isolated insert failure');
    } finally {
      spy.mockRestore();
    }
    expect((await points.findOne({ playerEmail: email, category: '4' })).points).toBe(100);
    expect((await reserves.findOne({ idCourtReserve: dto.matchId })).resultMatchUpdated).toBe(false);
    expect((await members.findOne({ email }).lean()).__v).toBe(before.__v);
    expect(await results.countDocuments({})).toBe(0);
    expect(emails.sendEmail).not.toHaveBeenCalled();
  });
  it('cannot register the next match ahead of the oldest under concurrent submissions', async () => {
    await reserves.create(match('next', '10:00-11:45'));
    await Promise.allSettled([service.create({ ...dto, matchId: 'next' }, actor), service.create(dto, actor)]);
    const saved = await results.find().sort({ createdAt: 1 }).lean();
    expect(saved[0].matchId).toBe('oldest');
    if (saved.length === 1) await service.create({ ...dto, matchId: 'next' }, actor);
    expect(await results.countDocuments({})).toBe(2);
  });
  it('serializes competing third bookings on the member rather than allowing both', async () => {
    const attempt = (id: string) =>
      policy.withBookingCapacity(match(id) as CourtReserve, undefined, async (session) => {
        return new reserves(match(id)).save({ session });
      });
    const attempts = await Promise.allSettled([attempt('next-a'), attempt('next-b')]);
    expect(attempts.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(await reserves.countDocuments({ isForRanking: true, resultMatchUpdated: false })).toBe(2);
  });
});
