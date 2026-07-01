import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendToAllDto {
  @ApiProperty({
    description: 'Título de la notificación push masiva',
    example: 'Anuncio importante del Club',
    required: false,
  })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({
    description: 'Cuerpo o mensaje de la notificación push masiva',
    example: 'Este fin de semana se realizará el torneo anual del Club.',
    required: false,
  })
  @IsString()
  @IsOptional()
  body?: string;
}

