import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, HttpCode, HttpStatus, Res, Headers } from '@nestjs/common';
import { CourtReserveService } from './court-reserve.service';
import { CreateCourtReserveDto } from './dto/create-court-reserve.dto';
import { UpdateCourtReserveDto } from './dto/update-court-reserve.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { InternalApiKeyGuard } from '../auth/guards/internal-api-key.guard';
import { PaymentConfirmationDto } from './dto/payment-confirmation.dto';

@Controller('court-reserve')
export class CourtReserveController {
  constructor(private readonly courtReserveService: CourtReserveService) {}

  @Post()
  create(@Body() createCourtReserveDto: CreateCourtReserveDto) {
    return this.courtReserveService.create(createCourtReserveDto);
  }

  @Post('admincreate')
  adminCreate(@Body() createCourtReserveDtoArray: CreateCourtReserveDto) {
    return this.courtReserveService.adminCreate(createCourtReserveDtoArray);
  }

  @Post('adminreserve')
  adminReserve(@Body() createCourtReserveDto: CreateCourtReserveDto[]) {
    return this.courtReserveService.adminReserve(createCourtReserveDto);
  }

  @Post('UpdateStateReserve/:idCourtReserve')
  @UseGuards(InternalApiKeyGuard)
  updateStateReserve(@Param('idCourtReserve') idCourtReserve: string, @Headers('idempotency-key') idempotencyKey: string) {
    return this.courtReserveService.updateStateReserve(idCourtReserve, idempotencyKey);
  }

  @Post('emailconfirmation')
  @UseGuards(InternalApiKeyGuard)
  sendEmailConfirmation(@Body() body: PaymentConfirmationDto, @Headers('idempotency-key') idempotencyKey: string) {
    return this.courtReserveService.sendEmailConfirmation(body.reservationId, body.paymentStatus, idempotencyKey);
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

  @Get('isForRankingHistory/:namePlayer')
  findIsforRankingHistoryReserve(@Param('namePlayer') namePlayer: string) {
    return this.courtReserveService.getAllIsForRankingReservesFor(namePlayer);
  }

  @Get('filtered-reserves/excel')
  async getFilteredReservesExcel(@Res() res) {
    const buffer = await this.courtReserveService.exportFilteredReservesToExcelBuffer();
    res.setHeader('Content-Disposition', 'attachment; filename="reserves.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  }

  @Get('filtered-reserves') // Ruta completa: GET /court-reserves/filtered-reserves
  @HttpCode(HttpStatus.OK)
  async getFilteredReserves() {
    try {
      const reserves = await this.courtReserveService.findFilteredReserves();
      return reserves;
    } catch (error) {
      throw new Error('Error al obtener las reservas filtradas.');
    }
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
