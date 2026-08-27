import { Module } from '@nestjs/common';
import { MpService } from './mp.service';
import { MpController } from './mp.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { CourtReserve, CourtReserveSchema } from '../court-reserve/entities/court-reserve.entity';

@Module({
  imports: [MongooseModule.forFeature([{ name: CourtReserve.name, schema: CourtReserveSchema }])],
  controllers: [MpController],
  providers: [MpService],
})
export class MpModule {}
