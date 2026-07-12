import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateCourtReserveDto } from './dto/create-court-reserve.dto';
import { UpdateCourtReserveDto } from './dto/update-court-reserve.dto';
import { CourtReserve } from './entities/court-reserve.entity';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DateTime } from 'luxon';
import { EmailService } from '../email/email.service';
import { RegisterService } from '../register/register.service';
import { AuditLogService } from '../audit-log/audit-log.service';
// import { ConfigService } from '@nestjs/config';
import { TimeSlot } from './interfaces/court-reserve.interface';
import * as XLSX from 'xlsx';
import { buildReservationCancellationEmail, buildReservationConfirmationEmail } from '../email/templates/reservation-email.templates';
import { buildPaymentStatusEmail } from '../email/templates/transactional-email.templates';

const getTurnDateRange = (dateToPlay: string, turn: string, timezone: string) => {
  const [start, end] = turn.split('-').map((value) => value.trim());
  const startTime = DateTime.fromISO(`${dateToPlay}T${start}`, { zone: timezone });
  let endTime = DateTime.fromISO(`${dateToPlay}T${end}`, { zone: timezone });

  if (endTime <= startTime) {
    endTime = endTime.plus({ days: 1 });
  }

  return { startTime, endTime };
};

@Injectable()
export class CourtReserveService {
  private readonly logger = new Logger(CourtReserveService.name);

  constructor(
    @InjectModel('CourtReserve')
    private readonly courtReserveModel: Model<CourtReserve>,
    private readonly registerService: RegisterService,
    private readonly emailService: EmailService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async exportFilteredReservesToExcelBuffer(): Promise<Buffer> {
    const reserves = await this.findFilteredReserves();
    const data = reserves.map((r) => ({
      dateToPlay: r.dateToPlay,
      court: r.court,
      turn: r.turn,
      player1: r.player1,
      player2: r.player2,
      player3: r.player3,
      player4: r.player4,
      visitName: r.visitName,
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Reserves');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  async findFilteredReserves(): Promise<CourtReserve[]> {
    const filter = {
      dateToPlay: {
        $gte: '2025-10-01',
      },
      turn: {
        $in: ['20:15-22:00', '22:15-00:00'],
      },
      state: true,
      isPaidNight: true,
      wasPaid: false,
      player1: {
        $nin: ['mantenimiento', 'Mantenimiento', 'clases', 'Clases', 'clima', 'Clima'],
      },
    };
    return this.courtReserveModel.find(filter).select('dateToPlay court turn player1 player2 player3 player4 visitName -_id').exec();
  }

  playerHasActiveReserve = (player: string, activeReserves: any[]) => {
    return activeReserves.some((reserve) => reserve.player1 === player || reserve.player2 === player || reserve.player3 === player || reserve.player4 === player);
  };

  playerActiveReserve = (player: string, activeReserves: CourtReserve[]) => {
    const matchingReserve = activeReserves.find((reserve) => reserve.player1 === player || reserve.player2 === player || reserve.player3 === player || reserve.player4 === player);
    return matchingReserve || null; // Return the matching reservation or null if not found
  };

  validateDateTurn = async (dateToPlay: string, court: string, turn: string): Promise<boolean> => {
    const timezone = 'America/Santiago'; // Chile timezone
    const currentTime = DateTime.now().setZone(timezone); // Current time in the specified timezone
    const playDate = DateTime.fromISO(dateToPlay, { zone: timezone }).startOf('day');
    const today = currentTime.startOf('day');
    if (playDate < today) {
      return false;
    }
    if (playDate.hasSame(today, 'day')) {
      const { endTime } = getTurnDateRange(dateToPlay, turn, timezone);
      if (currentTime >= endTime) {
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
    const errors = [];

    for (const reservation of createCourtReserveDtoArray) {
      try {
        const { dateToPlay, turn, court, blockedMotive } = reservation;
        const existingReserve = await this.courtReserveModel.findOne({ dateToPlay, turn, court, state: true }).select('idCourtReserve').exec();
        if (existingReserve?.idCourtReserve) {
          try {
            await this.sendEmailRemove(existingReserve.idCourtReserve, blockedMotive);
          } catch (emailErr) {
            this.logger.warn(`Failed to send cancellation email for ${existingReserve.idCourtReserve}`, emailErr);
          }
        }
        await this.courtReserveModel.updateMany({ dateToPlay, turn, court }, { state: false });
        const newCourtReserve = new this.courtReserveModel(reservation);
        const savedReservation = await newCourtReserve.save();
        savedReservations.push(savedReservation);

        // ✅ AUDITORÍA: Registrar creación individual
        try {
          await this.auditLogService.logReserveCreation(savedReservation.toObject(), 'ADMIN', 'Admin Bulk Operation');
        } catch (auditErr) {
          this.logger.error('[adminReserve] Error logging audit', auditErr);
        }

        this.logger.log(`Reserva guardada: ${savedReservation.idCourtReserve}`);
      } catch (err) {
        const errorMsg = err?.message || String(err);
        this.logger.error(`Error procesando reserva`, errorMsg, err?.stack);
        errors.push({
          reservation: { dateToPlay: reservation.dateToPlay, court: reservation.court, turn: reservation.turn },
          error: errorMsg,
        });
      }
    }

    // ✅ AUDITORÍA: Registrar operación masiva
    if (savedReservations.length > 0) {
      try {
        await this.auditLogService.logBulkAdminReserves(savedReservations.length);
      } catch (auditErr) {
        this.logger.error('[adminReserve] Error logging bulk audit', auditErr);
      }
    }

    return { savedReservations, errors };
  }

  async adminCreate(createCourtReserveDto: CreateCourtReserveDto) {
    const { court, turn, dateToPlay } = createCourtReserveDto;
    await this.courtReserveModel.findOneAndUpdate({ dateToPlay, turn, court }, { state: false });
    const newCourtReserve = new this.courtReserveModel(createCourtReserveDto);
    const savedReservation = await newCourtReserve.save();

    // ✅ AUDITORÍA: Registrar creación por admin
    try {
      await this.auditLogService.logReserveCreation(savedReservation.toObject(), 'ADMIN', 'Admin User');
    } catch (auditErr) {
      this.logger.error('[adminCreate] Error logging audit', auditErr);
    }

    this.logger.log(savedReservation);
    return savedReservation;
  }

  async create(createCourtReserveDto: CreateCourtReserveDto) {
    const { player1, player2, player3, player4, court, turn, dateToPlay, isVisit, isDouble } = createCourtReserveDto;
    if (isDouble) {
      if (isVisit) {
        throw new BadRequestException('Doubles reserves cannot be marked as visit');
      }
      if (!player1 || !player2 || !player3 || !player4) {
        throw new BadRequestException('Doubles reserves require player1, player2, player3, and player4');
      }
    } else if (isVisit) {
      if (!player1 || !createCourtReserveDto.visitName) {
        throw new BadRequestException('Visit reserves require player1 and visitName');
      }
      if (player2 || player3 || player4) {
        throw new BadRequestException('Visit reserves cannot include player2, player3, or player4');
      }
    } else {
      if (!player1 || !player2) {
        throw new BadRequestException('Singles reserves require player1 and player2');
      }
      if (player3 || player4 || createCourtReserveDto.visitName) {
        throw new BadRequestException('Singles reserves cannot include player3, player4, or visitName');
      }
    }
    const validateDateTurn = await this.validateDateTurn(dateToPlay, court, turn);
    if (validateDateTurn) {
      const existingReserve = await this.courtReserveModel.findOne({ dateToPlay, turn, court, state: true }).select('idCourtReserve').exec();
      if (existingReserve) {
        throw new BadRequestException('This court is already reserved for this time');
      }
      const activeReserves = await this.getAllCourtReserves();
      if (activeReserves) {
        let playersToCheck: string[];
        if (isVisit) {
          playersToCheck = [player1];
        } else if (isDouble) {
          playersToCheck = [player1, player2, player3, player4];
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
        const isCourtReserve = activeReserves.find((courtReserve) => courtReserve.court === court && courtReserve.turn === turn && courtReserve.dateToPlay === dateToPlay);
        if (isCourtReserve) {
          throw new BadRequestException('This court is already reserved for this time');
        }
      }
      const newCourtReserve = new this.courtReserveModel(createCourtReserveDto);
      const response = await newCourtReserve.save();

      try {
        const playerEmail = await this.findOneEmail(player1);
        await this.auditLogService.logReserveCreation(response.toObject(), 'USER', player1, playerEmail?.email);
      } catch (auditErr) {
        this.logger.error('[create] Error logging audit', auditErr);
      }

      try {
        await this.sendEmailReserve(response);
      } catch (err) {
        this.logger.error('Failed to send reservation email', err?.stack || err?.message || String(err));
      }
      this.logger.log(response);
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
      throw new ConflictException('Otro jugador ya registró el resultado de este partido.');
    }

    const timezone = 'America/Santiago';
    const matchDate = DateTime.fromISO(reserves.dateToPlay, { zone: timezone }).startOf('day');
    const currentDate = DateTime.now().setZone(timezone).startOf('day');

    const diffInDays = currentDate.diff(matchDate, 'days').days;

    if (diffInDays > 2) {
      throw new BadRequestException('No se puede actualizar el resultado. El plazo para hacerlo ha expirado (2 días después del partido).');
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

  async claimResultMatch(idCourtReserve: string): Promise<CourtReserve> {
    const updatedReserve = await this.courtReserveModel.findOneAndUpdate(
      {
        idCourtReserve,
        state: true,
        isForRanking: true,
        resultMatchUpdated: false,
      },
      { resultMatchUpdated: true },
      { new: true },
    );

    if (!updatedReserve) {
      throw new ConflictException('Otro jugador ya registró el resultado de este partido.');
    }

    return updatedReserve;
  }

  async releaseResultMatch(idCourtReserve: string): Promise<void> {
    await this.courtReserveModel.updateOne({ idCourtReserve, resultMatchUpdated: true }, { resultMatchUpdated: false }).exec();
  }

  async logResultMatchUpdate(idCourtReserve: string, playerName?: string): Promise<void> {
    try {
      await this.auditLogService.logMatchResultUpdate(idCourtReserve, playerName);
    } catch (auditErr) {
      this.logger.error('[logResultMatchUpdate] Error logging audit', auditErr);
    }

    this.logger.log(`Match result updated for reserve: ${idCourtReserve}`);
  }

  async updateStateReserve(idCourtReserve: string) {
    const currentReserve = await this.courtReserveModel.findOne({ idCourtReserve }).exec();
    const oldState = currentReserve?.state || false;

    const updatedReserve = await this.courtReserveModel.findOneAndUpdate({ idCourtReserve: idCourtReserve }, { state: true, wasPaid: true });
    if (!updatedReserve) {
      throw new NotFoundException(`Reserve with idCourtReserve ${idCourtReserve} not found or already updated`);
    }

    // ✅ AUDITORÍA: Registrar cambio de estado
    try {
      await this.auditLogService.logStateChange(idCourtReserve, oldState, true, true, 'SYSTEM');
    } catch (auditErr) {
      this.logger.error('[updateStateReserve] Error logging audit', auditErr);
    }

    this.logger.log(`reserve state has been updated for reserve: ${idCourtReserve}`);
    return updatedReserve;
  }

  async sendEmailConfirmation(idCourtReserve: string, paymentStatus: string) {
    // ✅ AUDITORÍA: Registrar confirmación de pago
    try {
      await this.auditLogService.logPaymentConfirmation(idCourtReserve, paymentStatus);
    } catch (auditErr) {
      this.logger.error('[sendEmailConfirmation] Error logging audit', auditErr);
    }

    const reserve = await this.getCourtReserveById(idCourtReserve);
    if (!reserve) {
      throw new NotFoundException(`[sendEmailConfirmation] Reserve with idCourtReserve ${idCourtReserve} not found`);
    }
    const email = await this.findOneEmail(reserve.player1);
    if (!email) {
      throw new NotFoundException(`[sendEmailConfirmation] Email for player ${reserve.player1} not found`);
    }
    if (paymentStatus === 'approved') {
      const buildEmailData = {
        to: email.email,
        subject: 'Pago confirmado - Reserva aprobada',
        html: buildPaymentStatusEmail({ playerName: reserve.player1, approved: true }),
      };
      await this.emailService.sendEmail(buildEmailData);
    } else {
      const buildEmailData = {
        to: email.email,
        subject: 'Pago rechazado - Reserva anulada',
        html: buildPaymentStatusEmail({ playerName: reserve.player1, approved: false }),
      };
      await this.emailService.sendEmail(buildEmailData);
    }
  }

  async remove(idCourtReserve: string) {
    const reserve = await this.getCourtReserveById(idCourtReserve);

    // ✅ AUDITORÍA: Registrar cancelación antes de eliminar
    try {
      await this.auditLogService.logReserveCancellation(idCourtReserve, reserve, reserve.isBlockedByAdmin ? 'ADMIN' : 'USER', reserve.player1, reserve.blockedMotive);
    } catch (auditErr) {
      this.logger.error('[remove] Error logging audit', auditErr);
    }

    if (!reserve.isBlockedByAdmin) {
      this.sendEmailRemove(idCourtReserve);
    }
    const updatedRegister = await this.courtReserveModel.findOneAndUpdate({ idCourtReserve: idCourtReserve }, { state: false }, { new: true }).exec();
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
      .select(['dateToPlay', 'court', 'turn', 'player1', 'player2', 'player3', 'player4', 'isDouble', 'isVisit', 'visitName', 'isBlockedByAdmin', 'blockedMotive'])
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
          { available: true, court: 'Cancha 1', isPayed: true, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 2', isPayed: true, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 3', isPayed: true, isBlockedByAdmin: false, data: null },
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
        .find({
          $or: [{ player1: namePlayer }, { player2: namePlayer }, { player3: namePlayer }, { player4: namePlayer }],
        })
        .select('dateToPlay court turn player1 player2 player3 player4 ' + 'visitName idCourtReserve state passCourtReserve isForRanking resultMatchUpdated')
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

  async getAllIsForRankingReservesFor(namePlayer: string): Promise<CourtReserve[] | null> {
    const timezone = 'America/Santiago';
    const currentDate = DateTime.now().setZone(timezone).startOf('day');

    try {
      const reserves = await this.courtReserveModel
        .find({
          state: true,
          isForRanking: true,
          resultMatchUpdated: false,
          $or: [{ player1: namePlayer }, { player2: namePlayer }, { player3: namePlayer }, { player4: namePlayer }],
        })
        .select('dateToPlay court turn player1 player2 player3 player4 visitName idCourtReserve state passCourtReserve isForRanking resultMatchUpdated')
        .sort({
          dateToPlay: 'desc',
          turn: 'asc',
          court: 'asc',
        })
        .exec();

      if (!reserves.length) {
        return [];
      }

      const filteredReserves = reserves.filter((reserve) => {
        const matchDate = DateTime.fromISO(reserve.dateToPlay, { zone: timezone }).startOf('day');

        if (!matchDate.isValid) {
          return false;
        }

        const diffDays = currentDate.diff(matchDate, 'days').days;
        return diffDays >= 0 && diffDays <= 1;
      });

      return filteredReserves.length > 0 ? filteredReserves : null;
    } catch (error) {
      this.logger.error('Error retrieving ranking reserves:', error);
      return null;
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
          const reservationDate = DateTime.fromISO(reserve.dateToPlay, { zone: timezone });
          const isToday = reservationDate.hasSame(today, 'day');
          const { endTime } = getTurnDateRange(reserve.dateToPlay, reserve.turn, timezone);
          const hasNotEnded = currentTime < endTime;
          const isFutureDate = reservationDate > today;
          return (isToday && hasNotEnded) || isFutureDate;
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
          const reservationDate = DateTime.fromISO(reserve.dateToPlay, { zone: timezone });
          const isToday = reservationDate.hasSame(today, 'day');
          const { endTime } = getTurnDateRange(reserve.dateToPlay, reserve.turn, timezone);
          const hasNotEnded = currentTime < endTime;
          const isActive = reserve.state === true;
          const isFutureDate = reservationDate > today;
          return (isToday && hasNotEnded && isActive) || (isFutureDate && isActive);
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

      const [turnStart] = courtReserve.turn.split('-');
      const turnStartTime = DateTime.fromFormat(turnStart, 'HH:mm');
      const maintenanceThresholdTime = DateTime.fromFormat('14:15', 'HH:mm');
      const requiresMaintenance = turnStartTime >= maintenanceThresholdTime;

      return {
        to: email.email,
        subject: courtReserve.isPaidNight || courtReserve.isVisit ? 'Reserva recibida - Pago pendiente' : 'Reserva confirmada',
        html: buildReservationConfirmationEmail({
          reserve: courtReserve,
          formattedDate,
          courtNumber,
          requiresMaintenance,
        }),
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
    if (courtReserve.isVisit || courtReserve.isPaidNight) {
      const notificationEmail = 'clubquinterotenis@gmail.com'; // Reemplaza esto con el email deseado
      await this.emailService.sendEmail(getEmailData({ email: notificationEmail }, courtReserve));
    }
  }

  private async getCourtReserveById(idCourtReserve: string): Promise<CourtReserve> {
    const reserve = await this.courtReserveModel.findOne({ idCourtReserve }).select('dateToPlay court turn player1 player2 player3 player4 visitName isVisit isDouble isBlockedByAdmin').exec();

    if (!reserve) {
      throw new NotFoundException(`Reserva ${idCourtReserve} no encontrada`);
    }

    return reserve;
  }

  async sendEmailRemove(idCourtReserve: string, reason?: string): Promise<void> {
    const courtReserve = await this.getCourtReserveById(idCourtReserve);

    const formatDate = (iso: string) => DateTime.fromISO(iso).toFormat('dd-MM-yyyy');
    const courtNumber = courtReserve.court.replace('Cancha ', '');
    const formattedDate = formatDate(courtReserve.dateToPlay);

    const buildCancellationEmail = (emailAddress: string) => ({
      to: emailAddress,
      subject: 'Reserva anulada',
      html: buildReservationCancellationEmail({
        reserve: courtReserve,
        formattedDate,
        courtNumber,
        reason,
      }),
    });

    const notifyPlayer = async (playerName: string | null) => {
      if (!playerName) return;
      try {
        if (playerName === 'clubquinterotenis@gmail.com') {
          await this.emailService.sendEmail(buildCancellationEmail(playerName));
        } else {
          const emailData = await this.findOneEmail(playerName);
          if (emailData?.email) {
            await this.emailService.sendEmail(buildCancellationEmail(emailData.email));
          }
        }
      } catch (err) {
        this.logger.error(`Error notifying ${playerName}`, err?.stack || err?.message || String(err));
      }
    };

    const players = [courtReserve.player1];
    if (!courtReserve.isVisit) players.push(courtReserve.player2);
    if (courtReserve.isDouble) players.push(courtReserve.player3, courtReserve.player4);
    if (courtReserve.isVisit || courtReserve.isPaidNight) {
      players.push('clubquinterotenis@gmail.com');
    }

    await Promise.allSettled(players.map(notifyPlayer));
  }
}
