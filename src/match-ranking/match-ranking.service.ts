import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateMatchRankingDto } from './dto/create-match-ranking.dto';
import { UpdateMatchRankingDto } from './dto/update-match-ranking.dto';
import { ValidateMatchDto } from './dto/validate-match.dto';
import { InjectModel } from '@nestjs/mongoose';
import { MatchRanking, MatchResultDocument } from './entities/match-ranking.entity';
import { Model } from 'mongoose';
import { CourtReserveService } from '../court-reserve/court-reserve.service';
import { RegisterService } from '../register/register.service';
import { PlayerCategoryPointsService } from '../player-category-points/player-category-points.service';
import { CourtReserve, CourtReserveDocument } from '../court-reserve/entities/court-reserve.entity';
import { Register, RegisterDocument } from '../register/entities/register.entity';
import { PlayerCategory, RankingPorCategoria, Resultado } from './interfaces/tennis.types';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { DOUBLES_CATEGORY, MAIN_SINGLES_CATEGORIES } from '../register/enums/category.enum';

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
  ) {}

  async calculateSinglesValidPoints(createMatchRankingDto: CreateMatchRankingDto) {
    this.logger.log(createMatchRankingDto);
    const winnerData = createMatchRankingDto.winner[0];
    const looserData = createMatchRankingDto.looser[0];
    const { winnerCategory, looserCategory } = this._resolveSinglesCategories(winnerData, looserData);

    // Obtener puntos actuales desde player_category_points
    const winnerPts = await this.playerCategoryPointsService.getPoints(winnerData.email, winnerCategory);
    const looserPts = await this.playerCategoryPointsService.getPoints(looserData.email, looserCategory);

    const winnerCat = winnerCategory;
    const looserCat = looserCategory;
    const isSpecialCategorySingles = !this.MAIN_SINGLES_CATEGORIES.includes(winnerCat) || !this.MAIN_SINGLES_CATEGORIES.includes(looserCat);

    let winnerPointChange = 0;
    let looserPointChange = 0;
    const baseWin = 300;
    const baseLose = 50;
    let detail: string;

    // Categorías especiales (+55, +65, etc.) usan fórmula fija
    if (isSpecialCategorySingles) {
      if (winnerCat !== looserCat) {
        throw new BadRequestException(`Partido inválido: categorías especiales distintas (${winnerCat} vs ${looserCat})`);
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

  async create(createMatchRankingDto: CreateMatchRankingDto) {
    this.logger.log({ createMatchRankingDto });
    if (createMatchRankingDto.winner.length === 1) {
      // ✅ PASO 5: Lógica para singles usando PlayerCategoryPointsService
      const winnerData = createMatchRankingDto.winner[0];
      const looserData = createMatchRankingDto.looser[0];

      const { winnerPointChange, looserPointChange, winnerPoints, looserPoints, detail, winnerCategory, looserCategory } = await this.calculateSinglesValidPoints(createMatchRankingDto);

      this.logger.log({
        categoryResolved: 'singles',
        winner: { email: winnerData.email, category: winnerCategory },
        looser: { email: looserData.email, category: looserCategory },
      });

      this.logger.log({ winnerPoints, looserPoints, detail });

      // Actualizar puntos en player_category_points
      await this.playerCategoryPointsService.upsertPoints(winnerData.email, winnerCategory, winnerPointChange);
      await this.playerCategoryPointsService.upsertPoints(looserData.email, looserCategory, looserPointChange);

      // Obtener puntos actuales para el email
      const winnerOldPoints = winnerPoints - winnerPointChange;
      const looserOldPoints = looserPoints - looserPointChange;

      this._sendPointsUpdateEmail(
        winnerData.email,
        winnerData.name,
        true, // isWinner
        looserData.name,
        createMatchRankingDto.result,
        winnerOldPoints,
        winnerPoints,
      );
      this._sendPointsUpdateEmail(
        looserData.email,
        looserData.name,
        false, // isWinner
        winnerData.name,
        createMatchRankingDto.result,
        looserOldPoints,
        looserPoints,
      );
    } else if (createMatchRankingDto.winner.length === 2) {
      const winner1 = createMatchRankingDto.winner[0];
      const winner2 = createMatchRankingDto.winner[1];
      const looser1 = createMatchRankingDto.looser[0];
      const looser2 = createMatchRankingDto.looser[1];
      const winner1Category = this._resolveDoublesCategory(winner1);
      const winner2Category = this._resolveDoublesCategory(winner2);
      const looser1Category = this._resolveDoublesCategory(looser1);
      const looser2Category = this._resolveDoublesCategory(looser2);

      this.logger.log({
        categoryResolved: 'doubles',
        winner: [
          { email: winner1.email, category: winner1Category },
          { email: winner2.email, category: winner2Category },
        ],
        looser: [
          { email: looser1.email, category: looser1Category },
          { email: looser2.email, category: looser2Category },
        ],
      });

      const pointsToWin = 300;
      const pointsToLose = 50;

      // Obtener puntos actuales de doubles
      const winner1OldPoints = await this.playerCategoryPointsService.getPoints(winner1.email, winner1Category);
      const winner2OldPoints = await this.playerCategoryPointsService.getPoints(winner2.email, winner2Category);
      const looser1OldPoints = await this.playerCategoryPointsService.getPoints(looser1.email, looser1Category);
      const looser2OldPoints = await this.playerCategoryPointsService.getPoints(looser2.email, looser2Category);

      // Actualizar puntos en player_category_points
      await this.playerCategoryPointsService.upsertPoints(winner1.email, winner1Category, pointsToWin);
      await this.playerCategoryPointsService.upsertPoints(winner2.email, winner2Category, pointsToWin);
      await this.playerCategoryPointsService.upsertPoints(looser1.email, looser1Category, pointsToLose);
      await this.playerCategoryPointsService.upsertPoints(looser2.email, looser2Category, pointsToLose);

      const winner1NewPoints = winner1OldPoints + pointsToWin;
      const winner2NewPoints = winner2OldPoints + pointsToWin;
      const looser1NewPoints = looser1OldPoints + pointsToLose;
      const looser2NewPoints = looser2OldPoints + pointsToLose;

      // Enviar emails a los ganadores
      const losersNames = `${looser1.name} y ${looser2.name}`;
      this._sendPointsUpdateEmail(winner1.email, winner1.name, true, losersNames, createMatchRankingDto.result, winner1OldPoints, winner1NewPoints);
      this._sendPointsUpdateEmail(winner2.email, winner2.name, true, losersNames, createMatchRankingDto.result, winner2OldPoints, winner2NewPoints);

      // Enviar emails a los perdedores
      const winnersNames = `${winner1.name} y ${winner2.name}`;
      this._sendPointsUpdateEmail(looser1.email, looser1.name, false, winnersNames, createMatchRankingDto.result, looser1OldPoints, looser1NewPoints);
      this._sendPointsUpdateEmail(looser2.email, looser2.name, false, winnersNames, createMatchRankingDto.result, looser2OldPoints, looser2NewPoints);

      this.logger.log('Doubles match processed: Winners +300, Losers +50 (using PlayerCategoryPoints)');
    }
    await this.courtReserveService.updateResultMatch(createMatchRankingDto.matchId);
    const newMatchRanking = new this.matchRankingModel(createMatchRankingDto);
    return newMatchRanking.save();
  }

  async validateMatch(validateMatchDto: ValidateMatchDto) {
    // this.logger.log({ validateMatchDto });
    const response = await this.courtReserveService.validateIdReserve(validateMatchDto);
    this.logger.log({ response });
    return response;
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
    const subject = '🏆 Actualización de Puntaje de Ranking';
    const pointChange = newPoints - oldPoints;
    const changeSymbol = pointChange >= 0 ? '+' : '';
    const changeColor = pointChange >= 0 ? '#4caf50' : '#d32f2f'; // Verde para ganar, rojo para perder

    const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol'; color: #333; max-width: 600px; margin: auto; border: 1px solid #e0e0e0; border-radius: 12px; padding: 25px; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
        <h2 style="color: #0d47a1; text-align: center; margin-top: 0; border-bottom: 2px solid #0d47a1; padding-bottom: 15px;">
        Actualización de Puntaje
        </h2>
        <p style="font-size: 16px;">¡Hola, ${playerName}!</p>
        <p style="font-size: 16px; line-height: 1.6;">Se ha actualizado tu puntaje de ranking tras tu último partido.</p>
        
        <div style="background-color: #f5f8fa; padding: 20px; border-radius: 8px; margin-top: 20px; border: 1px solid #e0e0e0;">
            <p style="font-size: 16px; margin: 12px 0;">
                <strong>Resultado:</strong> 
                <span style="color: ${isWinner ? '#4caf50' : '#d32f2f'}; font-weight: bold;">${isWinner ? 'Victoria' : 'Derrota'}</span>
            </p>
            <p style="font-size: 16px; margin: 12px 0;">
                <strong>Rival:</strong> ${opponentName}
            </p>
            <p style="font-size: 16px; margin: 12px 0;">
                <strong>Marcador:</strong> ${score}
            </p>
            <hr style="border: 0; border-top: 1px solid #ddd; margin: 20px 0;">
            <div style="text-align: center;">
                <p style="font-size: 16px; margin: 10px 0;">Puntaje Anterior: ${oldPoints}</p>
                <p style="font-size: 20px; margin: 10px 0; font-weight: bold; color: ${changeColor};">
                    ${changeSymbol}${pointChange} Puntos
                </p>
                <p style="font-size: 22px; margin: 10px 0; font-weight: bold; color: #0d47a1;">
                    Nuevo Puntaje: ${newPoints}
                </p>
            </div>
        </div>

        <p style="margin-top: 30px; font-size: 16px;">¡Sigue jugando y mejorando tu ranking!</p>
        <p style="margin-top: 10px; font-size: 16px; line-height: 1.6;">Atentamente,<br><strong>Club de Tenis Quintero</strong></p>
    </div>
    `;

    try {
      await this.emailService.sendEmail({ to: playerEmail, subject, html });
      this.logger.log(`Email de actualización de puntaje enviado a ${playerEmail}`);
    } catch (error) {
      this.logger.error(`No se pudo enviar el email de puntaje a ${playerEmail}`, error);
    }
  }
}
