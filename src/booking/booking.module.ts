import { Module } from '@nestjs/common';
import { BookingService } from './booking.service';
import { BookingController } from './booking.controller';
import { CourtReserveModule } from '../court-reserve/court-reserve.module';

@Module({
  imports: [CourtReserveModule],
  controllers: [BookingController],
  providers: [BookingService],
})
export class BookingModule {}
