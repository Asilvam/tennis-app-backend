import { Controller, Get, Post, Body } from '@nestjs/common';
import { CourtReserveService } from './court-reserve.service';
import { CourtReserve } from './entities/court-reserve.entity';
import { CourtReserveResponse } from './interfaces/court-reserve.interface';

@Controller('court-reserves')
export class CourtReserveController {
  constructor(private readonly courtReserveService: CourtReserveService) {}

  @Get()
  async getAllCourtReserves(): Promise<CourtReserve[]> {
    return this.courtReserveService.getAllCourtReserves();
  }

  @Post()
  async reserveCourt(@Body() courtReserve: CourtReserve,): Promise<CourtReserveResponse> {
    return this.courtReserveService.reserveCourt(courtReserve);
  }
}
