import { Transform } from 'class-transformer';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateRegisterDto {
  @Transform(({ value }) => value.trim())
  @IsString()
  @MinLength(1)
  namePlayer: string;

  @IsEmail()
  email: string;

  @IsString()
  cellular: string;

  @Transform(({ value }) => value.trim())
  @IsString()
  @MinLength(6)
  pwd: string;
}
