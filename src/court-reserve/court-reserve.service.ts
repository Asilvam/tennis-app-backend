import { Injectable, Logger } from '@nestjs/common';
import { CreateCourtReserveDto } from './dto/create-court-reserve.dto';
import { UpdateCourtReserveDto } from './dto/update-court-reserve.dto';
import { CourtReserve } from './entities/court-reserve.entity';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as moment from 'moment';
import 'moment-timezone';

@Injectable()
export class CourtReserveService {
  logger = new Logger(CourtReserveService.name);

  constructor(
    @InjectModel('CourtReserve')
    private readonly courtReserveModel: Model<CourtReserve>,
    // private readonly registerService: RegisterService,
    // private readonly emailService: EmailService,
  ) {}

  async create(createCourtReserveDto: CreateCourtReserveDto) {
    this.logger.log('createCourtReserveDto', createCourtReserveDto);
    // Create a new instance of the court reserve model with the updated DTO
    const newCourtReserve = new this.courtReserveModel(createCourtReserveDto);
    this.logger.log('newCourtReserve', newCourtReserve);
    // Save the new court reserve to the database
    return await newCourtReserve.save();
  }

  findAll() {
    return `This action returns all courtReserve`;
  }

  findOne(id: number) {
    return `This action returns a #${id} courtReserve`;
  }

  update(id: number, updateCourtReserveDto: UpdateCourtReserveDto) {
    this.logger.log('updateCourtReserveDto', updateCourtReserveDto);
    return `This action updates a #${id} courtReserve`;
  }

  remove(id: number) {
    return `This action removes a #${id} courtReserve`;
  }

  // async validateCourtReserve(courtReserve: CourtReserve): Promise<boolean> {
  //   this.logger.log('Validating court reserve:', { courtReserve });
  //   const { court, turn, dateToPlay } = courtReserve;
  //   const auxDateToPlay = moment(dateToPlay).format('YYYY-MM-DD');
  //   const courtReserveData: CourtReserve[] = await this.getAllCourtReserves();
  //   if (courtReserveData) {
  //     const isExisting = courtReserveData.some((item) => {
  //       const auxItemDateToPlay = moment(item.dateToPlay).format('YYYY-MM-DD');
  //       return item.court === court && item.turn === turn && auxItemDateToPlay === auxDateToPlay;
  //     });
  //     this.logger.log('validateCourtReserve Is existing:', isExisting);
  //     if (isExisting) {
  //       return false; // Court reservation already exists
  //     }
  //   }
  //   return true; // Court reservation is valid
  // }

  async getAllCourtReserves(): Promise<CourtReserve[] | null> {
    const timezone = 'America/Santiago'; // Chile timezone
    const currentHour = moment.tz(timezone).format('HH:mm');
    const today = moment().startOf('day').format('YYYY-MM-DD'); // Start of today
    // this.logger.log(`Today is ${today}`);
    // this.logger.log(`Current hour is ${currentHour}`);
    try {
      const courtReserves = await this.courtReserveModel
        .find({
          dateToPlay: { $gte: today }, // Filter by today and later
        })
        .sort({
          dateToPlay: 'asc',
          turn: 'asc',
          court: 'asc',
        })
        .exec();
      // this.logger.log('Court reserves found:', courtReserves.length);
      // this.logger.log('Court reserves found:', courtReserves);
      if (courtReserves.length > 0) {
        const filteredReserves = courtReserves.filter((reserve) => {
          const [start, end] = reserve.turn.split('-');
          // Parse start, end, and current times as moment objects
          const startTime = moment(start, 'HH:mm', timezone);
          const endTime = moment(end, 'HH:mm', timezone);
          const currentTime = moment(currentHour, 'HH:mm', timezone);
          // Parse the reservation date and today's date as moment objects
          const reservationDate = moment(reserve.dateToPlay);
          const todayDate = moment(today).startOf('day');
          // Condition 1: Check if today is the same as the reservation date
          const isToday = reservationDate.isSame(todayDate);
          const isValidTime = currentTime.isBefore(endTime) && isToday;
          // Condition 2: Check if the current time is within the time range
          const isWithinTimeRange = currentTime.isBetween(startTime, endTime, null, '[)');
          // Condition 3: Check if the reservation is active (state is true)
          const isActive = reserve.state === true;
          // Condition 4: Check if the reservation date is in the future
          const isFutureDate = reservationDate.isAfter(todayDate);
          // Include the reservation if it is today and within the time range and active,
          // or if it is for a future date and active
          return (isToday && isWithinTimeRange && isActive) || (isFutureDate && isActive) || (isValidTime && isActive);
        });
        // this.logger.log('Filtered court reserves:', filteredReserves);
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

  // async validatePlayers(courtReserve: CourtReserve): Promise<boolean> {
  //   this.logger.log('Validating players:', { courtReserve });
  //   const { player1, player2 } = courtReserve;
  //   const courtReserveData: CourtReserve[] = await this.getAllCourtReserves();
  //   if (courtReserveData) {
  //     const isExisting = courtReserveData.some((item) => {
  //       const { player1: p1, player2: p2 } = item;
  //       const trimmedPlayer1 = player1.trim();
  //       const trimmedPlayer2 = player2.trim();
  //       const trimmedP1 = p1.trim();
  //       const trimmedP2 = p2.trim();
  //       return (
  //         trimmedP1 === trimmedPlayer1 ||
  //         trimmedP2 === trimmedPlayer2 ||
  //         trimmedP1 === trimmedPlayer2 ||
  //         trimmedP2 === trimmedPlayer1
  //       );
  //     });
  //     this.logger.log('validatePlayers Is existing:', isExisting);
  //     if (isExisting) {
  //       return false; // Players already have a reservation
  //     }
  //   }
  //   return true; // Players are valid
  // }
  //
  // async reserveCourt(courtReserveData: CourtReserve): Promise<CourtReserveResponse> {
  //   try {
  //     const validationReserve = await this.validateCourtReserve(courtReserveData);
  //     if (!validationReserve) {
  //       return {
  //         statusCode: 400,
  //         message: 'Court reservation already exists',
  //       };
  //     }
  //     const validationPlayers = await this.validatePlayers(courtReserveData);
  //     if (!validationPlayers) {
  //       return {
  //         statusCode: 400,
  //         message: 'Players already have a reservation',
  //       };
  //     }
  //     const reserveCourt = {
  //       ...courtReserveData,
  //       state: true,
  //     };
  //     // const response = await this.courtReserveModel.save(reserveCourt);
  //     const newCourtReserve = new this.courtReserveModel(courtReserveData);
  //     const response = newCourtReserve.save();
  //     if (response) {
  //       // this.sendEmailReserve(reserveCourt);
  //       return {
  //         statusCode: 200,
  //         message: 'Court reserved successfully',
  //       };
  //     }
  //   } catch (error) {
  //     this.logger.error('Error reserving court:', error);
  //     throw error; // Optionally re-throw the error to propagate it
  //   }
  // }
}
