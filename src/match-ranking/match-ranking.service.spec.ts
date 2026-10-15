import { MatchRankingService } from './match-ranking.service';
import { ConflictException, ForbiddenException } from '@nestjs/common';

const query = (resolve: () => any) => {
  const chain: any = { exec: jest.fn(async () => resolve()) };
  for (const method of ['session', 'lean', 'select']) chain[method] = jest.fn(() => chain);
  chain.then = (ok: (value: unknown) => unknown, fail: (error: unknown) => unknown) => chain.exec().then(ok, fail);
  return chain;
};

describe('Authoritative ranking result transaction', () => {
  let service: MatchRankingService;
  let state: any;
  let policy: any;
  let reserveModel: any;
  let saveFailure: boolean;
  let commit: boolean;
  const emails = { sendEmail: jest.fn() };
  const court = { logResultMatchUpdate: jest.fn() };
  const session: any = { endSession: jest.fn(), withTransaction: async (operation: () => unknown) => operation() };
  beforeEach(() => {
    saveFailure = false;
    commit = false;
    jest.clearAllMocks();
    state = {
      reserve: {
        _id: 'reserve-id',
        idCourtReserve: 'match',
        state: true,
        isForRanking: true,
        resultMatchUpdated: false,
        isDouble: false,
        player1: 'Ana',
        player2: 'Beto',
        dateToPlay: '2026-10-14',
        turn: '08:15-10:00',
      },
      members: [
        { namePlayer: 'Ana', email: 'a@test.invalid', cellular: '+56900000000', role: 'user' },
        { namePlayer: 'Beto', email: 'b@test.invalid', cellular: '+56900000001', role: 'user' },
        { namePlayer: 'Admin', email: 'admin@test.invalid', role: 'admin' },
        { namePlayer: 'Other', email: 'other@test.invalid', role: 'user' },
      ],
      points: [
        { playerEmail: 'a@test.invalid', category: '4', isActive: true, points: 100 },
        { playerEmail: 'b@test.invalid', category: '4', isActive: true, points: 100 },
      ],
      results: [],
    };
    const members = {
      db: { startSession: async () => session },
      find: (filter: any) => query(() => state.members.filter((row: any) => row.namePlayer === filter.namePlayer)),
      findOne: (filter: any) => query(() => state.members.find((row: any) => row.email === filter.email)),
    };
    const points = {
      find: (filter: any) => query(() => state.points.filter((row: any) => row.playerEmail === filter.playerEmail)),
      findOne: (filter: any) =>
        query(() =>
          state.points.find(
            (row: any) => row.playerEmail === filter.playerEmail && row.category === filter.category && row.isActive,
          ),
        ),
      updateOne: jest.fn((filter: any, update: any) =>
        query(() => {
          const row = state.points.find(
            (row: any) =>
              row.playerEmail === filter.playerEmail &&
              row.category === filter.category &&
              row.points === filter.points &&
              row.isActive,
          );
          if (row) row.points = update.$set.points;
          return { matchedCount: row ? 1 : 0 };
        }),
      ),
    };
    reserveModel = {
      findOne: () => query(() => state.reserve),
      updateOne: jest.fn(() =>
        query(() => {
          if (state.reserve.resultMatchUpdated) return { matchedCount: 0 };
          state.reserve.resultMatchUpdated = true;
          return { matchedCount: 1 };
        }),
      ),
    };
    const resultModel: any = function (data: any) {
      this.toObject = () => data;
      this.save = jest.fn(async () => {
        if (saveFailure) throw new Error('storage failed');
        state.results.push(data);
      });
    };
    resultModel.exists = () => query(() => (state.results.length ? { _id: 'saved' } : null));
    policy = {
      withParticipantLock: jest.fn(async (_names, operation) => {
        const before = structuredClone(state);
        try {
          const response = await operation(session);
          commit = true;
          return response;
        } catch (error) {
          state = before;
          throw error;
        }
      }),
      assertResultAllowed: jest.fn(async (reserve) => {
        if (reserve.resultMatchUpdated) throw new ConflictException({ code: 'RESULT_ALREADY_REGISTERED' });
      }),
      pendingFor: jest.fn(async () => []),
    };
    emails.sendEmail.mockImplementation(async () => {
      expect(commit).toBe(true);
    });
    service = new MatchRankingService(
      resultModel,
      reserveModel,
      members as any,
      court as any,
      {} as any,
      {} as any,
      emails as any,
      {} as any,
      points as any,
      policy,
    );
  });
  const dto = { matchId: 'match', result: '6:4, 6:3', winnerSide: 'A' as const };
  const actor = { email: 'a@test.invalid', role: 'user' };
  it('derives identities/categories from storage and returns committed point changes', async () => {
    const response = await service.create(dto, actor);
    expect(response.winner[0]).toMatchObject({ name: 'Ana', email: 'a@test.invalid' });
    expect(response.pointChanges.map((change) => change.after)).toEqual([400, 150]);
    expect(state.reserve.resultMatchUpdated).toBe(true);
    expect(state.results).toHaveLength(1);
    expect(emails.sendEmail).toHaveBeenCalledTimes(2);
  });
  it('rolls back points and the reservation flag when result storage fails, without email', async () => {
    saveFailure = true;
    await expect(service.create(dto, actor)).rejects.toThrow('storage failed');
    expect(state.points.map((row: any) => row.points)).toEqual([100, 100]);
    expect(state.reserve.resultMatchUpdated).toBe(false);
    expect(state.results).toHaveLength(0);
    expect(emails.sendEmail).not.toHaveBeenCalled();
    expect(court.logResultMatchUpdate).not.toHaveBeenCalled();
  });
  it('cannot award points twice for a repeated result', async () => {
    await service.create(dto, actor);
    await expect(service.create(dto, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(state.points.map((row: any) => row.points)).toEqual([400, 150]);
    expect(emails.sendEmail).toHaveBeenCalledTimes(2);
  });
  it('rejects a nonparticipant even when their JWT claims admin', async () => {
    await expect(service.create(dto, { email: 'other@test.invalid', role: 'admin' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(reserveModel.updateOne).not.toHaveBeenCalled();
  });
  it('requires the actual admin role for the explicit deadline override', async () => {
    await expect(service.create({ ...dto, allowExpired: true }, { ...actor, role: 'admin' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const response = await service.create(
      { ...dto, allowExpired: true },
      { email: 'admin@test.invalid', role: 'user' },
    );
    expect(response.expiredOverride).toBe(true);
    expect(policy.assertResultAllowed).toHaveBeenCalledWith(state.reserve, session, true);
  });
  it('checks chronological policy before making any points writes', async () => {
    policy.assertResultAllowed.mockRejectedValue(new ConflictException({ code: 'PREVIOUS_RESULT_PENDING' }));
    await expect(service.create(dto, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(state.points.map((row: any) => row.points)).toEqual([100, 100]);
    expect(emails.sendEmail).not.toHaveBeenCalled();
  });
  it('allows only actual administrators to read another member queue', async () => {
    await expect(
      service.getPendingMatches({ email: 'other@test.invalid', role: 'admin' }, actor.email),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await service.getPendingMatches({ email: 'admin@test.invalid', role: 'user' }, actor.email)).toMatchObject({
      member: { name: 'Ana' },
      matches: [],
      canReviewExpired: true,
    });
  });
  it('uses and persists all four doubles players individual points', async () => {
    state.reserve = { ...state.reserve, isDouble: true, player3: 'Caro', player4: 'Diego' };
    state.members.push(
      { namePlayer: 'Caro', email: 'c@test.invalid', cellular: '+56900000002' },
      { namePlayer: 'Diego', email: 'd@test.invalid', cellular: '+56900000003' },
    );
    state.points = ['a', 'b', 'c', 'd'].map((name, index) => ({
      playerEmail: name + '@test.invalid',
      category: 'Dobles',
      isActive: true,
      points: index * 100,
    }));
    const response = await service.create(dto, actor);
    expect(response.winner.map((row) => row.name)).toEqual(['Ana', 'Beto']);
    expect(response.looser.map((row) => row.name)).toEqual(['Caro', 'Diego']);
    expect(response.pointChanges.map((row) => row.after)).toEqual([300, 400, 250, 350]);
    expect(emails.sendEmail).toHaveBeenCalledTimes(4);
  });

  it('returns two ordered matches with the full legacy count rather than hiding overflow', async () => {
    policy.pendingFor.mockResolvedValue(
      ['one', 'two', 'three'].map((idCourtReserve) => ({ ...state.reserve, idCourtReserve })),
    );
    policy.resultBlock = jest.fn().mockResolvedValue(null);
    const response = await service.getPendingMatches(actor);
    expect(response.matches.map((row) => row.idCourtReserve)).toEqual(['one', 'two']);
    expect(response).toMatchObject({ totalPending: 3, hasOverflow: true });
    expect(response.matches[0].players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Ana', category: '4', points: 100 }),
        expect.objectContaining({ name: 'Beto', category: '4', points: 100 }),
      ]),
    );
  });

  it('does not offer an expired admin override when a participant category needs review', async () => {
    state.points[0].isActive = false;
    policy.pendingFor.mockResolvedValue([state.reserve]);
    policy.resultBlock = jest.fn().mockResolvedValue({ code: 'RESULT_DEADLINE_EXPIRED', message: 'Expired' });
    const response = await service.getPendingMatches({ email: 'admin@test.invalid', role: 'admin' }, actor.email);
    expect(response.matches[0]).toMatchObject({ canRegister: false, blockedCode: 'CATEGORY_UNAVAILABLE' });
  });
});
