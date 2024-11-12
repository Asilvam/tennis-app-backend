import { IsString, IsNotEmpty } from 'class-validator';

export class ValidateMatchDto {
  @IsString()
  @IsNotEmpty({ message: 'El id del partido es obligatorio.' })
  id: string;

  @IsString()
  @IsNotEmpty({ message: 'La clave del partido es obligatoria.' })
  pass: string;
}
