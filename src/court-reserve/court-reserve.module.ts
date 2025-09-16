import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CourtReserveService } from './court-reserve.service';
import { CourtReserveController } from './court-reserve.controller';
import { CourtReserve, CourtReserveSchema } from './entities/court-reserve.entity';
import { RegisterModule } from '../register/register.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: CourtReserve.name, schema: CourtReserveSchema }]),
    RegisterModule,
    EmailModule,
  ],
  providers: [CourtReserveService],
  controllers: [CourtReserveController],
  exports: [CourtReserveService, MongooseModule],
})
export class CourtReserveModule {}
