import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CourtReserve } from './entities/court-reserve.entity';
import { Repository } from 'typeorm';
import * as moment from 'moment';
import { CourtReserveResponse } from './interfaces/court-reserve.interface';
import { RegisterService } from '../register/register.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class CourtReserveService {
  logger = new Logger(CourtReserveService.name);

  constructor(
    @InjectRepository(CourtReserve)
    private courtReserveRepository: Repository<CourtReserve>,
    private registerService: RegisterService,
    private readonly emailService: EmailService,
  ) {}

  async getAllCourtReserves(): Promise<CourtReserve[]> {
    const today = moment().startOf('day').format('YYYY-MM-DD');
    const currentHour = moment().format('HH:mm'); // Current time in HH:mm format
    this.logger.log(`Today is ${today}`);
    this.logger.log(`Current hour is ${currentHour}`);
    try {
      const courtReserveData = await this.courtReserveRepository.find({
        order: {
          dateToPlay: 'ASC',
          turn: 'ASC',
          court: 'ASC',
        },
      });
      if (courtReserveData.length > 0) {
        const courtReserves = courtReserveData.filter(
          (item) =>
            item.dateToPlay >= today && item.turn.split('-')[1] >= currentHour,
        );
        if (courtReserves.length > 0) {
          this.logger.log('Court reserves:', courtReserves);
          return courtReserves;
        } else {
          return null;
        }
      }
    } catch (error) {
      this.logger.error('Error retrieving court reserves:', error);
      throw error; // Optionally re-throw the error to propagate it
    }
  }

  async validatePlayers(courtReserve: CourtReserve): Promise<boolean> {
    this.logger.log('Validating players:', { courtReserve });
    const { player1, player2 } = courtReserve;
    const courtReserveData: CourtReserve[] = await this.getAllCourtReserves();
    if (courtReserveData) {
      const isExisting = courtReserveData.some((item) => {
        const { player1: p1, player2: p2 } = item;
        const trimmedPlayer1 = player1.trim();
        const trimmedPlayer2 = player2.trim();
        const trimmedP1 = p1.trim();
        const trimmedP2 = p2.trim();
        return (
          trimmedP1 === trimmedPlayer1 ||
          trimmedP2 === trimmedPlayer2 ||
          trimmedP1 === trimmedPlayer2 ||
          trimmedP2 === trimmedPlayer1
        );
      });
      this.logger.log('validatePlayers Is existing:', isExisting);
      if (isExisting) {
        return false; // Players already have a reservation
      }
    }
    return true; // Players are valid
  }

  async validateCourtReserve(courtReserve: CourtReserve): Promise<boolean> {
    this.logger.log('Validating court reserve:', { courtReserve });
    const { court, turn, dateToPlay } = courtReserve;
    const auxDateToPlay = moment(dateToPlay).format('YYYY-MM-DD');
    const courtReserveData: CourtReserve[] = await this.getAllCourtReserves();
    if (courtReserveData) {
      const isExisting = courtReserveData.some((item) => {
        const auxItemDateToPlay = moment(item.dateToPlay).format('YYYY-MM-DD');
        return (
          item.court === court &&
          item.turn === turn &&
          auxItemDateToPlay === auxDateToPlay
        );
      });
      this.logger.log('validateCourtReserve Is existing:', isExisting);
      if (isExisting) {
        return false; // Court reservation already exists
      }
    }
    return true; // Court reservation is valid
  }

  async searchEmail(player: string): Promise<string> {
    const email = await this.registerService.findOneEmail(player);
    if (email) {
      return email; // Return email
    }
    return null; // Return null
  }

  async sendEmailReserve(courtReserve: CourtReserve) {
    // this.logger.log('Sending email:', { courtReserve });
    const email1: any = await this.searchEmail(courtReserve.player1);
    const email2: any = await this.searchEmail(courtReserve.player2);
    await this.emailService.sendEmail(
      email1,
      'Court reservation',
      `You have a reservation to play with ${courtReserve.player2} on ${courtReserve.dateToPlay} at ${courtReserve.turn} in court ${courtReserve.court}`,
    );
    await this.emailService.sendEmail(
      email2,
      'Court reservation',
      `You have a reservation to play with ${courtReserve.player1} on ${courtReserve.dateToPlay} at ${courtReserve.turn} in court ${courtReserve.court}`,
    );
  }

  async reserveCourt(
    courtReserveData: CourtReserve,
  ): Promise<CourtReserveResponse> {
    try {
      const validationReserve =
        await this.validateCourtReserve(courtReserveData);
      if (!validationReserve) {
        return {
          statusCode: 400,
          message: 'Court reservation already exists',
        };
      }
      const validationPlayers = await this.validatePlayers(courtReserveData);
      if (!validationPlayers) {
        return {
          statusCode: 400,
          message: 'Players already have a reservation',
        };
      }
      const reserveCourt = {
        ...courtReserveData,
        state: true,
      };
      const response = await this.courtReserveRepository.save(reserveCourt);
      if (response) {
        this.sendEmailReserve(reserveCourt);
        return {
          statusCode: 200,
          message: 'Court reserved successfully',
        };
      }
    } catch (error) {
      this.logger.error('Error reserving court:', error);
      throw error; // Optionally re-throw the error to propagate it
    }
  }
}
