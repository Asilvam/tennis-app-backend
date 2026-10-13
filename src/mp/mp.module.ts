import { Module } from '@nestjs/common';
import { MpService } from './mp.service';
import { MpController } from './mp.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { CourtReserve, CourtReserveSchema } from '../court-reserve/entities/court-reserve.entity';
import { CourtReserveModule } from '../court-reserve/court-reserve.module';

@Module({
  imports: [CourtReserveModule, MongooseModule.forFeature([{ name: CourtReserve.name, schema: CourtReserveSchema }])],
  controllers: [MpController],
  providers: [MpService],
})
export class MpModule {}
