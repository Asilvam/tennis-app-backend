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

  async create(createCourtReserveDto: CreateCourtReserveDto) {
    const { player1, player2, court, turn, dateToPlay } = createCourtReserveDto;
    const activeReserves = await this.getAllCourtReserves();
    if (activeReserves) {
      const haveReserve = activeReserves.filter(
        (reserve) =>
          reserve.player1 === player1 ||
          reserve.player2 === player2 ||
          reserve.player1 === player2 ||
          reserve.player2 === player1,
      );
      if (haveReserve.length > 0) {
        throw new BadRequestException('You already have a reserve');
      }
      if (createCourtReserveDto.player1 === createCourtReserveDto.player2) {
        throw new BadRequestException('You cannot reserve for yourself');
      }
      if (createCourtReserveDto.player1 === '') {
        throw new BadRequestException('You must enter a player 1');
      }
      if (createCourtReserveDto.player2 === '') {
        throw new BadRequestException('You must enter a player 2');
      }
      if (createCourtReserveDto.player1 === createCourtReserveDto.player2) {
        throw new BadRequestException('You cannot reserve for yourself');
      }
      if (createCourtReserveDto.player1 === '') {
        throw new BadRequestException('You must enter a player 1');
      }
      if (createCourtReserveDto.player2 === '') {
        throw new BadRequestException('You must enter a player 2');
      }
      if (createCourtReserveDto.player1 === createCourtReserveDto.player2) {
        throw new BadRequestException('You cannot reserve for yourself');
      }
      if (createCourtReserveDto.player1 === '') {
        throw new BadRequestException('You must enter a player 1');
      }
      const isCourtReserve = activeReserves.find((courtReserve) => {
        if (courtReserve.court === court && courtReserve.turn === turn && courtReserve.dateToPlay === dateToPlay) {
          return true;
        }
      });
      if (isCourtReserve) {
        throw new BadRequestException('This court is already reserved for this time');
      }
    }
    const newCourtReserve = new this.courtReserveModel(createCourtReserveDto);
    await this.sendEmailReserve(createCourtReserveDto);
    return await newCourtReserve.save();
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
    const email2 = await this.findOneEmail(courtReserve.player2);
    const emailData1 = {
      to: email1.email,
      subject: 'Court tennis reservation',
      // eslint-disable-next-line max-len
      text: `You have a reservation to play with ${courtReserve.player2} on ${courtReserve.dateToPlay} at ${courtReserve.turn} in court ${courtReserve.court}`,
    };
    const emailData2 = {
      to: email2.email,
      subject: 'Court tennis reservation',
      // eslint-disable-next-line max-len
      text: `You have a reservation to play with ${courtReserve.player1} on ${courtReserve.dateToPlay} at ${courtReserve.turn} in court ${courtReserve.court}`,
    };
    await this.emailService.sendEmail(emailData1);
    await this.emailService.sendEmail(emailData2);
  }
}
