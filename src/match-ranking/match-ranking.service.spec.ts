import { MatchRankingService } from './match-ranking.service';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { DateTime, Settings } from 'luxon';

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
    const instant = DateTime.fromISO('2026-10-14T15:00:00', { zone: 'America/Santiago' }).toMillis();
    Settings.now = () => instant;
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
      extraReserves: [],
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
      find: jest.fn(() => query(() => state.extraReserves)),
      findOne: () => query(() => state.reserve),
      updateOne: jest.fn((_filter, update) =>
        query(() => {
          if (state.reserve.resultMatchUpdated) return { matchedCount: 0 };
          Object.assign(state.reserve, update.$set);
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
    resultModel.findOne = (filter: any) =>
      query(() => state.results.find((row: any) => row.matchId === filter.matchId) ?? null);
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
      currentFor: jest.fn(async () => []),
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
  afterEach(() => {
    Settings.now = () => Date.now();
  });
  const dto = { matchId: 'match', result: '6:4, 6:3', winnerSide: 'A' as const };
  const actor = { email: 'a@test.invalid', role: 'user' };
  it('derives identities/categories from storage and returns committed point changes', async () => {
    const response = await service.create(dto, actor);
    expect(response.winner[0]).toMatchObject({ name: 'Ana', email: 'a@test.invalid' });
    expect(response.pointChanges.map((change) => change.after)).toEqual([400, 150]);
    expect(state.reserve.resultMatchUpdated).toBe(true);
    expect(state.reserve.rankingResultStatus).toBe('RECORDED');
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
  it('maps the singles second option to Player 2, without swapping player identities', async () => {
    const result = await service.create({ ...dto, winnerSide: 'B' }, actor);
    expect(result.winner.map((row) => row.name)).toEqual(['Beto']);
    expect(result.looser.map((row) => row.name)).toEqual(['Ana']);
    expect(state.points.map((row: any) => row.points)).toEqual([150, 400]);
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
  it('commits the expired state without points or result records, even for administrators', async () => {
    state.reserve.dateToPlay = '2026-10-11';
    policy.pendingFor.mockImplementation(async () => {
      state.reserve.rankingResultStatus = 'EXPIRED';
      return [];
    });
    await expect(service.create(dto, { email: 'admin@test.invalid', role: 'admin' })).rejects.toMatchObject({
      response: { code: 'RESULT_DEADLINE_EXPIRED' },
    });
    expect(commit).toBe(true);
    expect(state.reserve.rankingResultStatus).toBe('EXPIRED');
    expect(state.points.map((row: any) => row.points)).toEqual([100, 100]);
    expect(state.results).toHaveLength(0);
    expect(emails.sendEmail).not.toHaveBeenCalled();
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
      totalPending: 0,
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

  it('lets an administrator register an eligible ranking result on behalf of the players', async () => {
    const response = await service.create(dto, { email: 'admin@test.invalid', role: 'user' });
    expect(response).toMatchObject({ recordedBy: 'admin@test.invalid', result: '6:4, 6:3' });
    expect(state.reserve.resultMatchUpdated).toBe(true);
    expect(state.points.map((row) => row.points)).toEqual([400, 150]);
  });

  it('keeps the administrator result queue ranking-only, leaving other bookings to history', async () => {
    policy.currentFor.mockResolvedValue([state.reserve]);
    policy.resultBlock = jest.fn().mockResolvedValue(null);
    state.extraReserves = [
      { ...state.reserve, idCourtReserve: 'friendly', isForRanking: false },
      {
        ...state.reserve,
        idCourtReserve: 'future-friendly',
        isForRanking: false,
        dateToPlay: '2026-11-01',
        player2: null,
        isVisit: true,
        visitName: 'Invitado Apellido',
      },
      { ...state.reserve, idCourtReserve: 'cancelled', state: false },
      { ...state.reserve, idCourtReserve: 'unconfirmed', state: false, reservationStatus: 'PENDING_PAYMENT' },
    ];
    const response = await service.getPendingMatches({ email: 'admin@test.invalid', role: 'user' }, actor.email);
    expect(response.matches).toHaveLength(1);
    expect(response.totalPending).toBe(1);
    expect(response.matches[0]).toMatchObject({
      idCourtReserve: 'match',
      isForRanking: true,
      readOnly: false,
      canRegister: true,
    });
    expect(reserveModel.find).not.toHaveBeenCalled();
    const own = await service.getPendingMatches(actor);
    expect(own.matches).toHaveLength(1);
    expect(reserveModel.find).not.toHaveBeenCalled();
    expect(state.points.map((row) => row.points)).toEqual([100, 100]);
    expect(state.results).toHaveLength(0);
    expect(emails.sendEmail).not.toHaveBeenCalled();
  });

  it('returns all matches within the deadline without a two-pending limit', async () => {
    policy.currentFor.mockResolvedValue(
      ['one', 'two', 'three'].map((idCourtReserve) => ({ ...state.reserve, idCourtReserve })),
    );
    policy.resultBlock = jest.fn().mockResolvedValue(null);
    const response = await service.getPendingMatches(actor);
    expect(response.matches.map((row) => row.idCourtReserve)).toEqual(['one', 'two', 'three']);
    expect(response).toMatchObject({ totalPending: 3 });
    expect(response.matches[0].players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Ana', category: '4', points: 100 }),
        expect.objectContaining({ name: 'Beto', category: '4', points: 100 }),
      ]),
    );
  });

  it('does not return expired games or their historical detail in this screen', async () => {
    state.points[0].isActive = false;
    policy.currentFor.mockResolvedValue([]);
    const response = await service.getPendingMatches({ email: 'admin@test.invalid', role: 'admin' }, actor.email);
    expect(response.matches).toEqual([]);
    expect(response).not.toHaveProperty('expiredMatches');
  });
  it('keeps a partner submitted result visible but read only, without repeating points', async () => {
    await service.create({ ...dto, winnerSide: 'B' }, { email: 'b@test.invalid', role: 'user' });
    policy.currentFor.mockResolvedValue([state.reserve]);
    state.points.forEach((row: any) => {
      row.isActive = false;
    });
    const response = await service.getPendingMatches(actor);
    expect(response).toMatchObject({
      totalPending: 0,
      matches: [
        expect.objectContaining({
          canRegister: false,
          phase: 'RECORDED',
          blockedCode: 'RESULT_ALREADY_REGISTERED',
          result: { score: '6:4, 6:3', winners: ['Beto'] },
        }),
      ],
    });
    expect(response.matches[0].players.map((row) => row.points)).toEqual([150, 400]);
    expect(state.points.map((row: any) => row.points)).toEqual([150, 400]);
    expect(emails.sendEmail).toHaveBeenCalledTimes(2);
    expect(state.results).toHaveLength(1);
  });
  it('does not enable entry when the shared reservation already has a result flag but lacks detail', async () => {
    state.reserve.resultMatchUpdated = true;
    policy.currentFor.mockResolvedValue([state.reserve]);
    const response = await service.getPendingMatches(actor);
    expect(response.matches[0]).toMatchObject({
      canRegister: false,
      phase: 'RECORDED',
      result: { score: null, winners: [] },
    });
  });
  it('synchronizes an outdated shared flag from the existing result without changing points', async () => {
    await service.create(dto, actor);
    state.reserve.resultMatchUpdated = false;
    delete state.reserve.rankingResultStatus;
    policy.currentFor.mockResolvedValue([state.reserve]);
    const response = await service.getPendingMatches(actor);
    expect(response.matches[0]).toMatchObject({ phase: 'RECORDED', canRegister: false, result: { score: '6:4, 6:3' } });
    expect(state.reserve).toMatchObject({ resultMatchUpdated: true, rankingResultStatus: 'RECORDED' });
    expect(state.points.map((row: any) => row.points)).toEqual([400, 150]);
    expect(state.results).toHaveLength(1);
    expect(emails.sendEmail).toHaveBeenCalledTimes(2);
  });
});
