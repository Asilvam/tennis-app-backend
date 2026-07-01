import { IsString, IsNumber, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateMpDto {
  @ApiProperty({
    description: 'Nombre o identificador de la cancha a reservar',
    example: 'Cancha 1',
  })
  @IsString()
  @IsNotEmpty()
  courtId: string;

  @ApiProperty({
    description: 'Fecha seleccionada para la reserva',
    example: '2026-05-27',
  })
  @IsString()
  @IsNotEmpty()
  date: string;

  @ApiProperty({
    description: 'Horario del turno de la reserva',
    example: '19:30 - 21:00',
  })
  @IsString()
  @IsNotEmpty()
  time: string;

  @ApiProperty({
    description: 'Email o identificador del jugador reservante',
    example: 'socio@gmail.com',
  })
  @IsString()
  @IsNotEmpty()
  player1: string;

  @ApiProperty({
    description: 'Monto en CLP a pagar por concepto de luz nocturna de la cancha',
    example: 6000,
  })
  @IsNumber()
  @IsNotEmpty()
  amount: number;

  @ApiProperty({
    description: 'Identificador único de la reserva de cancha',
    example: 'abc123xyz789',
  })
  @IsString()
  @IsNotEmpty()
  idCourtReserve: string;
}

