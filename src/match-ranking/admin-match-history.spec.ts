import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DateTime, Settings } from 'luxon';
import { MatchRankingService } from './match-ranking.service';

const query = (resolve: (options: any) => any) => {
  const options: any = {};
  const chain: any = { exec: jest.fn(async () => resolve(options)) };
  for (const method of ['select', 'sort', 'skip', 'limit', 'lean']) {
    chain[method] = jest.fn((value) => {
      options[method] = value;
      return chain;
    });
  }
  return chain;
};

describe('Admin-only read-only match history', () => {
  let service: MatchRankingService;
  let members: any;
  let reserves: any;
  let results: any;
  let data: any[];
  let saved: any[];
  let reviewer: any;
  let target: any;
  const actor = { email: 'admin@test.invalid', role: 'admin' };
  const filters = { playerEmail: 'ana@test.invalid' };
  const reserve = (id: string, date = '2026-10-01', extra = {}) => ({
    idCourtReserve: id,
    court: '3',
    dateToPlay: date,
    turn: '08:15-10:00',
    player1: 'Ana',
    player2: 'Beto',
    isForRanking: true,
    state: true,
    isDouble: false,
    resultMatchUpdated: false,
    ...extra,
  });
  beforeEach(() => {
    const now = DateTime.fromISO('2026-10-16T15:00:00', { zone: 'America/Santiago' }).toMillis();
    Settings.now = () => now;
    reviewer = { email: actor.email, role: 'admin', namePlayer: 'Admin' };
    target = { email: filters.playerEmail, namePlayer: 'Ana', statePlayer: false };
    data = [];
    saved = [];
    members = { findOne: jest.fn((filter) => query(() => (filter.email === actor.email ? reviewer : target))) };
    const matching = (filter) =>
      data.filter(
        (row) =>
          !row.isBlockedByAdmin &&
          row.dateToPlay >= filter.dateToPlay.$gte &&
          (!filter.dateToPlay.$lt || row.dateToPlay < filter.dateToPlay.$lt) &&
          [row.player1, row.player2, row.player3, row.player4].includes(target.namePlayer),
      );
    reserves = {
      countDocuments: jest.fn((filter) => query(() => matching(filter).length)),
      find: jest.fn((filter) =>
        query((options) =>
          matching(filter)
            .sort(
              (a, b) => b.dateToPlay.localeCompare(a.dateToPlay) || b.idCourtReserve.localeCompare(a.idCourtReserve),
            )
            .slice(options.skip, options.skip + options.limit),
        ),
      ),
      updateOne: jest.fn(),
      bulkWrite: jest.fn(),
    };
    results = {
      find: jest.fn((filter) => query(() => saved.filter((row) => filter.matchId.$in.includes(row.matchId)))),
      updateOne: jest.fn(),
      create: jest.fn(),
    };
    service = new MatchRankingService(results, reserves, members, null, null, null, null, null, null, null);
  });
  afterEach(() => {
    Settings.now = () => Date.now();
  });

  it('starts 30 calendar days back without excluding future bookings, paginated and including inactive members', async () => {
    data = Array.from({ length: 25 }, (_, i) => reserve(String(i).padStart(2, '0')));
    const response = await service.getAdminMatchHistory(actor, filters);
    expect(response).toMatchObject({
      from: '2026-09-17',
      to: null,
      page: 1,
      pageSize: 20,
      total: 25,
      totalPages: 2,
    });
    expect(response.member).toEqual({ name: 'Ana', email: filters.playerEmail });
    expect(response.matches).toHaveLength(20);
    expect(response.matches[0].idCourtReserve).toBe('24');
    const next = await service.getAdminMatchHistory(actor, { ...filters, page: 2 });
    expect(next.matches).toHaveLength(5);
    expect(new Set([...response.matches, ...next.matches].map((row) => row.idCourtReserve)).size).toBe(25);
    expect(reserves.find.mock.results[0].value.sort).toHaveBeenCalledWith({ dateToPlay: -1, turn: -1, _id: -1 });
  });
  it('includes all future bookings by default and allows an explicit future end date', async () => {
    data = [
      reserve('future-friendly', '2027-01-01', { isForRanking: false }),
      reserve('future-cancelled', '2026-12-01', { state: false }),
      reserve('old', '2025-01-01'),
    ];
    const response = await service.getAdminMatchHistory(actor, filters);
    expect(response.matches.map((row) => row.idCourtReserve)).toEqual(['future-friendly', 'future-cancelled']);
    expect(response.matches[0]).toMatchObject({ isForRanking: false, status: 'CURRENT', canRegister: false });
    const limited = await service.getAdminMatchHistory(actor, { ...filters, to: '2026-12-31' });
    expect(limited.matches.map((row) => row.idCourtReserve)).toEqual(['future-cancelled']);
  });
  it('includes non-ranking and cancelled bookings, but excludes other members and court blocks', async () => {
    data = [
      reserve('old', '2024-01-01'),
      reserve('last', '2024-12-31T00:00:00.000Z'),
      reserve('outside', '2025-01-01'),
      reserve('other', '2024-01-01', { player1: 'Otro' }),
      reserve('unpaid', '2024-01-01', { state: false, reservationStatus: 'PENDING_PAYMENT' }),
      reserve('cancelled', '2024-01-01', { state: false }),
      reserve('friendly', '2024-01-01', { isForRanking: false }),
      reserve('court-block', '2024-01-01', { isBlockedByAdmin: true }),
    ];
    const response = await service.getAdminMatchHistory(actor, { ...filters, from: '2024-01-01', to: '2024-12-31' });
    expect(response.matches.map((row) => row.idCourtReserve)).toEqual([
      'last',
      'unpaid',
      'old',
      'friendly',
      'cancelled',
    ]);
    expect(response.matches.find((row) => row.idCourtReserve === 'friendly')).toMatchObject({
      isForRanking: false,
      status: 'FINISHED',
      canRegister: false,
    });
    expect(response.matches.find((row) => row.idCourtReserve === 'cancelled').status).toBe('CANCELLED');
    expect(response.matches.find((row) => row.idCourtReserve === 'unpaid').status).toBe('UNCONFIRMED');
    expect(reserves.countDocuments.mock.calls[0][0]).not.toHaveProperty('isForRanking');
    expect(reserves.countDocuments.mock.calls[0][0]).not.toHaveProperty('state');
  });
  it('keeps a cancelled booking and its saved result without marking it available to enter again', async () => {
    data = [reserve('cancelled-saved', '2026-10-14', { state: false, resultMatchUpdated: true })];
    saved = [{ matchId: 'cancelled-saved', result: '6:1, 6:2', winner: [{ name: 'Ana' }] }];
    const response = await service.getAdminMatchHistory(actor, filters);
    expect(response.matches[0]).toMatchObject({
      status: 'CANCELLED',
      canRegister: false,
      result: { score: '6:1, 6:2', winners: ['Ana'] },
    });
    expect(reserves.updateOne).not.toHaveBeenCalled();
  });
  it('resolves recorded, legacy and expired statuses without any writes or point updates', async () => {
    data = [
      reserve('saved'),
      reserve('legacy', '2026-10-02', { resultMatchUpdated: true }),
      reserve('expired'),
      reserve('waiting', '2026-10-14'),
      reserve('current', '2026-10-16', { turn: '17:00-18:00' }),
    ];
    saved = [
      {
        matchId: 'saved',
        result: '6:4, 6:3',
        winner: [{ name: 'Beto', email: 'secret@test.invalid', cellular: 'secret' }],
      },
    ];
    const response = await service.getAdminMatchHistory(actor, filters);
    const byId = Object.fromEntries(response.matches.map((row) => [row.idCourtReserve, row]));
    expect(byId.saved).toMatchObject({ status: 'RECORDED', result: { score: '6:4, 6:3', winners: ['Beto'] } });
    expect(byId.legacy).toMatchObject({ status: 'RECORDED', result: { score: null, winners: [] } });
    expect(byId.expired).toMatchObject({ status: 'EXPIRED', result: null });
    expect(byId.waiting.status).toBe('AWAITING_RESULT');
    expect(byId.current.status).toBe('CURRENT');
    expect(response.matches.every((row) => row.canRegister === false)).toBe(true);
    expect(JSON.stringify(response)).not.toContain('secret');
    expect(reserves.updateOne).not.toHaveBeenCalled();
    expect(reserves.bulkWrite).not.toHaveBeenCalled();
    expect(results.updateOne).not.toHaveBeenCalled();
    expect(results.create).not.toHaveBeenCalled();
  });
  it('preserves Team 1 and Team 2 participant order and tolerates incomplete legacy records', async () => {
    data = [
      reserve('doubles', '2026-10-01', { isDouble: true, player3: 'Caro', player4: 'Diego' }),
      reserve('incomplete', '2026-10-01', { player2: null }),
    ];
    const response = await service.getAdminMatchHistory(actor, filters);
    expect(response.matches.find((row) => row.idCourtReserve === 'doubles').players).toEqual([
      'Ana',
      'Beto',
      'Caro',
      'Diego',
    ]);
    expect(response.matches.find((row) => row.idCourtReserve === 'incomplete').players).toEqual([
      'Ana',
      'Participante no disponible',
    ]);
  });
  it('does not break the history on a recent malformed legacy turn', async () => {
    data = [reserve('invalid', '2026-10-16', { turn: 'invalid' })];
    const response = await service.getAdminMatchHistory(actor, filters);
    expect(response.matches[0].status).toBe('REVIEW_REQUIRED');
  });
  it.each([null, { email: actor.email, role: 'user' }, { email: actor.email, role: 'profesor' }])(
    'rejects a missing or non-admin stored reviewer, even with a forged admin claim: %j',
    async (member) => {
      reviewer = member;
      await expect(service.getAdminMatchHistory(actor, filters)).rejects.toBeInstanceOf(ForbiddenException);
      expect(reserves.find).not.toHaveBeenCalled();
    },
  );
  it('rejects anonymous access and missing members', async () => {
    await expect(service.getAdminMatchHistory(null, filters)).rejects.toBeInstanceOf(ForbiddenException);
    target = null;
    await expect(service.getAdminMatchHistory(actor, filters)).rejects.toBeInstanceOf(NotFoundException);
  });
  it.each([
    { from: '2026-10-17', to: '2026-10-16' },
    { from: '2026-02-30', to: '2026-10-16' },
  ])('rejects reversed or invalid ranges: %j', async (range) => {
    await expect(service.getAdminMatchHistory(actor, { ...filters, ...range })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(reserves.find).not.toHaveBeenCalled();
  });
  it('returns an empty page without fetching results when there are no matches', async () => {
    const response = await service.getAdminMatchHistory(actor, filters);
    expect(response).toMatchObject({ matches: [], total: 0, totalPages: 0 });
    expect(results.find).not.toHaveBeenCalled();
  });
});
