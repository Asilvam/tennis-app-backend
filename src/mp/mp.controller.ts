import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { MpService } from './mp.service';
import { CreateMpDto } from './dto/create-mp.dto';
import { UpdateMpDto } from './dto/update-mp.dto';

@Controller('mp')
export class MpController {
  constructor(private readonly mpService: MpService) {}

  @Post('init-point')
  create(@Body() createMpDto: CreateMpDto) {
    return this.mpService.create(createMpDto);
  }

  @Get()
  findAll() {
    return this.mpService.findAll();
  }

  @Get('payment/:id')
  findOne(@Param('id') id: string) {
    return this.mpService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateMpDto: UpdateMpDto) {
    return this.mpService.update(+id, updateMpDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.mpService.remove(+id);
  }
}
