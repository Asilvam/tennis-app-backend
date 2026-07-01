import { IsBoolean, IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCourtReserveDto {
  @ApiProperty({
    description: 'Nombre o identificador de la cancha',
    example: 'Cancha 1',
  })
  @IsNotEmpty()
  @IsString()
  court: string;

  @ApiProperty({
    description: 'Email o nombre del Jugador 1 (Socio reservante)',
    example: 'socio1@gmail.com',
    required: false,
  })
  @IsOptional()
  @IsString()
  player1?: string;

  @ApiProperty({
    description: 'Email o nombre del Jugador 2 (Rival)',
    example: 'socio2@gmail.com',
    required: false,
  })
  @IsOptional()
  @IsString()
  player2?: string;

  @ApiProperty({
    description: 'Fecha de la reserva en formato YYYY-MM-DD o ISO8601',
    example: '2026-05-27',
  })
  @IsNotEmpty()
  @IsDateString()
  dateToPlay: string;

  @ApiProperty({
    description: 'Bloque horario o turno elegido',
    example: '18:00 - 19:30',
  })
  @IsNotEmpty()
  @IsString()
  turn: string;

  @ApiProperty({
    description: 'Estado administrativo de la reserva',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  state?: boolean;

  @ApiProperty({
    description: 'Indica si el resultado del partido ya fue ingresado',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  resultMatchUpdated?: boolean;

  @ApiProperty({
    description: 'Email o nombre del Jugador 3 (Dobles)',
    example: 'socio3@gmail.com',
    required: false,
  })
  @IsOptional()
  @IsString()
  player3?: string;

  @ApiProperty({
    description: 'Email o nombre del Jugador 4 (Dobles)',
    example: 'socio4@gmail.com',
    required: false,
  })
  @IsOptional()
  @IsString()
  player4?: string;

  @ApiProperty({
    description: 'Indica si es un turno nocturno de pago',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isPaidNight?: boolean;

  @ApiProperty({
    description: 'Indica si el pago nocturno ya fue procesado',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  wasPaid?: boolean;

  @ApiProperty({
    description: 'Indica si la modalidad de juego es dobles',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isDouble?: boolean;

  @ApiProperty({
    description: 'Indica si se incluye a una visita externa',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isVisit?: boolean;

  @ApiProperty({
    description: 'Nombre del jugador de visita externa',
    example: 'Visita Externa',
    required: false,
  })
  @IsOptional()
  @IsString()
  visitName?: string;

  @ApiProperty({
    description: 'Indica si el partido computa para el ranking del club',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isForRanking?: boolean;

  @ApiProperty({
    description: 'Indica si el bloque está bloqueado por administración',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isBlockedByAdmin?: boolean;

  @ApiProperty({
    description: 'Motivo del bloqueo administrativo',
    example: 'Mantención de luminarias',
    required: false,
  })
  @IsOptional()
  @IsString()
  blockedMotive?: string;
}
