import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Headers, Req, Query, ValidationPipe } from '@nestjs/common';
import { CourtReserveService } from './court-reserve.service';
import { CreateCourtReserveDto } from './dto/create-court-reserve.dto';
import { UpdateCourtReserveDto } from './dto/update-court-reserve.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { InternalApiKeyGuard } from '../auth/guards/internal-api-key.guard';
import { PaymentConfirmationDto } from './dto/payment-confirmation.dto';
import { ReservationHistoryQueryDto } from './dto/reservation-history-query.dto';

@Controller('court-reserve')
export class CourtReserveController {
  constructor(private readonly courtReserveService: CourtReserveService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() createCourtReserveDto: CreateCourtReserveDto, @Req() request: { user: { email: string } }) {
    return this.courtReserveService.createAuthenticated(createCourtReserveDto, request.user.email);
  }

  @Post('holds')
  @UseGuards(JwtAuthGuard)
  createHold(@Body() dto: CreateCourtReserveDto, @Req() request: { user: { email: string } }) {
    return this.courtReserveService.createHold(dto, request.user.email);
  }

  @Delete('holds/:reservationId')
  @UseGuards(JwtAuthGuard)
  cancelHold(@Param('reservationId') reservationId: string, @Req() request: { user: { email: string } }) {
    return this.courtReserveService.cancelHold(reservationId, request.user.email);
  }

  @Patch('holds/:reservationId')
  @UseGuards(JwtAuthGuard)
  prepareHold(@Param('reservationId') reservationId: string, @Body() dto: CreateCourtReserveDto, @Req() request: { user: { email: string } }) {
    return this.courtReserveService.prepareHold(reservationId, dto, request.user.email);
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

  @Get('my-history')
  @UseGuards(JwtAuthGuard)
  findMyHistory(
    @Query(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })) query: ReservationHistoryQueryDto,
    @Req() request: { user: { email: string } },
  ) {
    return this.courtReserveService.getMyReservationHistory(request.user.email, query);
  }

  @Get('isForRankingHistory/:namePlayer')
  findIsforRankingHistoryReserve(@Param('namePlayer') namePlayer: string) {
    return this.courtReserveService.getAllIsForRankingReservesFor(namePlayer);
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
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string, @Req() request: { user: { email: string } }) {
    return this.courtReserveService.remove(id, request.user.email);
  }

  @UseGuards(JwtAuthGuard) // Protect this route with JWT
  @Get('protected')
  getProtectedData() {
    return { message: 'This is a protected route' };
  }
}
