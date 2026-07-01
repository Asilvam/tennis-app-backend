import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MpService } from './mp.service';
import { CreateMpDto } from './dto/create-mp.dto';

@ApiTags('mercadopago')
@Controller('mp')
export class MpController {
  constructor(private readonly mpService: MpService) {}

  @Post('init-point')
  create(@Body() createMpDto: CreateMpDto) {
    return this.mpService.create(createMpDto);
  }
}
