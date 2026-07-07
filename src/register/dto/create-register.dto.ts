import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, MinLength, IsIn, IsArray, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { EstadoPago } from '../enums/estado-pago.enum';
import { TipoSocio } from '../enums/tipo-socio.enum';
import { Category, MatchType } from '../enums/category.enum';

// DTO para las categorías del jugador
export class PlayerCategoryDto {
  @IsString()
  @IsIn(Object.values(Category))
  category: string;

  @IsArray()
  @IsString({ each: true })
  @IsIn(Object.values(MatchType), { each: true })
  matchTypes: string[]; // ['singles', 'doubles']
}

export class CreateRegisterDto {
  @Transform(({ value }) => value.trim())
  @IsString()
  @MinLength(1)
  namePlayer: string;

  @IsEmail()
  email: string;

  @IsString()
  cellular: string;

  // ✅ NUEVO: Array de categorías con sus tipos de partido
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlayerCategoryDto)
  @ArrayMinSize(1, { message: 'El jugador debe tener al menos una categoría' })
  categories?: PlayerCategoryDto[];

  // ❌ ELIMINADOS: category, points, pointsDoubles
  // Ahora se manejan a través del array categories

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

  @IsOptional()
  @IsString()
  imageUrlProfile?: string;
}
