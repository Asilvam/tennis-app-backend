import { ApiProperty } from '@nestjs/swagger';

export class CreateMultipleBookingDto {
  @ApiProperty({
    description: 'Listado de nombres o identificadores de canchas a reservar o bloquear',
    example: ['Cancha 1', 'Cancha 2'],
    isArray: true,
  })
  courts: string[];

  @ApiProperty({
    description: 'Listado de fechas en las que se aplicará el bloqueo o reserva (YYYY-MM-DD)',
    example: ['2026-05-27', '2026-05-28'],
    isArray: true,
  })
  dates: string[];

  @ApiProperty({
    description: 'Listado de turnos u horarios correspondientes',
    example: ['08:00 - 09:30', '18:00 - 19:30'],
    isArray: true,
  })
  turns: string[];

  @ApiProperty({
    description: 'Motivo de la reserva masiva o bloqueo administrativo (se asignará como player1)',
    example: 'Mantención de Canchas / Torneo Club',
  })
  motive: string;
}
