import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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

  validateDateTurn = async (dateToPlay: string, court: number, turn: string): Promise<boolean> => {
    const timezone = 'America/Santiago'; // Chile timezone
    const currentTimeFull = DateTime.now().setZone(timezone); // Current time in the specified timezone
    const currentTime = currentTimeFull.toFormat('HH:mm'); // Format as HH:mm
    const playDate = DateTime.fromFormat(dateToPlay, 'yyyy-MM-dd');
    const today = DateTime.now().startOf('day');
    if (playDate < today) {
      return false;
    }
    // Use .hasSame() to compare only the date part
    if (playDate.hasSame(today, 'day')) {
      this.logger.log(currentTime);
      const [turnStart, turnEnd] = turn.split('-'); // Split turn into start and end times
      const turnStartTime = DateTime.fromFormat(turnStart, 'HH:mm', { zone: timezone });
      const turnEndTime = DateTime.fromFormat(turnEnd, 'HH:mm', { zone: timezone });
      if (currentTimeFull > turnEndTime) {
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
        // 1. If `isVisit` is true, only check `player1`
        if (isVisit) {
          playersToCheck = [player1];
        }
        // 2. If `isDouble` is true, check `player1`, `player3`, and `player4`
        else if (isDouble) {
          playersToCheck = [player1, player3, player4];
        }
        // 3. Regular case: check `player1` and `player2`
        else {
          playersToCheck = [player1, player2];
        }
        // Check if any of the players have active reservations
        for (const player of playersToCheck) {
          if (player && this.playerHasActiveReserve(player, activeReserves)) {
            this.logger.log(`Player ${player} already has a reserve`);
            throw new BadRequestException(`Player ${player} already has a reserve`);
          }
        }
        // Check if the court is already reserved for the same time slot
        const isCourtReserve = activeReserves.find(
          (courtReserve) =>
            courtReserve.court === court && courtReserve.turn === turn && courtReserve.dateToPlay === dateToPlay,
        );
        if (isCourtReserve) {
          throw new BadRequestException('This court is already reserved for this time');
        }
      }
      // Create the new court reservation
      const newCourtReserve = new this.courtReserveModel(createCourtReserveDto);
      const response = await newCourtReserve.save();
      await this.sendEmailReserve(createCourtReserveDto);
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

  remove(id: number) {
    return `This action removes a #${id} courtReserve`;
  }

  async getAllCourtAvailable(selectedDate: string) {
    const activeReserves = await this.courtReserveModel.find({ dateToPlay: selectedDate }).exec();
    const courtNumbers = this.configService.get('NUMBER_COURTS');
    const AllSlotsAvailable = [
      { time: '08:15-10:00', available: true, isPayed: false },
      { time: '10:15-12:00', available: true, isPayed: false },
      { time: '12:15-14:00', available: true, isPayed: false },
      { time: '14:15-16:00', available: true, isPayed: false },
      { time: '16:15-18:00', available: true, isPayed: false },
      { time: '18:15-20:00', available: true, isPayed: false },
      { time: '20:15-22:00', available: true, isPayed: true },
      { time: '22:15-00:00', available: true, isPayed: true },
    ];
    const generateCourtAvailability = () => {
      return Array.from({ length: courtNumbers }, (_, i) => ({
        id: i + 1,
        name: `Court ${i + 1}`,
        timeSlots: AllSlotsAvailable.map((slot) => ({ ...slot })), // Clone the available slots
      }));
    };
    const availability = generateCourtAvailability();
    availability.forEach((court) => {
      if (activeReserves.length > 0) {
        activeReserves.forEach((reserve) => {
          if (court.name === reserve.court) {
            const timeSlot = court.timeSlots.find((slot) => slot.time === reserve.turn);
            if (timeSlot) timeSlot.available = false;
          }
        });
      }
    });
    return availability;
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

  async sendEmailReserve(courtReserve: CreateCourtReserveDto) {
    const email1 = await this.findOneEmail(courtReserve.player1);
    let email2: string | null = null;
    let email3: string | null = null;
    let email4: string | null = null;

    if (!courtReserve.isVisit) {
      email2 = await this.findOneEmail(courtReserve.player2);
    }
    if (courtReserve.isDouble) {
      email3 = await this.findOneEmail(courtReserve.player3);
      email4 = await this.findOneEmail(courtReserve.player4);
    }

    const emailData1 = {
      to: email1.email,
      subject: 'Court Tennis Reservation',
      html: `
    <p><strong>Court Reservation Details:</strong></p>
    <p>You have a reservation to play <strong>vs ${courtReserve.player2 || 'a visit player'}</strong> on 
    <strong>${courtReserve.dateToPlay}</strong> at <strong>${courtReserve.turn}</strong> 
    in  <strong>${courtReserve.court}</strong>.</p>
    <br>
    <p>We look forward to seeing you on the court!</p>
    <p>Best regards,</p>
    <p>Your Tennis Club</p>
  `,
    };
    await this.emailService.sendEmail(emailData1);
  }
}
