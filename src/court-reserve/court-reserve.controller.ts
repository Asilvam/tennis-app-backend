import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Logger } from '@nestjs/common';
import { CourtReserveService } from './court-reserve.service';
import { CreateCourtReserveDto } from './dto/create-court-reserve.dto';
import { UpdateCourtReserveDto } from './dto/update-court-reserve.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('court-reserve')
export class CourtReserveController {
  logger = new Logger('CourtReserveController');
  constructor(private readonly courtReserveService: CourtReserveService) {}

  @Post()
  create(@Body() createCourtReserveDto: CreateCourtReserveDto) {
    return this.courtReserveService.create(createCourtReserveDto);
  }

  @Get('available/:selectedDate')
  findAllAvailable(@Param('selectedDate') selectedDate: string) {
    return this.courtReserveService.getAllCourtAvailable(selectedDate);
  }

  @Get('active/:namePlayer')
  findIfHasReserve(@Param('namePlayer') namePlayer: string) {
    return this.courtReserveService.getAllReservesFor(namePlayer);
  }
  @Get('history/:namePlayer')
  findHistoryReserve(@Param('namePlayer') namePlayer: string) {
    return this.courtReserveService.getAllHistoryReservesFor(namePlayer);
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
    return this.courtReserveService.remove(id);
  }

  @UseGuards(JwtAuthGuard) // Protect this route with JWT
  @Get('protected')
  getProtectedData() {
    return { message: 'This is a protected route' };
  }
}
