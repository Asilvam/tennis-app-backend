import { IsString, IsNotEmpty, IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

// Se crea una clase para el objeto del ganador para una mejor validación
class WinnerDto {
  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  points: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsString()
  @IsNotEmpty()
  cellular: string;
}

export class CreateMatchRankingDto {
  @IsString()
  @IsNotEmpty()
  matchId: string;

  @IsString()
  @IsNotEmpty()
  result: string;

  // La propiedad 'winner' ahora es un arreglo de objetos 'WinnerDto'
  @IsArray()
  @ValidateNested({ each: true }) // Valida cada objeto dentro del arreglo
  @ArrayMinSize(1) // Asegura que el arreglo contenga al menos un ganador
  @Type(() => WinnerDto) // Especifica el tipo de objeto para la validación
  winner: WinnerDto[];
}
