import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateCourtReserveDto } from './dto/create-court-reserve.dto';
import { UpdateCourtReserveDto } from './dto/update-court-reserve.dto';
import { CourtReserve } from './entities/court-reserve.entity';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DateTime } from 'luxon';
import { EmailService } from '../email/email.service';
import { RegisterService } from '../register/register.service';
// import { ConfigService } from '@nestjs/config';
import { TimeSlot } from './interfaces/court-reserve.interface';
import * as XLSX from 'xlsx';

@Injectable()
export class CourtReserveService {
  logger = new Logger(CourtReserveService.name);

  constructor(
    @InjectModel('CourtReserve')
    private readonly courtReserveModel: Model<CourtReserve>,
    private readonly registerService: RegisterService,
    private readonly emailService: EmailService,
  ) {}

  async exportFilteredReservesToExcelBuffer(): Promise<Buffer> {
    const reserves = await this.findFilteredReserves();
    const data = reserves.map((r) => ({
      dateToPlay: r.dateToPlay,
      court: r.court,
      turn: r.turn,
      player1: r.player1,
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Reserves');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  async findFilteredReserves(): Promise<CourtReserve[]> {
    const filter = {
      dateToPlay: {
        $gte: '2025-09-01',
      },
      turn: {
        $in: ['20:15-22:00', '22:15-00:00'],
      },
      state: true,
      isPaidNight: true,
      player1: {
        $nin: ['mantenimiento', 'Mantenimiento', 'clases', 'Clases', 'clima', 'Clima'],
      },
    };
    return this.courtReserveModel.find(filter).select('dateToPlay court turn player1 -_id').exec();
  }

  playerHasActiveReserve = (player: string, activeReserves: any[]) => {
    return activeReserves.some(
      (reserve) =>
        reserve.player1 === player ||
        reserve.player2 === player ||
        reserve.player3 === player ||
        reserve.player4 === player,
    );
  };

  playerActiveReserve = (player: string, activeReserves: CourtReserve[]) => {
    const matchingReserve = activeReserves.find(
      (reserve) =>
        reserve.player1 === player ||
        reserve.player2 === player ||
        reserve.player3 === player ||
        reserve.player4 === player,
    );
    return matchingReserve || null; // Return the matching reservation or null if not found
  };

  validateDateTurn = async (dateToPlay: string, court: string, turn: string): Promise<boolean> => {
    const timezone = 'America/Santiago'; // Chile timezone
    const currentTimeFull = DateTime.now().setZone(timezone); // Current time in the specified timezone
    const currentTime = DateTime.fromFormat(currentTimeFull.toString(), 'HH:mm', { zone: timezone });
    const playDate = DateTime.fromFormat(dateToPlay, 'yyyy-MM-dd');
    const today = DateTime.now().startOf('day');
    if (playDate < today) {
      return false;
    }
    if (playDate.hasSame(today, 'day')) {
      this.logger.log(currentTime);
      const [turnStart, turnEnd] = turn.split('-'); // Split turn into start and end times
      const turnStartTime = DateTime.fromFormat(turnStart, 'HH:mm', { zone: timezone });
      this.logger.log(turnStartTime);
      const turnEndTime = DateTime.fromFormat(turnEnd, 'HH:mm', { zone: timezone });
      this.logger.log(turnEndTime);
      if (currentTime > turnEndTime) {
        this.logger.log('Current time is after the turn.');
        return false;
      }
    }
    const getDateTurn = await this.getAllCourtAvailable(dateToPlay);
    if (!getDateTurn) return false;
    const selectedTurn = getDateTurn.find((item) => item.time === turn);
    if (!selectedTurn) return false;
    const selectedCourt = selectedTurn.slots.find((item) => item.court === court);
    if (!selectedCourt) return false;
    return selectedCourt ? selectedCourt.available : false;
  };

  async adminReserve(createCourtReserveDtoArray: CreateCourtReserveDto[]) {
    const savedReservations = [];
    for (const reservation of createCourtReserveDtoArray) {
      const { dateToPlay, turn, court } = reservation;
      await this.courtReserveModel.findOneAndUpdate({ dateToPlay, turn, court }, { state: false });
      const newCourtReserve = new this.courtReserveModel(reservation);
      const savedReservation = await newCourtReserve.save();
      savedReservations.push(savedReservation);
      this.logger.log(savedReservation);
    }
    return savedReservations;
  }

  async adminCreate(createCourtReserveDto: CreateCourtReserveDto) {
    const { court, turn, dateToPlay } = createCourtReserveDto;
    await this.courtReserveModel.findOneAndUpdate({ dateToPlay, turn, court }, { state: false });
    const newCourtReserve = new this.courtReserveModel(createCourtReserveDto);
    const savedReservation = await newCourtReserve.save();
    this.logger.log(savedReservation);
    return savedReservation;
  }

  async create(createCourtReserveDto: CreateCourtReserveDto) {
    const { player1, player2, player3, player4, court, turn, dateToPlay, isVisit, isDouble } = createCourtReserveDto;
    // const courtNumber = court.match(/\d+/);
    // this.logger.log('createCourtReserveDto--> ', { createCourtReserveDto });
    const validateDateTurn = await this.validateDateTurn(dateToPlay, court, turn);
    // this.logger.log('validateDateTurn--> ', validateDateTurn);
    if (validateDateTurn) {
      const activeReserves = await this.getAllCourtReserves();
      if (activeReserves) {
        let playersToCheck: string[];
        if (isVisit) {
          playersToCheck = [player1];
        } else if (isDouble) {
          playersToCheck = [player1, player3, player4];
        } else {
          playersToCheck = [player1, player2];
        }
        for (const player of playersToCheck) {
          if (player && this.playerHasActiveReserve(player, activeReserves)) {
            const playerActiveReserve = this.playerActiveReserve(player, activeReserves);
            this.logger.log(
              // eslint-disable-next-line max-len
              `Player ${player} already has a reserve, day ${playerActiveReserve.dateToPlay}, turn ${playerActiveReserve.turn}, on ${playerActiveReserve.court}`,
            );
            throw new BadRequestException(
              // eslint-disable-next-line max-len
              `Player ${player} already has a reserve, day ${playerActiveReserve.dateToPlay}, turn ${playerActiveReserve.turn}, on ${playerActiveReserve.court}`,
            );
          }
        }
        const isCourtReserve = activeReserves.find(
          (courtReserve) =>
            courtReserve.court === court && courtReserve.turn === turn && courtReserve.dateToPlay === dateToPlay,
        );
        if (isCourtReserve) {
          throw new BadRequestException('This court is already reserved for this time');
        }
      }
      await this.registerService.findOneAndUpdate(player1, { isLigthNigth: true });
      const newCourtReserve = new this.courtReserveModel(createCourtReserveDto);
      const response = await newCourtReserve.save();
      await this.sendEmailReserve(response);
      // this.logger.log(response);
      return response;
    } else {
      throw new BadRequestException('Invalid input');
    }
  }

  async findAll() {
    return await this.courtReserveModel.find();
  }

  async validateIdReserve({ id, pass }) {
    const getShortNames = (names: string[]): string[] =>
      names.map((name) => {
        const nameParts = name.split(' ');
        const firstInitial = `${nameParts[0][0]}.`;
        const lastName = nameParts.length > 2 ? nameParts[nameParts.length - 2] : nameParts[1];
        return `${firstInitial} ${lastName}`;
      });
    // this.logger.log(id, pass);
    let player1Data;
    let player2Data;
    let player3Data;
    let player4Data;

    const reserves = await this.courtReserveModel
      .findOne({
        idCourtReserve: id,
        passCourtReserve: pass,
        isForRanking: true,
      })
      .select('idCourtReserve court turn dateToPlay player1 player2 player3 player4 isDouble state resultMatchUpdated');
    if (reserves === null) {
      throw new BadRequestException('No se encontro la reserva');
    }
    if (!reserves.state) {
      throw new BadRequestException('Reserva no valida, fue cancelada');
    }

    if (reserves.resultMatchUpdated) {
      throw new BadRequestException('Reserva ya fue actualizada');
    }

    const timezone = 'America/Santiago';
    const matchDate = DateTime.fromISO(reserves.dateToPlay, { zone: timezone }).startOf('day');
    const currentDate = DateTime.now().setZone(timezone).startOf('day');

    const diffInDays = currentDate.diff(matchDate, 'days').days;

    if (diffInDays > 2) {
      throw new BadRequestException(
        'No se puede actualizar el resultado. El plazo para hacerlo ha expirado (2 días después del partido).',
      );
    }

    if (reserves) {
      if (reserves.isDouble) {
        player3Data = await this.registerService.findOneEmail(reserves.player3);
        player4Data = await this.registerService.findOneEmail(reserves.player4);
      }
      player1Data = await this.registerService.findOneEmail(reserves.player1);
      player2Data = await this.registerService.findOneEmail(reserves.player2);
    }

    if (reserves.isDouble) {
      return {
        isValid: true,
        players: getShortNames([reserves.player1, reserves.player2, reserves.player3, reserves.player4]),
        isDouble: reserves.isDouble,
        dataPlayers: [player1Data, player2Data, player3Data, player4Data],
        dateToPlay: reserves.dateToPlay,
      };
    } else
      return {
        isValid: true,
        players: getShortNames([reserves.player1, reserves.player2]),
        isDouble: reserves.isDouble,
        dataPlayers: [player1Data, player2Data],
        dateToPlay: reserves.dateToPlay,
      };
  }

  update(id: number, updateCourtReserveDto: UpdateCourtReserveDto) {
    this.logger.log('updateCourtReserveDto', updateCourtReserveDto);
    return `This action updates a #${id} courtReserve`;
  }

  async updateResultMatch(idCourtReserve: string) {
    const updatedReserve = await this.courtReserveModel.findOneAndUpdate(
      { idCourtReserve: idCourtReserve },
      { resultMatchUpdated: true },
      { new: true },
    );
    if (!updatedReserve) {
      throw new NotFoundException(`Reserve with idCourtReserve ${idCourtReserve} not found or already updated`);
    }
    this.logger.log(`Match result updated for reserve: ${idCourtReserve}`);
    return updatedReserve;
  }

  async remove(idCourtReserve: string) {
    const updatedRegister = await this.courtReserveModel
      .findOneAndUpdate({ idCourtReserve: idCourtReserve }, { state: false }, { new: true })
      .exec();
    if (!updatedRegister) {
      throw new NotFoundException(`Register with idCourtReserve ${idCourtReserve} not found`);
    }
    return updatedRegister;
  }

  async getAllCourtAvailable(selectedDate: string) {
    const formatPlayerNames = (players: { [key: string]: string }): string => {
      return Object.values(players)
        .filter((name) => name) // Remove empty names
        .map((name) => {
          const nameParts = name.split(' ');
          const firstInitial = nameParts[0][0].toUpperCase();
          const lastName = nameParts.length > 2 ? nameParts[nameParts.length - 2] : nameParts[nameParts.length - 1];
          return `${firstInitial}. ${lastName.charAt(0).toUpperCase() + lastName.slice(1).toLowerCase()}`;
        })
        .join(', ');
    };

    const activeReserves = await this.courtReserveModel
      .find({ dateToPlay: selectedDate, state: true })
      .select([
        'dateToPlay',
        'court',
        'turn',
        'player1',
        'player2',
        'player3',
        'player4',
        'isDouble',
        'isVisit',
        'visitName',
        'isBlockedByAdmin',
        'blockedMotive',
      ])
      .exec();
    // this.logger.log(activeReserves);
    const AllTimeSlotsAvailable: TimeSlot[] = [
      {
        time: '08:15-10:00',
        slots: [
          { available: true, court: 'Cancha 1', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 2', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 3', isPayed: false, isBlockedByAdmin: false, data: null },
        ],
      },
      {
        time: '10:15-12:00',
        slots: [
          { available: true, court: 'Cancha 1', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 2', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 3', isPayed: false, isBlockedByAdmin: false, data: null },
        ],
      },
      {
        time: '12:15-14:00',
        slots: [
          { available: true, court: 'Cancha 1', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 2', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 3', isPayed: false, isBlockedByAdmin: false, data: null },
        ],
      },
      {
        time: '14:15-16:00',
        slots: [
          { available: true, court: 'Cancha 1', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 2', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 3', isPayed: false, isBlockedByAdmin: false, data: null },
        ],
      },
      {
        time: '16:15-18:00',
        slots: [
          { available: true, court: 'Cancha 1', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 2', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 3', isPayed: false, isBlockedByAdmin: false, data: null },
        ],
      },
      {
        time: '18:15-20:00',
        slots: [
          { available: true, court: 'Cancha 1', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 2', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 3', isPayed: false, isBlockedByAdmin: false, data: null },
        ],
      },
      {
        time: '20:15-22:00',
        slots: [
          { available: true, court: 'Cancha 1', isPayed: true, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 2', isPayed: true, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 3', isPayed: true, isBlockedByAdmin: false, data: null },
        ],
      },
      {
        time: '22:15-00:00',
        slots: [
          { available: true, court: 'Cancha 1', isPayed: true, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 2', isPayed: true, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 3', isPayed: true, isBlockedByAdmin: false, data: null },
        ],
      },
    ];
    const generateTimeSlotAvailability = () => {
      return AllTimeSlotsAvailable.map((timeSlot) => ({
        time: timeSlot.time,
        slots: timeSlot.slots.map((slot) => ({ ...slot })),
      }));
    };
    const availability = generateTimeSlotAvailability();
    availability.forEach((turn) => {
      if (activeReserves.length > 0) {
        // this.logger.log(activeReserves);
        activeReserves.forEach((reserve) => {
          if (turn.time === reserve.turn) {
            const court = turn.slots.find((slot) => slot.court === reserve.court);
            if (court) {
              court.available = false;
              if (!reserve.isBlockedByAdmin) {
                court.data = formatPlayerNames({
                  player1: reserve.player1,
                  player2: reserve.player2,
                  player3: reserve.player3,
                  player4: reserve.player4,
                  visitName: reserve.visitName,
                });
              } else {
                court.isBlockedByAdmin = true;
                court.data = reserve.blockedMotive;
              }
            }
          }
        });
      }
    });
    return availability;
  }

  async getAllHistoryReservesFor(namePlayer: string): Promise<CourtReserve[] | null> {
    try {
      return await this.courtReserveModel
        .find({ player1: namePlayer })
        .select('dateToPlay court turn player2 player3 player4 visitName idCourtReserve state')
        .sort({
          dateToPlay: 'desc',
          turn: 'asc',
          court: 'asc',
        })
        .exec();
    } catch (error) {
      this.logger.error(error);
    }
  }

  async getAllReservesFor(namePlayer: string): Promise<CourtReserve[] | null> {
    const timezone = 'America/Santiago'; // Chile timezone
    const currentTime = DateTime.now().setZone(timezone); // Current time in the specified timezone
    const today = currentTime.startOf('day');
    try {
      const courtReserves = await this.courtReserveModel
        .find({
          dateToPlay: { $gte: today.toISODate() },
          state: true,
          $or: [{ player1: namePlayer }, { player2: namePlayer }, { player3: namePlayer }, { player4: namePlayer }],
        })
        .select('dateToPlay court turn')
        .sort({
          dateToPlay: 'asc',
          turn: 'asc',
          court: 'asc',
        })
        .exec();
      if (courtReserves.length > 0) {
        const filteredReserves = courtReserves.filter((reserve) => {
          const [start, end] = reserve.turn.split('-');
          // Parse start, end, and current times using Luxon
          const startTime = DateTime.fromFormat(start, 'HH:mm', { zone: timezone });
          const endTime = DateTime.fromFormat(end, 'HH:mm', { zone: timezone });
          const reservationDate = DateTime.fromISO(reserve.dateToPlay, { zone: timezone });
          // Condition 1: Check if today is the same as the reservation date
          const isToday = reservationDate.hasSame(today, 'day');
          // Condition 2: Check if the current time is within the time range
          const isWithinTimeRange = (currentTime >= startTime && currentTime < endTime) || currentTime < startTime;
          // Condition 3: Check if the reservation is active (state is true)
          const isFutureDate = reservationDate > today;
          return (isToday && isWithinTimeRange) || isFutureDate;
        });
        // this.logger.log(filteredReserves);
        return filteredReserves.length > 0 ? filteredReserves : null;
      }
    } catch (error) {
      this.logger.error('Error retrieving court reserves:', error);
      throw error; // Optionally re-throw the error to propagate it
    }
  }

  async getAllCourtReserves(): Promise<CourtReserve[] | null> {
    const timezone = 'America/Santiago'; // Chile timezone
    const currentTime = DateTime.now().setZone(timezone); // Current time in the specified timezone
    const today = currentTime.startOf('day');
    try {
      const courtReserves = await this.courtReserveModel
        .find({
          dateToPlay: { $gte: today.toISODate() }, // Filter by today and later
        })
        .sort({
          dateToPlay: 'asc',
          turn: 'asc',
          court: 'asc',
        })
        .exec();
      if (courtReserves.length > 0) {
        const filteredReserves = courtReserves.filter((reserve) => {
          const [start, end] = reserve.turn.split('-');
          const startTime = DateTime.fromFormat(start, 'HH:mm', { zone: timezone });
          const endTime = DateTime.fromFormat(end, 'HH:mm', { zone: timezone });
          const reservationDate = DateTime.fromISO(reserve.dateToPlay, { zone: timezone });
          const isToday = reservationDate.hasSame(today, 'day');
          const isWithinTimeRange = (currentTime >= startTime && currentTime < endTime) || currentTime < startTime;
          const isActive = reserve.state === true;
          const isFutureDate = reservationDate > today;
          return (isToday && isWithinTimeRange && isActive) || (isFutureDate && isActive);
        });
        return filteredReserves.length > 0 ? filteredReserves : null;
      } else {
        this.logger.log('No court reserves found');
        return null;
      }
    } catch (error) {
      this.logger.error('Error retrieving court reserves:', error);
      throw error; // Optionally re-throw the error to propagate it
    }
  }

  async findOneEmail(player: string): Promise<any> {
    return await this.registerService.findOneEmail(player);
  }

  async sendEmailReserve(courtReserve: CourtReserve) {
    const getEmailData = (email: { email: string }, courtReserve: CourtReserve) => {
      // --- Formateo de datos para el correo ---
      const formattedDate = DateTime.fromISO(courtReserve.dateToPlay).toFormat('dd-MM-yyyy');
      const courtNumber = courtReserve.court.replace('Cancha ', '');

      // --- Lógica para el mensaje de mantenimiento ---
      const [turnStart] = courtReserve.turn.split('-');
      const turnStartTime = DateTime.fromFormat(turnStart, 'HH:mm');
      const maintenanceThresholdTime = DateTime.fromFormat('14:15', 'HH:mm');
      const requiresMaintenance = turnStartTime >= maintenanceThresholdTime;

      return {
        to: email.email,
        subject: 'Confirmación de Reserva',
        html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol'; color: #333; max-width: 600px; margin: auto; border: 1px solid #e0e0e0; border-radius: 12px; padding: 25px; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
  
  <h2 style="color: #0d47a1; text-align: center; margin-top: 0; border-bottom: 2px solid #0d47a1; padding-bottom: 15px;">
    🎾 Reserva Confirmada 🎾
  </h2>
  
  <p style="font-size: 16px;">¡Hola!</p>
  <p style="font-size: 16px; line-height: 1.6;">Tu reserva ha sido confirmada con éxito. Aquí tienes los detalles:</p>
  
  <div style="background-color: #f5f8fa; padding: 20px; border-radius: 8px; margin-top: 20px; border: 1px solid #e0e0e0;">
        <!-- SECCIÓN DE PARTIDO MEJORADA -->
    <div style="font-size: 16px; margin: 20px 0;">
      <strong style="display: block; margin-bottom: 10px;">👥 Partido:</strong>
      <div style="text-align: center; padding: 15px; background-color: #ffffff; border: 1px dashed #ccc; border-radius: 8px; font-size: 18px;">
        <div style="margin-bottom: 8px; color: #1e88e5;">
          <strong>
            ${courtReserve.isDouble ? `${courtReserve.player1} y ${courtReserve.player2}` : `${courtReserve.player1}`}
          </strong>
        </div>
        <div style="color: #757575; font-style: italic; font-weight: bold; margin: 8px 0;">vs</div>
        <div style="margin-top: 8px; color: #d32f2f;">
          <strong>
            ${
              courtReserve.isDouble
                ? `${courtReserve.player3} y ${courtReserve.player4}`
                : `${courtReserve.player2 || courtReserve.visitName}`
            }
          </strong>
        </div>
      </div>
    </div>
    <p style="font-size: 16px; margin: 12px 0;">
      <strong>📅 Fecha:</strong> ${formattedDate}
    </p>
    <p style="font-size: 16px; margin: 12px 0;">
      <strong>⏰ Turno:</strong> ${courtReserve.turn}
    </p>
    <p style="font-size: 16px; margin: 12px 0;">
      <strong>📍 Cancha:</strong> ${courtNumber}
    </p>
  </div>

${
  courtReserve.isPaidNight
    ? `
  <div style="margin-top: 25px; padding: 15px; background-color: #fffbe6; border-left: 5px solid #ffc107; color: #856404; border-radius: 5px;">
    <p style="margin: 0; font-size: 15px;"><strong>💲 Horario Pagado:</strong> Por favor, ten en cuenta que este horario requiere pago.</p>
    <div style="margin-top: 10px;">
      <strong>Datos Bancarios</strong><br>
      Banco: Estado<br>
      cta vista: 22970365170<br>
      rut: 65178540-5
    </div>
  </div>`
    : ''
}


  ${
    !courtReserve.isVisit && courtReserve.isForRanking
      ? `
  <div style="margin-top: 25px; padding: 20px; background-color: #e7f3ff; border-left: 5px solid #0056b3; border-radius: 5px;">
    <h3 style="margin-top: 0; color: #004085;">🏆 Actualiza tu Ranking</h3>
    <p style="font-size: 15px; line-height: 1.6;">No olvides registrar el resultado del partido para actualizar tu ranking. Usa los siguientes datos:</p>
    <ul style="font-size: 15px; list-style-type: none; padding-left: 0;">
      <li style="margin-bottom: 8px;"><strong>🔑 ID de Reserva:</strong> ${courtReserve.idCourtReserve}</li>
      <li><strong>🔒 Clave de Reserva:</strong> ${courtReserve.passCourtReserve}</li>
    </ul>
  </div>`
      : ''
  }

  ${
    requiresMaintenance
      ? `
  <div style="margin-top: 25px; padding: 15px; background-color: #e8f5e9; border-left: 5px solid #4caf50; color: #2e7d32; border-radius: 5px;">
    <h3 style="margin-top: 0; color: #1b5e20;">🧹 Mantenimiento de la Cancha</h3>
    <p style="margin: 0; font-size: 15px; line-height: 1.6;">
      <strong>¡Importante!</strong> En este horario no hay canchero disponible.
      Te pedimos tu colaboración para dejar la cancha en óptimas condiciones para los siguientes jugadores: <strong>pasando el paño y regando</strong> al finalizar tu partido.
      <br><br>
      ¡Agradecemos de antemano tu ayuda!
    </p>
  </div>`
      : ''
  }

  <p style="margin-top: 30px; font-size: 16px;">¡Que tengas un excelente partido!</p>
  <p style="margin-top: 10px; font-size: 16px; line-height: 1.6;">Atentamente,<br><strong>Club de Tenis Quintero</strong></p>
</div>
  `,
      };
    };

    const sendEmailIfNeeded = async (player: string | null) => {
      if (player) {
        const email = await this.findOneEmail(player);
        if (email) {
          await this.emailService.sendEmail(getEmailData(email, courtReserve));
        }
      }
    };
    const email1 = await this.findOneEmail(courtReserve.player1);
    await this.emailService.sendEmail(getEmailData(email1, courtReserve));
    if (!courtReserve.isVisit) {
      await sendEmailIfNeeded(courtReserve.player2);
    }
    if (courtReserve.isDouble) {
      await sendEmailIfNeeded(courtReserve.player3);
      await sendEmailIfNeeded(courtReserve.player4);
    }
  }
}
