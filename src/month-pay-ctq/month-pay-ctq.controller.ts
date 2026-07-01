import { Controller, Post, Get, Body, Param, ValidationPipe } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiParam } from '@nestjs/swagger';
import { MonthPayCtqService } from './month-pay-ctq.service';
import { CreatePayMonthMpDto } from './dto/create-pay-month-mp.dto';

@ApiTags('month-pay-ctq')
@Controller('month-pay-ctq')
export class MonthPayCtqController {
  constructor(private readonly monthPayCtqService: MonthPayCtqService) {}

  @Post('initiate')
  @ApiOperation({ summary: 'Registrar un pago de mensualidad en estado pendiente' })
  @ApiResponse({ status: 201, description: 'Registro de mensualidad pendiente creado exitosamente.', type: CreatePayMonthMpDto })
  @ApiResponse({ status: 400, description: 'Petición inválida o errores de validación.' })
  initiatePayment(@Body(new ValidationPipe()) dto: CreatePayMonthMpDto) {
    return this.monthPayCtqService.initiatePayment(dto);
  }

  @Get('history/:email')
  @ApiOperation({ summary: 'Obtener el historial de pagos de mensualidad de un socio por correo' })
  @ApiParam({ name: 'email', description: 'Correo electrónico del socio titular o carga', example: 'socio@gmail.com' })
  @ApiResponse({ status: 200, description: 'Historial obtenido exitosamente.' })
  getPaymentHistory(@Param('email') email: string) {
    return this.monthPayCtqService.getPaymentHistory(email);
  }

  @Post('approve/:idPayment')
  @ApiOperation({ summary: 'Aprobar una mensualidad pendiente mediante ID de pago único de 15 caracteres' })
  @ApiParam({ name: 'idPayment', description: 'Identificador único compacto de 15 caracteres del pago', example: 'a1b2c3d4e5f6g7h' })
  @ApiResponse({ status: 200, description: 'Mensualidad aprobada y vigencia del socio actualizada.' })
  @ApiResponse({ status: 404, description: 'Registro de pago no encontrado.' })
  approvePayment(@Param('idPayment') idPayment: string) {
    return this.monthPayCtqService.approvePayment(idPayment);
  }

  @Post('emailconfirmation')
  @ApiOperation({ summary: 'Enviar confirmación de correo electrónico de pago de mensualidad' })
  @ApiResponse({ status: 201, description: 'Correo de confirmación enviado exitosamente.' })
  @ApiResponse({ status: 400, description: 'Petición inválida.' })
  sendEmailConfirmation(@Body() body: { reservationId: string; paymentStatus: string }) {
    // Keep reservationId parameter name so it is 100% compatible with microservice payload
    return this.monthPayCtqService.sendMonthlyPaymentEmail(body.reservationId, body.paymentStatus);
  }
}

