import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateMatchRankingDto } from './dto/create-match-ranking.dto';
import { UpdateMatchRankingDto } from './dto/update-match-ranking.dto';
import { ValidateMatchDto } from './dto/validate-match.dto';
import { InjectModel } from '@nestjs/mongoose';
import { MatchRanking, MatchResultDocument } from './entities/match-ranking.entity';
import { Model } from 'mongoose';
import { CourtReserveService } from '../court-reserve/court-reserve.service';
import { RegisterService } from '../register/register.service';
import { CourtReserve, CourtReserveDocument } from '../court-reserve/entities/court-reserve.entity';
import { Register, RegisterDocument } from '../register/entities/register.entity';
import { PlayerCategory, RankingPorCategoria, Resultado } from './interfaces/tennis.types';

@Injectable()
export class MatchRankingService {
  logger = new Logger('MatchRankingService');

  constructor(
    @InjectModel(MatchRanking.name) private readonly matchRankingModel: Model<MatchResultDocument>,
    @InjectModel(CourtReserve.name) private readonly courtReserveModel: Model<CourtReserveDocument>,
    @InjectModel(Register.name) private readonly registerModel: Model<RegisterDocument>,
    private readonly courtReserveService: CourtReserveService,
    private readonly registerService: RegisterService,
  ) {}

  calculateSinglesValidPoints(createMatchRankingDto: CreateMatchRankingDto) {
    this.logger.log(createMatchRankingDto);
    const winnerData = createMatchRankingDto.winner[0];
    const looserData = createMatchRankingDto.looser[0];
    const winnerPts = typeof winnerData.points === 'string' ? parseInt(winnerData.points, 10) : winnerData.points;
    const looserPts = typeof looserData.points === 'string' ? parseInt(looserData.points, 10) : looserData.points;
    const winnerCat = winnerData.category;
    const looserCat = looserData.category;

    let winnerPointChange = 0;
    let looserPointChange = 0;
    const baseWin = 300;
    const baseLose = 100;
    let detail: string;

    if (winnerCat === looserCat) {
      winnerPointChange = baseWin;
      looserPointChange = baseLose;
      if (parseInt(String(winnerPts)) < parseInt(String(looserPts))) {
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
        looserPointChange = 100;
        detail = 'Distintas cat: gana superior → +150/+100';
      }
    }
    return {
      winnerPoints: winnerPts + winnerPointChange,
      looserPoints: looserPts + looserPointChange,
      detail: detail,
    };
  }

  async create(createMatchRankingDto: CreateMatchRankingDto) {
    this.logger.log({ createMatchRankingDto });
    if (createMatchRankingDto.winner.length === 1) {
      const { winnerPoints, looserPoints, detail } = this.calculateSinglesValidPoints(createMatchRankingDto);
      this.logger.log({ winnerPoints, looserPoints, detail });
      await this.registerService.updateByEmail(createMatchRankingDto.winner[0].email, {
        points: winnerPoints.toString(),
      });
      await this.registerService.updateByEmail(createMatchRankingDto.looser[0].email, {
        points: looserPoints.toString(),
      });
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
      // 1. Obtener TODOS los jugadores activos en una sola consulta.
      const activePlayers = await this.registerModel.find({ statePlayer: true }).exec();

      // 2. Agrupar los jugadores por categoría usando un objeto.
      const groupedByCategoria: Record<string, RegisterDocument[]> = activePlayers.reduce((acc, player) => {
        const categoria = player.category;
        if (!acc[categoria]) {
          acc[categoria] = []; // Si la categoría no existe en el acumulador, la inicializamos.
        }
        acc[categoria].push(player); // Agregamos el jugador a su categoría correspondiente.
        return acc;
      }, {});

      // 3. Procesar cada categoría para ordenar y asignar el ranking.
      const finalRanking: RankingPorCategoria = {};

      for (const categoria in groupedByCategoria) {
        const jugadoresDeCategoria = groupedByCategoria[categoria];

        // Mapeamos, ordenamos por puntos y asignamos el rank DENTRO de la categoría.
        finalRanking[categoria] = jugadoresDeCategoria
          .map((p) => ({
            id: p.email,
            nombre: p.namePlayer,
            puntos: parseInt(p.points, 10) || 0,
            categoria: p.category as PlayerCategory,
            rank: 0, // Placeholder, se asignará en el siguiente paso.
            cellular: p.cellular,
          }))
          .sort((a, b) => b.puntos - a.puntos) // Ordenar de mayor a menor por puntos.
          .map((p, index) => ({ ...p, rank: index + 1 })); // Asignar el ranking secuencial.
      }

      return finalRanking;
    } catch (error) {
      this.logger.error('Error al obtener el ranking por categorías:', error.message, error.stack);
      throw new Error('No se pudo obtener el ranking de jugadores.');
    }
  }

  async getPlayerResults(email: string, periodo: string): Promise<Resultado[]> {
    try {
      const player = await this.registerModel.findOne({ email }).exec();
      if (!player) {
        throw new NotFoundException(`Jugador con email ${email} no encontrado.`);
      }

      const playerName = player.namePlayer; // Nombre del jugador para buscar en CourtReserve

      let startDate: Date | null = null;
      const endDate = new Date(); // Hoy

      if (periodo === 'semana') {
        startDate = new Date();
        startDate.setDate(endDate.getDate() - 7);
      } else if (periodo === 'mes') {
        startDate = new Date();
        startDate.setMonth(endDate.getMonth() - 1);
      }

      const courtReservesQuery: any = {
        isForRanking: true,
        $or: [{ player1: playerName }, { player2: playerName }, { player3: playerName }, { player4: playerName }],
      };

      if (startDate) {
        courtReservesQuery.dateToPlay = {
          $gte: startDate.toISOString().split('T')[0],
          $lte: endDate.toISOString().split('T')[0],
        };
      }

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
          'winner.email': email, // Filtra solo los resultados donde este jugador fue el ganador
        })
        .exec();

      const results: Resultado[] = [];
      for (const courtReserve of playerCourtReserves) {
        const matchResult = matchResults.find((mr) => mr.matchId === courtReserve.idCourtReserve);
        // eslint-disable-next-line max-len
        const isWinner = matchResult ? matchResult.winner.some((w) => w.email === email) : false; // Asume false si no hay MatchResult (partido no ganado o no registrado)

        // Determinar el rival/rivales
        const playersInMatch = [
          courtReserve.player1,
          courtReserve.player2,
          courtReserve.player3,
          courtReserve.player4,
        ].filter((p) => p && p !== playerName);

        let rivalName = 'N/A';
        if (playersInMatch.length > 0) {
          // Si es un partido individual, el rival es el otro jugador
          // Si es un partido de dobles, los rivales son los otros dos jugadores
          // Esto es una simplificación, podrías necesitar más lógica para dobles vs individuales
          rivalName = playersInMatch.join(' y ');
        }

        results.push({
          id: courtReserve.idCourtReserve,
          jugadorId: email,
          fecha: courtReserve.dateToPlay,
          rival: rivalName,
          score: matchResult ? matchResult.result : 'N/A', // Si no hay MatchResult, no hay score
          ganador: isWinner,
          // torneo: courtReserve.tournamentName // Si tu CourtReserve tuviera un campo de torneo
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

  findAll() {
    return `This action returns all matchRanking`;
  }

  findOne(id: number) {
    return `This action returns a #${id} matchRanking 11111`;
  }

  update(id: number, updateMatchRankingDto: UpdateMatchRankingDto) {
    this.logger.log({ updateMatchRankingDto });
    return `This action updates a #${id} matchRanking`;
  }

  remove(id: number) {
    return `This action removes a #${id} matchRanking`;
  }
}
