import { Injectable } from '@nestjs/common';
import { CreateMultipleBookingDto } from './dto/create-multiple-booking.dto';
import { Booking } from './booking.interface';
import { CourtReserveService } from '../court-reserve/court-reserve.service';

@Injectable()
export class BookingService {
  constructor(private readonly courtReserveService: CourtReserveService) {}

  async createMultiple(dto: CreateMultipleBookingDto) {
    const { courts, dates, turns, motive } = dto;
    const newBookings: Booking[] = [];
    courts.forEach((court) => {
      dates.forEach((date) => {
        turns.forEach((turn) => {
          const booking = {
            court,
            dateToPlay: date,
            turn,
            blockedMotive: motive,
            player1: motive,
            isBlockedByAdmin: true,
          };
          newBookings.push(booking);
        });
      });
    });
    return await this.courtReserveService.adminReserve(newBookings);
  }
}
