// src/court-reserve/court-reserve.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CourtReserveController } from './court-reserve.controller';
import { CourtReserveService } from './court-reserve.service';
import {CourtReserve} from "./entities/court-reserve.entity";

@Module({
  imports: [TypeOrmModule.forFeature([CourtReserve])],
  controllers: [CourtReserveController],
  providers: [CourtReserveService],
})
export class CourtReserveModule {}
