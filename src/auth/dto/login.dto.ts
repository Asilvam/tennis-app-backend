import { Transform } from 'class-transformer';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    description: 'Correo electrónico del socio (nombre de usuario)',
    example: 'socio@gmail.com',
  })
  @Transform(({ value }) => value.trim())
  @IsEmail()
  username: string;

  @ApiProperty({
    description: 'Contraseña de la cuenta (mínimo 6 caracteres)',
    example: 'password123',
    minLength: 6,
  })
  @Transform(({ value }) => value.trim())
  @IsString()
  @MinLength(6)
  password: string;
}
