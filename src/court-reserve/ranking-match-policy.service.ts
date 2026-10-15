import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { DateTime } from 'luxon';
import { CourtReserve } from './entities/court-reserve.entity';
import { Register } from '../register/entities/register.entity';

export const RANKING_CAPACITY = 2;
export const RANKING_TIMEZONE = 'America/Santiago';
export type RankingActor = { email: string; role: string };
export type RankingReservation = Pick<
  CourtReserve,
  | 'idCourtReserve'
  | 'dateToPlay'
  | 'turn'
  | 'player1'
  | 'player2'
  | 'player3'
  | 'player4'
  | 'isDouble'
  | 'isForRanking'
  | 'state'
  | 'resultMatchUpdated'
>;

export function rankingParticipants(
  reserve: Pick<CourtReserve, 'player1' | 'player2' | 'player3' | 'player4' | 'isDouble'>,
): string[] {
  const names = (
    reserve.isDouble
      ? [reserve.player1, reserve.player2, reserve.player3, reserve.player4]
      : [reserve.player1, reserve.player2]
  ).filter(Boolean);
  if (names.length !== (reserve.isDouble ? 4 : 2) || new Set(names).size !== names.length)
    throw new BadRequestException('Los participantes del partido de ranking están incompletos o repetidos.');
  return names;
}

export function rankingTimes(reserve: Pick<CourtReserve, 'dateToPlay' | 'turn'>) {
  const [start, end] = reserve.turn.split('-').map((value) => value.trim());
  const startAt = DateTime.fromISO(`${reserve.dateToPlay.slice(0, 10)}T${start}`, { zone: RANKING_TIMEZONE });
  let endAt = DateTime.fromISO(`${reserve.dateToPlay.slice(0, 10)}T${end}`, { zone: RANKING_TIMEZONE });
  if (!startAt.isValid || !endAt.isValid)
    throw new BadRequestException('El partido tiene una fecha u horario inválido. Requiere revisión administrativa.');
  if (endAt <= startAt) endAt = endAt.plus({ days: 1 });
  return { startAt, endAt };
}

export function compareRankingMatches(a: RankingReservation, b: RankingReservation) {
  return (
    rankingTimes(a).startAt.toMillis() - rankingTimes(b).startAt.toMillis() ||
    a.idCourtReserve.localeCompare(b.idCourtReserve)
  );
}

@Injectable()
export class RankingMatchPolicyService {
  constructor(
    @InjectModel(CourtReserve.name) private readonly reserves: Model<CourtReserve>,
    @InjectModel(Register.name) private readonly members: Model<Register>,
  ) {}

  async withParticipantLock<T>(names: string[], operation: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.members.db.startSession();
    try {
      return await session.withTransaction(
        async () => {
          const found = await this.members
            .find({ namePlayer: { $in: names } })
            .select('_id namePlayer email')
            .sort({ _id: 1 })
            .session(session)
            .lean()
            .exec();
          if (found.length !== names.length || new Set(found.map((player) => player.namePlayer)).size !== names.length)
            throw new BadRequestException('No se pudo identificar de forma única a todos los participantes.');
          // Booking, result and administrative points writers serialize on the same member documents.
          for (const member of found) {
            const lock = await this.members
              .updateOne(
                { _id: member._id, namePlayer: member.namePlayer, email: member.email },
                { $inc: { __v: 1 } },
                { session },
              )
              .exec();
            if (lock.matchedCount !== 1)
              throw new ConflictException('Los participantes cambiaron. Actualiza el partido e intenta nuevamente.');
          }
          return operation(session);
        },
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
      );
    } finally {
      await session.endSession();
    }
  }

  async pendingFor(names: string[], session?: ClientSession, includePayments = false) {
    const query = this.reserves
      .find({
        isForRanking: true,
        resultMatchUpdated: { $ne: true },
        $and: [
          {
            $or: names.flatMap((name) =>
              ['player1', 'player2', 'player3', 'player4'].map((field) => ({ [field]: name })),
            ),
          },
          {
            $or: [
              { state: true },
              ...(includePayments ? [{ reservationStatus: 'PENDING_PAYMENT', checkoutReady: true }] : []),
            ],
          },
        ],
      })
      .session(session ?? null)
      .lean();
    return (await query.exec()).sort(compareRankingMatches);
  }

  async withBookingCapacity<T>(
    reserve: RankingReservation,
    excludeId: string | undefined,
    operation: (session: ClientSession) => Promise<T>,
  ) {
    const names = rankingParticipants(reserve);
    return this.withParticipantLock(names, async (session) => {
      const pending = (await this.pendingFor(names, session, true)).filter((row) => row.idCourtReserve !== excludeId);
      const now = DateTime.now().setZone(RANKING_TIMEZONE);
      for (const name of names) {
        const own = pending.filter((row) => [row.player1, row.player2, row.player3, row.player4].includes(name));
        if (own.length >= RANKING_CAPACITY)
          throw new ConflictException({
            code: 'RANKING_CAPACITY_REACHED',
            message: `${name} ya tiene dos partidos de ranking. Registra primero el resultado más antiguo.`,
            player: name,
          });
        if (own.some((row) => rankingTimes(row).endAt > now))
          throw new ConflictException({
            code: 'ACTIVE_RESERVATION',
            message: `${name} ya tiene una reserva de ranking vigente.`,
            player: name,
          });
      }
      return operation(session);
    });
  }

  async resultBlock(reserve: RankingReservation, session?: ClientSession, allowExpired = false) {
    const pending = await this.pendingFor(rankingParticipants(reserve), session);
    const older = pending.find(
      (row) => row.idCourtReserve !== reserve.idCourtReserve && compareRankingMatches(row, reserve) < 0,
    );
    if (older) {
      const date = DateTime.fromISO(older.dateToPlay, { zone: RANKING_TIMEZONE }).toFormat('dd/MM/yyyy');
      const start = older.turn.split('-')[0].trim();
      const affected = rankingParticipants(reserve)
        .filter((name) => rankingParticipants(older).includes(name))
        .join(' y ');
      return {
        code: 'PREVIOUS_RESULT_PENDING',
        message: `Registra primero el resultado pendiente de ${affected} del ${date} a las ${start}.`,
        previousMatchId: older.idCourtReserve,
      };
    }
    const { startAt, endAt } = rankingTimes(reserve);
    const now = DateTime.now().setZone(RANKING_TIMEZONE);
    if (endAt > now)
      return { code: 'MATCH_NOT_FINISHED', message: 'El resultado estará disponible al finalizar el turno.' };
    if (!allowExpired && now.startOf('day').diff(startAt.startOf('day'), 'days').days > 2)
      return {
        code: 'RESULT_DEADLINE_EXPIRED',
        message: 'El plazo de este partido venció. Un administrador debe revisar el resultado antes de continuar.',
      };
    return null;
  }

  async assertResultAllowed(reserve: RankingReservation, session: ClientSession, allowExpired = false) {
    if (!reserve) throw new NotFoundException('Partido no encontrado.');
    if (!reserve.state || !reserve.isForRanking)
      throw new BadRequestException({
        code: 'MATCH_NOT_ELIGIBLE',
        message: 'La reserva no está confirmada para ranking o fue cancelada.',
      });
    if (reserve.resultMatchUpdated)
      throw new ConflictException({
        code: 'RESULT_ALREADY_REGISTERED',
        message: 'El resultado de este partido ya fue registrado.',
      });
    const blocked = await this.resultBlock(reserve, session, allowExpired);
    if (blocked) throw new ConflictException(blocked);
  }
}
