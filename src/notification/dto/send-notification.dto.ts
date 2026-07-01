import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendNotificationDto {
  @ApiProperty({
    description: 'Título de la notificación push',
    example: 'Nueva reserva confirmada',
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    description: 'Cuerpo o mensaje de la notificación push',
    example: 'Tu reserva para Cancha 1 a las 18:00 ha sido registrada.',
  })
  @IsString()
  @IsNotEmpty()
  body: string;
}

