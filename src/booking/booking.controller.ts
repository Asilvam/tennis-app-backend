import { Controller, Post, Body } from '@nestjs/common';
import { BookingService } from './booking.service';
import { CreateMultipleBookingDto } from './dto/create-multiple-booking.dto';

@Controller('booking')
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @Post('multiple')
  createMultiple(@Body() createMultipleBookingDto: CreateMultipleBookingDto) {
    return this.bookingService.createMultiple(createMultipleBookingDto);
  }
}
