import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCourtDto {
  @ApiProperty({
    description: 'Número identificador físico de la cancha',
    example: 1,
  })
  @IsNumber()
  @IsNotEmpty()
  courtNumber: number;

  @ApiProperty({
    description: 'Estado operativo de la cancha (activa/inactiva)',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  state?: boolean;

  @ApiProperty({
    description: 'Nombre descriptivo de la cancha',
    example: 'Cancha 1 (Arcilla)',
  })
  @IsString()
  @IsNotEmpty()
  courtName: string;

  @ApiProperty({
    description: 'Listado de turnos u horarios predefinidos para la cancha',
    example: ['08:00 - 09:30', '09:30 - 11:00', '18:00 - 19:30'],
    isArray: true,
    required: false,
  })
  @IsOptional()
  @IsArray()
  courtScheduleTurns?: string[];
}
