import { ConflictException } from '@nestjs/common';
import { DateTime, Settings } from 'luxon';
import {
  RankingMatchPolicyService,
  RankingReservation,
  compareRankingMatches,
  rankingParticipants,
  rankingTimes,
} from './ranking-match-policy.service';

const match = (id: string, date = '2026-10-14', turn = '08:15-10:00', extra = {}): RankingReservation => ({
  idCourtReserve: id,
  dateToPlay: date,
  turn,
  player1: 'Ana',
  player2: 'Beto',
  player3: undefined,
  player4: undefined,
  isDouble: false,
  isForRanking: true,
  state: true,
  resultMatchUpdated: false,
  ...extra,
});
const query = (rows: unknown[]) => {
  const chain = { session: jest.fn(), lean: jest.fn(), exec: jest.fn().mockResolvedValue(rows) };
  chain.session.mockReturnValue(chain);
  chain.lean.mockReturnValue(chain);
  return chain;
};

describe('Ranking match order and capacity', () => {
  let policy: RankingMatchPolicyService;
  let find: jest.Mock;
  beforeEach(() => {
    const instant = DateTime.fromISO('2026-10-14T15:00:00', { zone: 'America/Santiago' }).toMillis();
    Settings.now = () => instant;
  });
  afterEach(() => {
    Settings.now = () => Date.now();
  });
  const setup = (rows: RankingReservation[]) => {
    find = jest.fn().mockReturnValue(query(rows));
    policy = new RankingMatchPolicyService({ find } as any, {} as any);
    jest.spyOn(policy, 'withParticipantLock').mockImplementation(async (_names, operation) => operation({} as any));
  };
  it('sorts by playing date/time, not reservation identifier', async () => {
    setup([match('a', '2026-10-14'), match('z', '2026-10-13')]);
    expect((await policy.pendingFor(['Ana'])).map((row) => row.idCourtReserve)).toEqual(['z', 'a']);
    expect(compareRankingMatches(match('a', '2026-10-14', '10:00-11:45'), match('z'))).toBeGreaterThan(0);
  });
  it('includes all four doubles participants and rejects duplicates', () => {
    expect(
      rankingParticipants(match('a', undefined, undefined, { isDouble: true, player3: 'Caro', player4: 'Diego' })),
    ).toEqual(['Ana', 'Beto', 'Caro', 'Diego']);
    expect(() => rankingParticipants(match('a', undefined, undefined, { player2: 'Ana' }))).toThrow();
  });
  it('permits the second booking after the first has ended without requiring its result', async () => {
    setup([match('old')]);
    const operation = jest.fn().mockResolvedValue('created');
    expect(await policy.withBookingCapacity(match('next', '2026-10-15'), undefined, operation)).toBe('created');
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it('blocks a third booking even when the affected member is player 4', async () => {
    setup([
      match('old', '2026-10-12', undefined, { player1: 'Diego', player2: 'Otro' }),
      match('current', '2026-10-14', undefined, { player1: 'Diego', player2: 'Otro' }),
    ]);
    const operation = jest.fn();
    await expect(
      policy.withBookingCapacity(
        match('next', '2026-10-15', undefined, { isDouble: true, player3: 'Caro', player4: 'Diego' }),
        undefined,
        operation,
      ),
    ).rejects.toMatchObject({
      response: { code: 'RANKING_CAPACITY_REACHED', player: 'Diego' },
    });
    expect(operation).not.toHaveBeenCalled();
  });
  it('does not permit two current bookings and excludes the same payment reservation', async () => {
    setup([match('current', '2026-10-15')]);
    await expect(policy.withBookingCapacity(match('next', '2026-10-16'), undefined, jest.fn())).rejects.toMatchObject({
      response: { code: 'ACTIVE_RESERVATION' },
    });
    expect(await policy.withBookingCapacity(match('current', '2026-10-15'), 'current', async () => 'confirmed')).toBe(
      'confirmed',
    );
  });
  it('checks previous matches for the opponent too and never bypasses order for admins', async () => {
    const current = match('current');
    setup([match('previous', '2026-10-10', undefined, { player1: 'Otra', player2: 'Beto' }), current]);
    expect(await policy.resultBlock(current, undefined, true)).toMatchObject({
      code: 'PREVIOUS_RESULT_PENDING',
      previousMatchId: 'previous',
    });
    const filter = find.mock.calls[0][0];
    expect(filter.$and[0].$or).toContainEqual({ player2: 'Beto' });
  });
  it('requires the turn to finish, including overnight matches', async () => {
    const current = match('current', '2026-10-14', '14:00-16:00');
    setup([current]);
    expect(await policy.resultBlock(current, undefined, true)).toMatchObject({ code: 'MATCH_NOT_FINISHED' });
    expect(rankingTimes(match('night', '2026-10-14', '23:00-01:00')).endAt.toISODate()).toBe('2026-10-15');
  });
  it('keeps the two-day deadline and requires explicit review once expired', async () => {
    const oldest = match('oldest', '2026-10-11');
    setup([oldest]);
    expect(await policy.resultBlock(oldest)).toMatchObject({ code: 'RESULT_DEADLINE_EXPIRED' });
    expect(await policy.resultBlock(oldest, undefined, true)).toBeNull();
    setup([match('boundary', '2026-10-12')]);
    expect(await policy.resultBlock(match('boundary', '2026-10-12'))).toBeNull();
  });
  it('includes prepared payment holds for capacity, but not when registering results', async () => {
    setup([]);
    await policy.pendingFor(['Ana'], undefined, true);
    expect(find.mock.calls[0][0].$and[1].$or).toContainEqual({
      reservationStatus: 'PENDING_PAYMENT',
      checkoutReady: true,
    });
    await policy.pendingFor(['Ana']);
    expect(find.mock.calls[1][0].$and[1].$or).toEqual([{ state: true }]);
  });
  it('rejects an already recorded result before consulting the queue', async () => {
    setup([]);
    await expect(
      policy.assertResultAllowed(match('done', undefined, undefined, { resultMatchUpdated: true }), {} as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(find).not.toHaveBeenCalled();
  });
});
