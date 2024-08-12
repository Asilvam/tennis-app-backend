import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CourtReserveService } from './court-reserve.service';
import { CourtReserveController } from './court-reserve.controller';
import { CourtReserve, CourtReserveSchema } from './entities/court-reserve.entity';
import { RegisterModule } from '../register/register.module';

@Module({
  imports: [MongooseModule.forFeature([{ name: CourtReserve.name, schema: CourtReserveSchema }]), RegisterModule],
  providers: [CourtReserveService],
  controllers: [CourtReserveController],
})
export class CourtReserveModule {}
