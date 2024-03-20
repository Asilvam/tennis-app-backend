import {Injectable, Logger} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {Repository} from 'typeorm';
import {CourtReserve} from "./entities/court-reserve.entity";
import { LessThanOrEqual } from 'typeorm';

@Injectable()
export class CourtReserveService {
    logger = new Logger(CourtReserveService.name);

    constructor(
        @InjectRepository(CourtReserve)
        private courtReserveRepository: Repository<CourtReserve>,
    ) {
    }

    async getAllCourtReserves(): Promise<CourtReserve[]> {
        try {
            const today = new Date();
            // Query court reserves where dateToPlay is greater than or equal to today's date
            return await this.courtReserveRepository.find({
                where: {
                    dateToPlay: LessThanOrEqual(today),
                },
            });
        } catch (error) {
            this.logger.error('Error retrieving court reserves:', error);
            throw error; // Optionally re-throw the error to propagate it
        }
    }


    async reserveCourt(courtReserveData: CourtReserve): Promise<CourtReserve> {
        return this.courtReserveRepository.save(courtReserveData);
    }
}
