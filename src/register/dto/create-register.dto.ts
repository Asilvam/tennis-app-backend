import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from "class-validator";

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

  @IsOptional() // Mark as optional
  @IsBoolean()
  statePlayer?: boolean;

  @IsOptional() // Mark as optional
  @IsString()
  role?: string;
}
