import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateCourtReserveDto } from './dto/create-court-reserve.dto';
import { UpdateCourtReserveDto } from './dto/update-court-reserve.dto';
import { CourtReserve } from './entities/court-reserve.entity';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DateTime } from 'luxon';
import { EmailService } from '../email/email.service';
import { RegisterService } from '../register/register.service';
import { ConfigService } from '@nestjs/config';
import { TimeSlot } from './interfaces/court-reserve.interface';

@Injectable()
export class CourtReserveService {
  logger = new Logger(CourtReserveService.name);

  constructor(
    @InjectModel('CourtReserve')
    private readonly courtReserveModel: Model<CourtReserve>,
    private readonly registerService: RegisterService,
    private readonly emailService: EmailService,
    // private configService: ConfigService,
  ) {}

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
      await this.courtReserveModel.findOneAndUpdate({ dateToPlay, turn, court }, { state: false }).exec();
      const newCourtReserve = new this.courtReserveModel(reservation);
      const savedReservation = await newCourtReserve.save();
      savedReservations.push(savedReservation);
      this.logger.log(savedReservation);
    }
    return savedReservations;
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
    return await this.courtReserveModel.find().exec();
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
    // this.logger.log('reserves-->', reserves);
    if (!reserves.state) {
      // this.logger.log('reserves.state-->', reserves.state);
      throw new BadRequestException('Reserva no valida, fue cancelada');
    }

    if (reserves.resultMatchUpdated) {
      throw new BadRequestException('Reserva ya fue actualizada');
    }

    if (reserves) {
      if (reserves.isDouble) {
        player3Data = await this.registerService.findOneEmail(reserves.player3);
        player4Data = await this.registerService.findOneEmail(reserves.player4);
      }
      player1Data = await this.registerService.findOneEmail(reserves.player1);
      player2Data = await this.registerService.findOneEmail(reserves.player2);
    } else {
      throw new BadRequestException('No se encontro la reserva');
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
      .find({ dateToPlay: selectedDate, state: true }) // Adding state: true condition
      .select(
        // eslint-disable-next-line max-len
        'dateToPlay court turn player1 player2 player3 player4 isDouble isVisit visitName isBlockedByAdmin blockedMotive',
      )
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
        slots: [{ available: true, court: 'Cancha 1', isPayed: true, isBlockedByAdmin: false, data: null }],
      },
      {
        time: '22:15-00:00',
        slots: [{ available: true, court: 'Cancha 1', isPayed: true, isBlockedByAdmin: false, data: null }],
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
    const getEmailData = (email: { email: string }, courtReserve: CourtReserve) => ({
      to: email.email,
      subject: 'Court Tennis Reservation',
      html: `
<p><strong>Detalles Reserva:</strong></p>
<p>
  Tienes una reserva para jugar 
  ${
    courtReserve.isDouble
      ? `<strong>vs ${courtReserve.player3} y ${courtReserve.player4}</strong> 
         con tu compañero <strong>${courtReserve.player2}</strong>`
      : `<strong>${courtReserve.player1} vs ${courtReserve.player2 || courtReserve.visitName}</strong>`
  } 
  el <strong>${courtReserve.dateToPlay}</strong> turno <strong>${courtReserve.turn}</strong> 
  en <strong>${courtReserve.court}</strong>.
</p>
${courtReserve.isPaidNight ? '<p><strong>Por favor, ten en cuenta que este horario es pagado.</strong></p>' : ''}
${
  !courtReserve.isVisit && courtReserve.isForRanking
    ? `<p>No olvides actualizar tu ranking después del partido.</p>
       <p>Tu ID de reserva de cancha es <strong>${courtReserve.idCourtReserve}</strong> 
       y tu clave de reserva es <strong>${courtReserve.passCourtReserve}</strong>.</p>`
    : ''
}
<p></p>
<p>Atentamente,</p>
<p>Club de Tenis Quintero</p>


  `,
    });

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
