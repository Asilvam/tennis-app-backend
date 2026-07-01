import { IsString, IsNotEmpty, IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

// Se crea una clase para el objeto del ganador para una mejor validación
class WinnerDto {
  @ApiProperty({
    description: 'Correo electrónico del ganador',
    example: 'ganador@gmail.com',
  })
  @IsString()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    description: 'Nombre completo del ganador',
    example: 'Carlos Ganador',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Celular del ganador',
    example: '+56911111111',
  })
  @IsString()
  @IsNotEmpty()
  cellular: string;

  @ApiProperty({
    description: 'Categorías y puntaje asociado del jugador',
    example: [{ category: 'Honor', points: 120, isActive: true }],
  })
  @IsArray()
  @ValidateNested({ each: true }) // Valida cada objeto dentro del arreglo
  @IsNotEmpty()
  categories: [{ category: string; points: number; isActive: boolean }];
}

class LooserDto {
  @ApiProperty({
    description: 'Correo electrónico del perdedor',
    example: 'perdedor@gmail.com',
  })
  @IsString()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    description: 'Nombre completo del perdedor',
    example: 'Felipe Rival',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Celular del perdedor',
    example: '+56922222222',
  })
  @IsString()
  @IsNotEmpty()
  cellular: string;

  @ApiProperty({
    description: 'Categorías y puntaje asociado del jugador',
    example: [{ category: 'Honor', points: 80, isActive: true }],
  })
  @IsArray()
  @ValidateNested({ each: true }) // Valida cada objeto dentro del arreglo
  @IsNotEmpty()
  categories: [{ category: string; points: number; isActive: boolean }];
}

export class CreateMatchRankingDto {
  @ApiProperty({
    description: 'Identificador único del partido/reserva',
    example: 'abc123xyz789',
  })
  @IsString()
  @IsNotEmpty()
  matchId: string;

  @ApiProperty({
    description: 'Resultado del marcador',
    example: '6-4 6-2',
  })
  @IsString()
  @IsNotEmpty()
  result: string;

  @ApiProperty({
    description: 'Listado de ganadores del partido',
    type: [WinnerDto],
  })
  @IsArray()
  @ValidateNested({ each: true }) // Valida cada objeto dentro del arreglo
  @ArrayMinSize(1) // Asegura que el arreglo contenga al menos un ganador
  @Type(() => WinnerDto) // Especifica el tipo de objeto para la validación
  winner: WinnerDto[];

  @ApiProperty({
    description: 'Listado de perdedores del partido',
    type: [LooserDto],
  })
  @IsArray()
  @ValidateNested({ each: true }) // Valida cada objeto dentro del arreglo
  @ArrayMinSize(1) // Asegura que el arreglo contenga al menos un perdedor
  @Type(() => LooserDto) // Especifica el tipo de objeto para la validación
  looser: LooserDto[];
}
