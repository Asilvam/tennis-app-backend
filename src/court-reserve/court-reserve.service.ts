import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { CreateCourtReserveDto } from './dto/create-court-reserve.dto';
import { UpdateCourtReserveDto } from './dto/update-court-reserve.dto';
import { CourtReserve } from './entities/court-reserve.entity';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DateTime } from 'luxon';
import { EmailService } from '../email/email.service';
import { RegisterService } from '../register/register.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CourtReserveService {
  logger = new Logger(CourtReserveService.name);

  constructor(
    @InjectModel('CourtReserve')
    private readonly courtReserveModel: Model<CourtReserve>,
    private readonly registerService: RegisterService,
    private readonly emailService: EmailService,
    private configService: ConfigService,
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

  validateDateTurn = async (dateToPlay: string, court: number, turn: string): Promise<boolean> => {
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
      const turnEndTime = DateTime.fromFormat(turnEnd, 'HH:mm', { zone: timezone });
      if (currentTime > turnEndTime) {
        this.logger.log('Current time is after the turn.');
        return false;
      }
    }
    const getDateTurn = await this.getAllCourtAvailable(dateToPlay);
    if (!getDateTurn) return false;
    const selectedCourt = getDateTurn.find((item) => item.id === court);
    if (!selectedCourt) return false;
    const timeSlot = selectedCourt.timeSlots.find((slot) => slot.time === turn);
    return timeSlot ? timeSlot.available : false;
  };

  async create(createCourtReserveDto: CreateCourtReserveDto) {
    const { player1, player2, player3, player4, court, turn, dateToPlay, isVisit, isDouble } = createCourtReserveDto;
    const courtNumber = court.match(/\d+/);
    const validateDateTurn = await this.validateDateTurn(dateToPlay, parseInt(courtNumber[0]), turn);
    this.logger.log('validateDateTurn--> ', validateDateTurn);
    if (validateDateTurn) {
      const activeReserves = await this.getAllCourtReserves();
      if (activeReserves) {
        let playersToCheck: string[] = [];
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
    const activeReserves = await this.courtReserveModel
      .find({ dateToPlay: selectedDate, state: true }) // Adding state: true condition
      .select('dateToPlay court turn player1 player2 player3 player4 isDouble isVisit visitName')
      .exec();
    const courtNumbers = this.configService.get('NUMBER_COURTS');
    const AllSlotsAvailable = [
      { time: '08:15-10:00', available: true, isPayed: false, data: null },
      { time: '10:15-12:00', available: true, isPayed: false, data: null },
      { time: '12:15-14:00', available: true, isPayed: false, data: null },
      { time: '14:15-16:00', available: true, isPayed: false, data: null },
      { time: '16:15-18:00', available: true, isPayed: false, data: null },
      { time: '18:15-20:00', available: true, isPayed: false, data: null },
      { time: '20:15-22:00', available: true, isPayed: true, data: null },
      { time: '22:15-00:00', available: true, isPayed: true, data: null },
    ];
    const generateCourtAvailability = () => {
      return Array.from({ length: courtNumbers }, (_, i) => {
        const id = i + 1;
        const timeSlots =
          id === 2 || id === 3
            ? AllSlotsAvailable.slice(0, 6) // Use only the first 6 slots for courts 2 and 3
            : AllSlotsAvailable.map((slot) => ({ ...slot })); // Clone all available slots for other courts
        return {
          id,
          name: `Court ${id}`,
          timeSlots,
        };
      });
    };
    const availability = generateCourtAvailability();
    availability.forEach((court) => {
      if (activeReserves.length > 0) {
        activeReserves.forEach((reserve) => {
          if (court.name === reserve.court) {
            const timeSlot = court.timeSlots.find((slot) => slot.time === reserve.turn);
            if (timeSlot) {
              timeSlot.available = false;
              timeSlot.data = reserve;
            }
          }
        });
      }
    });
    return availability;
  }

  async getAllHistoryReservesFor(namePlayer: string): Promise<CourtReserve[] | null> {
    try {
      const courtReserves = await this.courtReserveModel
        .find({ player1: namePlayer })
        .select('dateToPlay court turn player2 player3 player4 visitName idCourtReserve state')
        .sort({
          dateToPlay: 'desc',
          turn: 'asc',
          court: 'asc',
        })
        .exec();
      return courtReserves;
    } catch (error) {
      console.log(error);
    }
  }

  async getAllReservesFor(namePlayer: string): Promise<CourtReserve[] | null> {
    // console.log(namePlayer);
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
          // Parse start, end, and current times using Luxon
          const startTime = DateTime.fromFormat(start, 'HH:mm', { zone: timezone });
          const endTime = DateTime.fromFormat(end, 'HH:mm', { zone: timezone });
          const reservationDate = DateTime.fromISO(reserve.dateToPlay, { zone: timezone });
          // Condition 1: Check if today is the same as the reservation date
          const isToday = reservationDate.hasSame(today, 'day');
          // Condition 2: Check if the current time is within the time range
          const isWithinTimeRange = (currentTime >= startTime && currentTime < endTime) || currentTime < startTime;
          // Condition 3: Check if the reservation is active (state is true)
          const isActive = reserve.state === true;
          // Condition 4: Check if the reservation date is in the future
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
    const response = await this.registerService.findOneEmail(player);
    return response;
  }

  async sendEmailReserve(courtReserve: CourtReserve) {
    const getEmailData = (email: { email: string }, courtReserve: CourtReserve) => ({
      to: email.email,
      subject: 'Court Tennis Reservation',
      html: `
<p><strong>Court Reservation Details:</strong></p>
<p>
  You have a reservation to play 
  ${
    courtReserve.isDouble
      ? `<strong>against ${courtReserve.player3} and ${courtReserve.player4}</strong> 
         with your partner <strong>${courtReserve.player2}</strong>`
      : `<strong>${courtReserve.player1} against ${courtReserve.player2 || courtReserve.visitName}</strong>`
  } 
  on <strong>${courtReserve.dateToPlay}</strong> from <strong>${courtReserve.turn}</strong> 
  on <strong>${courtReserve.court}</strong>.
</p>
${courtReserve.isPaidNight ? '<p><strong>Please note that this time slot is paid.</strong></p>' : ''}
${
  !courtReserve.isVisit
    ? `<p>Don't forget to update your ranking after the match.</p>
       <p>Your court reservation ID is <strong>${courtReserve.idCourtReserve}</strong> 
       and your reservation pass is <strong>${courtReserve.passCourtReserve}</strong>.</p>`
    : ''
}
<p>We look forward to seeing you on the court!</p>
<p>Best regards,</p>
<p>Your Tennis Club</p>

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
