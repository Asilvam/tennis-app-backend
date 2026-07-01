import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTurnDto {
  @ApiProperty({
    description: 'Número identificador correlativo del turno',
    example: 1,
  })
  @IsNotEmpty()
  @IsNumber()
  turnNumber: number;

  @ApiProperty({
    description: 'Estado operativo del turno (activo/inactivo)',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  state?: boolean;

  @ApiProperty({
    description: 'Horario del bloque del turno',
    example: '08:00 - 09:30',
  })
  @IsNotEmpty()
  @IsString()
  schedule: string;

  @ApiProperty({
    description: 'Indica si este bloque requiere pago de luz (bloques nocturnos)',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isPayed?: boolean;
}
