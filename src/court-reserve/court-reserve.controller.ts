import { Controller, Get, Post, Body } from '@nestjs/common';
import { CourtReserveService } from './court-reserve.service';
import {CourtReserve} from "./entities/court-reserve.entity";

@Controller('court-reserves')
export class CourtReserveController {
  constructor(private readonly courtReserveService: CourtReserveService) {}

  @Get()
  async getAllCourtReserves(): Promise<CourtReserve[]> {
    return this.courtReserveService.getAllCourtReserves();
  }

  @Post()
  async reserveCourt(@Body() courtReserveData: CourtReserve): Promise<CourtReserve> {
    return this.courtReserveService.reserveCourt(courtReserveData);
  }
}
