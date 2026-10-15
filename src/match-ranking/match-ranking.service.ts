import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CreateMatchRankingDto } from './dto/create-match-ranking.dto';
import { UpdateMatchRankingDto } from './dto/update-match-ranking.dto';
import { ValidateMatchDto } from './dto/validate-match.dto';
import { InjectModel } from '@nestjs/mongoose';
import { MatchRanking, MatchResultDocument } from './entities/match-ranking.entity';
import { ClientSession, Model } from 'mongoose';
import { CourtReserveService } from '../court-reserve/court-reserve.service';
import { RegisterService } from '../register/register.service';
import { PlayerCategoryPointsService } from '../player-category-points/player-category-points.service';
import { CourtReserve, CourtReserveDocument } from '../court-reserve/entities/court-reserve.entity';
import { Register, RegisterDocument } from '../register/entities/register.entity';
import { PlayerCategory, RankingPorCategoria, Resultado } from './interfaces/tennis.types';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { DOUBLES_CATEGORY, MAIN_SINGLES_CATEGORIES } from '../register/enums/category.enum';
import { buildRankingPointsEmail } from '../email/templates/transactional-email.templates';
import {
  RankingActor,
  RankingMatchPolicyService,
  rankingParticipants,
  rankingTimes,
  rankingResultExpired,
} from '../court-reserve/ranking-match-policy.service';
import { PlayerCategoryPoints } from '../player-category-points/entities/player-category-points.entity';

type RankingPlayer = MatchRanking['winner'][number];
type ResolvedResult = { winner: RankingPlayer[]; looser: RankingPlayer[] };

@Injectable()
export class MatchRankingService {
  private readonly logger = new Logger(MatchRankingService.name);
  private readonly MAIN_SINGLES_CATEGORIES = MAIN_SINGLES_CATEGORIES;
  private readonly DOUBLES_CATEGORY = DOUBLES_CATEGORY;

  constructor(
    @InjectModel(MatchRanking.name) private readonly matchRankingModel: Model<MatchResultDocument>,
    @InjectModel(CourtReserve.name) private readonly courtReserveModel: Model<CourtReserveDocument>,
    @InjectModel(Register.name) private readonly registerModel: Model<RegisterDocument>,
    private readonly courtReserveService: CourtReserveService,
    private readonly registerService: RegisterService,
    private readonly playerCategoryPointsService: PlayerCategoryPointsService, // ✅ PASO 5: Nuevo servicio
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    @InjectModel(PlayerCategoryPoints.name) private readonly pointsModel: Model<PlayerCategoryPoints>,
    private readonly rankingPolicy: RankingMatchPolicyService,
  ) {}

  async calculateSinglesValidPoints(createMatchRankingDto: ResolvedResult, session?: ClientSession) {
    const winnerData = createMatchRankingDto.winner[0];
    const looserData = createMatchRankingDto.looser[0];
    const { winnerCategory, looserCategory } = this._resolveSinglesCategories(winnerData, looserData);

    // Obtener puntos actuales desde player_category_points
    const winnerPts = await this.storedPoints(winnerData.email, winnerCategory, session);
    const looserPts = await this.storedPoints(looserData.email, looserCategory, session);

    const winnerCat = winnerCategory;
    const looserCat = looserCategory;
    const isSpecialCategorySingles =
      !this.MAIN_SINGLES_CATEGORIES.includes(winnerCat) || !this.MAIN_SINGLES_CATEGORIES.includes(looserCat);

    let winnerPointChange = 0;
    let looserPointChange = 0;
    const baseWin = 300;
    const baseLose = 50;
    let detail: string;

    // Categorías especiales (+55, +65, etc.) usan fórmula fija
    if (isSpecialCategorySingles) {
      if (winnerCat !== looserCat) {
        throw new BadRequestException(
          `Partido inválido: categorías especiales distintas (${winnerCat} vs ${looserCat})`,
        );
      }
      winnerPointChange = baseWin;
      looserPointChange = baseLose;
      detail = `Cat especial (${winnerCat}): +${baseWin}/+${baseLose}`;

      return {
        winnerPointChange,
        looserPointChange,
        winnerPoints: winnerPts + winnerPointChange,
        looserPoints: looserPts + looserPointChange,
        detail: detail,
        winnerCategory: winnerCat,
        looserCategory: looserCat,
      };
    }

    if (winnerCat === looserCat) {
      winnerPointChange = baseWin;
      looserPointChange = baseLose;
      if (winnerPts < looserPts) {
        const diff = looserPts - winnerPts;
        const bonus = Math.floor(diff / 5);
        winnerPointChange += bonus;
        looserPointChange -= bonus;
        detail = `Misma cat: +${baseWin}/+${baseLose} y TRANSFIERE 1/5(${diff})=${bonus}`;
      } else {
        detail = `Misma cat: +${baseWin}/+${baseLose} (sin transferencia)`;
      }
    } else {
      if (parseInt(winnerCat) > parseInt(looserCat)) {
        winnerPointChange = 600;
        looserPointChange = 50;
        detail = 'Distintas cat: gana inferior → +600/+50';
      } else {
        winnerPointChange = 150;
        looserPointChange = 50;
        detail = 'Distintas cat: gana superior → +150/+50';
      }
    }
    return {
      winnerPointChange, // Devuelve el cambio, no el total
      looserPointChange, // Devuelve el cambio, no el total
      winnerPoints: winnerPts + winnerPointChange,
      looserPoints: looserPts + looserPointChange,
      detail: detail,
      winnerCategory: winnerCat,
      looserCategory: looserCat,
    };
  }

  async create(dto: CreateMatchRankingDto, actor: RankingActor) {
    const initial = await this.courtReserveModel.findOne({ idCourtReserve: dto.matchId }).lean().exec();
    if (!initial) throw new NotFoundException('Partido no encontrado.');
    const names = rankingParticipants(initial);
    const saved = await this.rankingPolicy.withParticipantLock(names, async (session) => {
      const reserve = await this.courtReserveModel
        .findOne({ idCourtReserve: dto.matchId })
        .session(session)
        .lean()
        .exec();
      if (!reserve || JSON.stringify(rankingParticipants(reserve)) !== JSON.stringify(names))
        throw new ConflictException('Los participantes cambiaron. Actualiza el partido.');
      const players = await this.loadPlayers(reserve, session);
      const member = await this.authorize(players, actor, session);
      await this.rankingPolicy.pendingFor(names, session);
      // Return the expiry outcome so its state commits before rejecting a late result.
      if (reserve.state && reserve.isForRanking && rankingResultExpired(reserve)) return { expired: true as const };
      await this.rankingPolicy.assertResultAllowed(reserve, session);
      if (await this.matchRankingModel.exists({ matchId: dto.matchId }).session(session))
        throw new ConflictException({
          code: 'RESULT_ALREADY_REGISTERED',
          message: 'El resultado de este partido ya fue registrado.',
        });
      const teamSize = reserve.isDouble ? 2 : 1;
      const a = players.slice(0, teamSize);
      const b = players.slice(teamSize);
      const winner = dto.winnerSide === 'A' ? a : b;
      const looser = dto.winnerSide === 'A' ? b : a;
      const changes: {
        email: string;
        name: string;
        category: string;
        before: number;
        delta: number;
        after: number;
        isWinner: boolean;
      }[] = [];
      if (reserve.isDouble) {
        for (const player of players) {
          const category = this._resolveDoublesCategory(player);
          const before = await this.storedPoints(player.email, category, session);
          const isWinner = winner.some((row) => row.email === player.email);
          const delta = isWinner ? 300 : 50;
          changes.push({
            email: player.email,
            name: player.name,
            category,
            before,
            delta,
            after: before + delta,
            isWinner,
          });
        }
      } else {
        const calculation = await this.calculateSinglesValidPoints({ winner, looser }, session);
        changes.push(
          {
            email: winner[0].email,
            name: winner[0].name,
            category: calculation.winnerCategory,
            before: calculation.winnerPoints - calculation.winnerPointChange,
            delta: calculation.winnerPointChange,
            after: calculation.winnerPoints,
            isWinner: true,
          },
          {
            email: looser[0].email,
            name: looser[0].name,
            category: calculation.looserCategory,
            before: calculation.looserPoints - calculation.looserPointChange,
            delta: calculation.looserPointChange,
            after: calculation.looserPoints,
            isWinner: false,
          },
        );
      }
      for (const change of changes) {
        if (!Number.isSafeInteger(change.after) || change.after < 0)
          throw new BadRequestException('El puntaje calculado requiere revisión administrativa.');
        const updated = await this.pointsModel
          .updateOne(
            { playerEmail: change.email, category: change.category, isActive: true, points: change.before },
            { $set: { points: change.after } },
            { session },
          )
          .exec();
        if (updated.matchedCount !== 1)
          throw new ConflictException({
            code: 'POINTS_CHANGED',
            message: 'Las categorías o los puntajes cambiaron. Actualiza el partido e intenta nuevamente.',
          });
      }
      const claimed = await this.courtReserveModel
        .updateOne(
          {
            _id: reserve._id,
            state: true,
            resultMatchUpdated: { $ne: true },
            rankingResultStatus: { $nin: ['EXPIRED', 'RECORDED'] },
          },
          { $set: { resultMatchUpdated: true, rankingResultStatus: 'RECORDED' } },
          { session },
        )
        .exec();
      if (claimed.matchedCount !== 1)
        throw new ConflictException({
          code: 'RESULT_ALREADY_REGISTERED',
          message: 'El resultado de este partido ya fue registrado.',
        });
      const result = new this.matchRankingModel({
        matchId: dto.matchId,
        result: dto.result,
        winner,
        looser,
        recordedBy: member.email,
        pointChanges: changes,
      });
      await result.save({ session });
      return { result: result.toObject(), changes, winner, looser, actorName: member.namePlayer };
    });
    if ('expired' in saved)
      throw new ConflictException({
        code: 'RESULT_DEADLINE_EXPIRED',
        message: 'Este partido venció y quedó sin puntos. No bloquea nuevas reservas ni resultados posteriores.',
      });
    try {
      await this.courtReserveService.logResultMatchUpdate(dto.matchId, saved.actorName);
    } catch (error) {
      this.logger.error('El resultado fue guardado, pero falló su registro de auditoría.', error);
    }
    // Notifications are external side effects and must never precede the transaction commit.
    for (const change of saved.changes) {
      const opponents = (change.isWinner ? saved.looser : saved.winner).map((row) => row.name).join(' y ');
      void this._sendPointsUpdateEmail(
        change.email,
        change.name,
        change.isWinner,
        opponents,
        dto.result,
        change.before,
        change.after,
      );
    }
    return saved.result;
  }

  private async storedPoints(email: string, category: string, session?: ClientSession): Promise<number> {
    if (!session) return this.playerCategoryPointsService.getPoints(email, category);
    const row = await this.pointsModel
      .findOne({ playerEmail: email, category, isActive: true })
      .session(session)
      .lean()
      .exec();
    if (!row || !Number.isSafeInteger(row.points) || row.points < 0)
      throw new BadRequestException('El participante no tiene un puntaje válido en la categoría del partido.');
    return row.points;
  }

  private async loadPlayers(reserve: CourtReserve, session: ClientSession): Promise<RankingPlayer[]> {
    const names = rankingParticipants(reserve);
    const players: RankingPlayer[] = [];
    for (const name of names) {
      const matches = await this.registerModel
        .find({ namePlayer: name })
        .select('namePlayer email cellular')
        .session(session)
        .lean()
        .exec();
      if (matches.length !== 1)
        throw new BadRequestException('No se pudo identificar de forma única a un participante del partido.');
      const member = matches[0];
      const categories = await this.pointsModel.find({ playerEmail: member.email }).session(session).lean().exec();
      players.push({
        name: member.namePlayer,
        email: member.email,
        cellular: member.cellular,
        categories: categories.map((row) => ({
          category: row.category,
          points: row.points,
          isActive: row.isActive === true,
        })),
      });
    }
    if (new Set(players.map((row) => row.email)).size !== names.length)
      throw new BadRequestException('Los participantes no tienen identidades únicas.');
    return players;
  }

  private async authorize(players: RankingPlayer[], actor: RankingActor, session: ClientSession) {
    if (!actor?.email) throw new ForbiddenException('Inicia sesión para registrar un resultado.');
    const member = await this.registerModel
      .findOne({ email: actor.email.toLowerCase() })
      .select('namePlayer email role')
      .session(session)
      .lean()
      .exec();
    if (!member || (member.role !== 'admin' && !players.some((row) => row.email === member.email)))
      throw new ForbiddenException('Solo los participantes o un administrador pueden registrar este resultado.');
    return member;
  }

  async getPendingMatches(actor: RankingActor, playerEmail?: string) {
    const session = await this.registerModel.db.startSession();
    try {
      return await session.withTransaction(
        async () => {
          if (!actor?.email) throw new ForbiddenException('Inicia sesión para revisar resultados.');
          const reviewer = await this.registerModel
            .findOne({ email: actor.email.toLowerCase() })
            .select('namePlayer email role')
            .session(session)
            .lean()
            .exec();
          if (!reviewer) throw new ForbiddenException('Usuario no encontrado.');
          const target = playerEmail?.trim().toLowerCase() || reviewer.email;
          if (target !== reviewer.email && reviewer.role !== 'admin')
            throw new ForbiddenException('Solo un administrador puede revisar los pendientes de otro socio.');
          const member =
            target === reviewer.email
              ? reviewer
              : await this.registerModel
                  .findOne({ email: target })
                  .select('namePlayer email')
                  .session(session)
                  .lean()
                  .exec();
          if (!member) throw new NotFoundException('Socio no encontrado.');
          const current = await this.rankingPolicy.currentFor([member.namePlayer], session);
          const matches = [];
          for (const reserve of current) {
            const recordedResult = await this.matchRankingModel
              .findOne({ matchId: reserve.idCourtReserve })
              .session(session)
              .lean()
              .exec();
            if (recordedResult && (!reserve.resultMatchUpdated || reserve.rankingResultStatus !== 'RECORDED')) {
              await this.courtReserveModel
                .updateOne(
                  { idCourtReserve: reserve.idCourtReserve },
                  { $set: { resultMatchUpdated: true, rankingResultStatus: 'RECORDED' } },
                  { session },
                )
                .exec();
            }
            const recorded = Boolean(
              recordedResult || reserve.resultMatchUpdated || reserve.rankingResultStatus === 'RECORDED',
            );
            const players = recorded
              ? rankingParticipants(reserve).map(
                  (name) =>
                    [...(recordedResult?.winner ?? []), ...(recordedResult?.looser ?? [])].find(
                      (player) => player.name === name,
                    ) ?? { name, email: '', cellular: '', categories: [] },
                )
              : await this.loadPlayers(reserve, session);
            let blocked = recorded
              ? {
                  code: 'RESULT_ALREADY_REGISTERED',
                  message: 'Uno de los participantes ya ingresó el resultado de este partido.',
                }
              : await this.rankingPolicy.resultBlock(reserve, session);
            const stats = players.map((player) => {
              const active = player.categories.filter(
                (row) =>
                  row.isActive &&
                  (reserve.isDouble
                    ? row.category === DOUBLES_CATEGORY
                    : MAIN_SINGLES_CATEGORIES.includes(row.category)),
              );
              const valid = active.length === 1 && Number.isSafeInteger(active[0].points) && active[0].points >= 0;
              if (!valid && !blocked)
                blocked = {
                  code: 'CATEGORY_UNAVAILABLE',
                  message: 'Un participante requiere revisión de su categoría o puntaje activo.',
                };
              return {
                name: player.name,
                email: player.email,
                category:
                  recordedResult?.pointChanges?.find((change) => change.email === player.email)?.category ??
                  (active.length === 1 ? active[0].category : null),
                points: recorded
                  ? (recordedResult?.pointChanges?.find((change) => change.email === player.email)?.after ?? null)
                  : active.length === 1
                    ? active[0].points
                    : null,
              };
            });
            matches.push({
              idCourtReserve: reserve.idCourtReserve,
              court: reserve.court,
              dateToPlay: reserve.dateToPlay,
              turn: reserve.turn,
              isDouble: reserve.isDouble,
              phase: recorded
                ? 'RECORDED'
                : rankingTimes(reserve).endAt.toMillis() > Date.now()
                  ? 'CURRENT'
                  : 'AWAITING_RESULT',
              players: stats,
              canRegister: blocked === null,
              blockedReason: blocked?.message ?? null,
              blockedCode: blocked?.code ?? null,
              result: recorded
                ? {
                    score: recordedResult?.result ?? null,
                    winners: recordedResult?.winner?.map((player) => player.name) ?? [],
                  }
                : null,
            });
          }
          return {
            matches,
            member: { name: member.namePlayer, email: member.email },
            totalPending: matches.filter((match) => match.phase !== 'RECORDED').length,
            serverNow: new Date().toISOString(),
          };
        },
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
      );
    } finally {
      await session.endSession();
    }
  }

  async validateMatch(dto: ValidateMatchDto, actor: RankingActor) {
    const response = await this.courtReserveService.validateIdReserve(dto);
    const session = await this.registerModel.db.startSession();
    try {
      await session.withTransaction(async () => {
        await this.authorize(response.dataPlayers, actor, session);
      });
      return response;
    } finally {
      await session.endSession();
    }
  }

  async getRanking(): Promise<RankingPorCategoria> {
    try {
      // 1. Obtener TODOS los jugadores activos
      const activePlayers = await this.registerModel.find({ statePlayer: true }).exec();

      // 2. Obtener todas las categorías de puntos
      // Si no hay filtro de email, obtener todos los registros activos
      const allPlayerCategories = await this.playerCategoryPointsService['playerCategoryPointsModel'].find({ isActive: true }).exec();

      // 3. Agrupar por categoría y matchType
      const groupedByCategory: Record<string, any[]> = {};

      for (const playerCat of allPlayerCategories) {
        const player = activePlayers.find((p) => p.email === playerCat.playerEmail);
        if (!player) continue; // Skip si el jugador no está activo

        // Crear key única: "categoria_matchType" (ej: "1_singles", "1_doubles")
        const key = `${playerCat.category}`;

        if (!groupedByCategory[key]) {
          groupedByCategory[key] = [];
        }

        groupedByCategory[key].push({
          id: player.email,
          nombre: player.namePlayer,
          puntos: playerCat.points,
          categoria: playerCat.category as PlayerCategory,
          rank: 0, // Se asignará después
          cellular: player.cellular,
          imageUrlProfile: player.imageUrlProfile,
        });
      }

      // 4. Ordenar cada grupo y asignar ranking
      const finalRanking: RankingPorCategoria = {};

      for (const key in groupedByCategory) {
        const [categoria] = key.split('_');
        const categoryKey = `${categoria}`; // ✅ Formato: "1-singles", "Damas-doubles", "+55-singles"

        finalRanking[categoryKey] = groupedByCategory[key]
          .sort((a, b) => b.puntos - a.puntos) // Ordenar de mayor a menor
          .map((p, index) => ({ ...p, rank: index + 1 })); // Asignar ranking
      }

      return finalRanking;
    } catch (error) {
      this.logger.error('Error al obtener el ranking por categorías:', error.message, error.stack);
      throw new Error('No se pudo obtener el ranking de jugadores.');
    }
  }

  async getPlayerResults(email: string): Promise<Resultado[]> {
    try {
      const player = await this.registerModel.findOne({ email }).exec();
      if (!player) {
        throw new NotFoundException(`Jugador con email ${email} no encontrado.`);
      }

      const playerName = player.namePlayer; // Nombre del jugador para buscar en CourtReserve

      const currentYear = new Date().getFullYear();
      const yearStart = `${currentYear}-01-01`;
      const yearEnd = `${currentYear}-12-31`;

      const courtReservesQuery: any = {
        resultMatchUpdated: true,
        state: true,
        isForRanking: true,
        dateToPlay: { $gte: yearStart, $lte: yearEnd },
        $or: [{ player1: playerName }, { player2: playerName }, { player3: playerName }, { player4: playerName }],
      };

      const playerCourtReserves = await this.courtReserveModel.find(courtReservesQuery).exec();

      // IDs de los partidos relevantes para el jugador
      const relevantMatchIds = playerCourtReserves.map((cr) => cr.idCourtReserve);

      // Obtener los resultados de esos partidos.
      // Aquí necesitamos saber si el jugador ganó o perdió.
      // La colección MatchRanking solo guarda a los ganadores.
      // Para saber si perdió, necesitaríamos que MatchRanking también guarde los perdedores,
      // o que CourtReserve tenga un campo para el ganador y perdedor directo.
      // Por ahora, solo mostraremos los partidos donde el jugador está listado como ganador en MatchRanking.
      const matchResults = await this.matchRankingModel
        .find({
          matchId: { $in: relevantMatchIds },
          $or: [{ 'winner.email': email }, { 'looser.email': email }],
        })
        .exec();

      const results: Resultado[] = [];
      for (const courtReserve of playerCourtReserves) {
        const matchResult = matchResults.find((mr) => mr.matchId === courtReserve.idCourtReserve);
        // eslint-disable-next-line max-len
        const isWinner = matchResult ? matchResult.winner.some((w) => w.email === email) : false; // Asume false si no hay MatchResult (partido no ganado o no registrado)

        // Determinar el rival/rivales
        const playersInMatch = [courtReserve.player1, courtReserve.player2, courtReserve.player3, courtReserve.player4].filter((p) => p && p !== playerName);

        let rivalName = 'N/A';
        if (playersInMatch.length > 0) {
          // Si es un partido individual, el rival es el otro jugador
          // Si es un partido de dobles, los rivales son los otros dos jugadores
          // Esto es una simplificación, podrías necesitar más lógica para dobles vs individuales
          rivalName = playersInMatch.join(' , ');
        }

        results.push({
          id: courtReserve.idCourtReserve,
          jugadorId: email,
          fecha: courtReserve.dateToPlay,
          rival: rivalName,
          score: matchResult ? matchResult.result : 'N/A',
          ganador: isWinner,
          isDouble: courtReserve.isDouble ?? false,
        });
      }

      // Ordenar los resultados por fecha descendente
      results.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

      return results;
    } catch (error) {
      this.logger.error(`Error al obtener resultados para ${email}:`, error.message, error.stack);
      throw new Error('No se pudieron obtener los resultados del jugador.');
    }
  }

  async findAll(): Promise<MatchResultDocument[]> {
    return this.matchRankingModel.find().sort({ createdAt: -1 }).exec();
  }

  findOne(id: string) {
    this.logger.log({ id });
    return this.matchRankingModel.findOne({ id });
  }

  update(id: number, updateMatchRankingDto: UpdateMatchRankingDto) {
    this.logger.log({ updateMatchRankingDto });
    return `This action updates a #${id} matchRanking`;
  }

  remove(id: number) {
    return `This action removes a #${id} matchRanking`;
  }

  private _getActiveCategories(categories: Array<{ category: string; points: number; isActive: boolean }>) {
    return (categories || []).filter((item) => item?.isActive);
  }

  /**
   * Por ahora singles se resuelve SIEMPRE desde la categoría principal 1-4 de cada jugador.
   * Las categorías especiales (+55, +65, Damas, Menores, etc.) quedan para una integración futura del frontend.
   */
  private _resolveSinglesCategories(
    winnerData: { email: string; categories: Array<{ category: string; points: number; isActive: boolean }> },
    looserData: { email: string; categories: Array<{ category: string; points: number; isActive: boolean }> },
  ): { winnerCategory: string; looserCategory: string } {
    const winnerCategory = this._getMainSinglesCategory(winnerData.categories, winnerData.email);
    const looserCategory = this._getMainSinglesCategory(looserData.categories, looserData.email);

    if (winnerCategory !== looserCategory) {
      // Solo permitir distinta categoría entre jugadores 1-4 (distinto nivel)
      const bothMain = this.MAIN_SINGLES_CATEGORIES.includes(winnerCategory) && this.MAIN_SINGLES_CATEGORIES.includes(looserCategory);
      if (!bothMain) {
        throw new BadRequestException(`Partido inválido: categorías especiales distintas (${winnerCategory} vs ${looserCategory})`);
      }
    }

    return { winnerCategory, looserCategory };
  }

  private _getMainSinglesCategory(categories: Array<{ category: string; points: number; isActive: boolean }>, email: string): string {
    const activeMainCategories = this._getActiveCategories(categories).filter((item) => this.MAIN_SINGLES_CATEGORIES.includes(item.category));

    if (activeMainCategories.length !== 1) {
      throw new BadRequestException(`Jugador ${email} debe tener exactamente una categoría principal activa (1, 2, 3 o 4). Encontradas: ${activeMainCategories.length}`);
    }

    return activeMainCategories[0].category;
  }

  private _resolveDoublesCategory(playerData: { email: string; categories: Array<{ category: string; points: number; isActive: boolean }> }): string {
    const activeCategories = this._getActiveCategories(playerData.categories);
    const doublesCategory = activeCategories.find((item) => item.category === this.DOUBLES_CATEGORY);

    if (!doublesCategory) {
      throw new BadRequestException(`Jugador ${playerData.email} no tiene categoría Dobles activa`);
    }

    return doublesCategory.category;
  }

  private async _sendPointsUpdateEmail(playerEmail: string, playerName: string, isWinner: boolean, opponentName: string, score: string, oldPoints: number, newPoints: number) {
    const subject = 'Actualización de puntaje de ranking';
    const html = buildRankingPointsEmail({ playerName, isWinner, opponentName, score, oldPoints, newPoints });

    try {
      await this.emailService.sendEmail({ to: playerEmail, subject, html });
      this.logger.log(`Email de actualización de puntaje enviado a ${playerEmail}`);
    } catch (error) {
      this.logger.error(`No se pudo enviar el email de puntaje a ${playerEmail}`, error);
    }
  }
}
