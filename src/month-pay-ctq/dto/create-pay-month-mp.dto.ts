import { IsString, IsNumber, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePayMonthMpDto {
  @ApiProperty({
    description: 'Email del socio que realiza el pago',
    example: 'socio@gmail.com',
  })
  @IsString()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    description: 'Tipo de membresía a pagar: Titular o Familiar',
    example: 'Titular',
    enum: ['Titular', 'Familiar'],
  })
  @IsString()
  @IsNotEmpty()
  paymentType: string;

  @ApiProperty({
    description: 'Monto en CLP a pagar (18000 para Titular, 5000 para Familiar)',
    example: 18000,
  })
  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @ApiProperty({
    description: 'Mes de cobertura a pagar en formato MM-YYYY',
    example: '05-2026',
  })
  @IsString()
  @IsNotEmpty()
  monthToPay: string; // format: MM-YYYY

  @ApiProperty({
    description: 'Email de la carga familiar (requerido si el tipo de pago es Familiar)',
    example: 'carga@gmail.com',
    required: false,
  })
  @IsString()
  @IsOptional()
  emailCarga?: string;
}
