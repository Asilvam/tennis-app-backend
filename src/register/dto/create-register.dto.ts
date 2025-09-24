import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, MinLength, IsIn } from 'class-validator';
import { EstadoPago } from '../enums/estado-pago.enum';
import { TipoSocio } from '../enums/tipo-socio.enum';
import { Category } from '../enums/category.enum';

export class CreateRegisterDto {
  @Transform(({ value }) => value.trim())
  @IsString()
  @MinLength(1)
  namePlayer: string;

  @IsEmail()
  email: string;

  @IsString()
  cellular: string;

  @IsOptional()
  @IsString()
  @IsIn(Object.values(Category))
  category?: Category;

  @IsOptional()
  @IsString()
  points?: string;

  @Transform(({ value }) => value.trim())
  @IsString()
  @MinLength(6)
  pwd: string;

  @IsOptional()
  @IsBoolean()
  statePlayer?: boolean;

  @IsOptional()
  @IsBoolean()
  updatePayment?: boolean;

  @IsOptional()
  @IsBoolean()
  emailVerified?: boolean;

  @IsOptional()
  @IsString()
  verificationToken?: string;

  @IsOptional()
  @IsString()
  urlEmail?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsBoolean()
  hasVoted?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(Object.values(EstadoPago))
  estadoPago?: EstadoPago;

  @IsString()
  @IsIn(Object.values(TipoSocio))
  partnerType: TipoSocio;

  @IsOptional()
  @IsBoolean()
  socioPrincipal?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(Object.values(TipoSocio))
  montoPagar?: TipoSocio;

  @IsOptional()
  @IsBoolean()
  isLigthNigth?: boolean;
}
