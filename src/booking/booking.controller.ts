import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { BookingService } from './booking.service';
import { CreateMultipleBookingDto } from './dto/create-multiple-booking.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

type AuthenticatedRequest = Request & {
  user: {
    email: string;
    role: string;
  };
};

@Controller('booking')
@UseGuards(JwtAuthGuard)
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @Post('multiple')
  createMultiple(
    @Body() createMultipleBookingDto: CreateMultipleBookingDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.bookingService.createMultiple(createMultipleBookingDto, request.user);
  }
}
