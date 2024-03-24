import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CourtReserve } from './entities/court-reserve.entity';
import { Repository } from 'typeorm';
import * as moment from 'moment';

@Injectable()
export class CourtReserveService {
  logger = new Logger(CourtReserveService.name);

  constructor(
    @InjectRepository(CourtReserve)
    private courtReserveRepository: Repository<CourtReserve>,
  ) {}

  async getAllCourtReserves(): Promise<CourtReserve[]> {
    const today = moment().startOf('day').format('YYYY-MM-DD');
    try {
      const courtReserveData = await this.courtReserveRepository.find({
        order: {
          created_at: 'ASC',
        },
      });
      if (courtReserveData.length > 0) {
        const courtReserves = courtReserveData.filter(
          (item) => (item.dateToPlay) >= today,
        );
        if (courtReserves) {
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

  async validateCourtReserve(courtReserve: CourtReserve): Promise<boolean> {
    console.log('Validating court reserve:', courtReserve);
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
      console.log('Is existing:', isExisting);
      if (isExisting) {
        return false; // Court reservation already exists
      }
    }
    return true; // Court reservation is valid
  }

  async reserveCourt(courtReserveData: CourtReserve): Promise<CourtReserve> {
    try {
      const validationReserve =
        await this.validateCourtReserve(courtReserveData);
      if (!validationReserve) {
        return null;
      }
      const reserveCourt = {
        ...courtReserveData,
        state: true,
      };
      const response = await this.courtReserveRepository.save(reserveCourt);
      if (response) {
        return response;
      }
    } catch (error) {
      this.logger.error('Error reserving court:', error);
      throw error; // Optionally re-throw the error to propagate it
    }
  }
}
