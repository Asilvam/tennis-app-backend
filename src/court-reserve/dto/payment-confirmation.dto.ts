import { IsEnum, IsNotEmpty, IsString } from 'class-validator';

export enum MercadoPagoPaymentStatus {
  APPROVED = 'approved',
  AUTHORIZED = 'authorized',
  PENDING = 'pending',
  IN_PROCESS = 'in_process',
  IN_MEDIATION = 'in_mediation',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
  CHARGED_BACK = 'charged_back',
}

export class PaymentConfirmationDto {
  @IsString()
  @IsNotEmpty()
  reservationId: string;

  @IsEnum(MercadoPagoPaymentStatus)
  paymentStatus: MercadoPagoPaymentStatus;
}
