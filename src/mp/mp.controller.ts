import { Controller, Get, Header, Post, Body, Req, UseGuards, Param } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiTags } from '@nestjs/swagger';
import { MpService } from './mp.service';
import { CreateMpDto } from './dto/create-mp.dto';

@ApiTags('mercadopago')
@Controller('mp')
export class MpController {
  constructor(private readonly mpService: MpService) {}

  @Get('rates')
  @Header('Cache-Control', 'no-store')
  getRates() {
    return this.mpService.getRates();
  }

  @Get('reservations/:id/status')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  reservationStatus(@Param('id') id: string, @Req() request: { user: { email: string } }) {
    return this.mpService.reservationStatus(id, request.user.email);
  }

  @Post('init-point')
  @UseGuards(JwtAuthGuard)
  create(@Body() createMpDto: CreateMpDto, @Req() request: { user: { email: string } }) {
    return this.mpService.create(createMpDto, request.user.email);
  }
}
