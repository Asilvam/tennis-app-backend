import {Injectable, Logger} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {CourtReserve} from "./entities/court-reserve.entity";

@Injectable()
export class CourtReserveService {
  logger = new Logger(CourtReserveService.name);
  constructor(
      @InjectRepository(CourtReserve)
      private courtReserveRepository: Repository<CourtReserve>,
  ) {}

  async getAllCourtReserves(): Promise<CourtReserve[]> {
    return this.courtReserveRepository.find();
  }

  async reserveCourt(courtReserveData: CourtReserve): Promise<CourtReserve> {
    return this.courtReserveRepository.save(courtReserveData);
  }
}
