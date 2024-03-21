import {Injectable, Logger} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {CourtReserve} from "./entities/court-reserve.entity";
import {Repository} from "typeorm";

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
            today.setHours(0, 0, 0, 0);
            return await this.courtReserveRepository.find();

        } catch (error) {
            this.logger.error('Error retrieving court reserves:', error);
            throw error; // Optionally re-throw the error to propagate it
        }
    }


    async reserveCourt(courtReserveData: CourtReserve): Promise<CourtReserve> {
        const reserveCourt = {
            ...courtReserveData,
            state: true,
        }
        return this.courtReserveRepository.save(reserveCourt);
    }
}
