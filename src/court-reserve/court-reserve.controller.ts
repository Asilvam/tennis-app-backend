import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { CourtReserveService } from './court-reserve.service';
import { CreateCourtReserveDto } from './dto/create-court-reserve.dto';
import { UpdateCourtReserveDto } from './dto/update-court-reserve.dto';

@Controller('court-reserve')
export class CourtReserveController {
  constructor(private readonly courtReserveService: CourtReserveService) {}

  @Post()
  create(@Body() createCourtReserveDto: CreateCourtReserveDto) {
    return this.courtReserveService.create(createCourtReserveDto);
  }

  @Get()
  findAll() {
    return this.courtReserveService.getAllCourtReserves();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateCourtReserveDto: UpdateCourtReserveDto) {
    return this.courtReserveService.update(+id, updateCourtReserveDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.courtReserveService.remove(+id);
  }

  // @Post()
  // async reserveCourt(@Body() courtReserve: CourtReserve): Promise<CourtReserveResponse> {
  //   return this.courtReserveService.reserveCourt(courtReserve);
  // }
}
