import { Controller, Get, Header, Post, Body, Req, UseGuards } from '@nestjs/common';
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

  @Post('init-point')
  @UseGuards(JwtAuthGuard)
  create(@Body() createMpDto: CreateMpDto, @Req() request: { user: { email: string } }) {
    return this.mpService.create(createMpDto, request.user.email);
  }
}
