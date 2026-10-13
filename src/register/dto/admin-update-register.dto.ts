import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsMongoId, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';
import { TipoSocio } from '../enums/tipo-socio.enum';

export class AdminUpdateRegisterDto {
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  namePlayer?: string;

  @IsOptional()
  @IsString()
  cellular?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['admin', 'user', 'profesor'])
  role?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  statePlayer?: boolean;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  updatePayment?: boolean;

  @IsOptional()
  @IsIn(Object.values(TipoSocio))
  partnerType?: TipoSocio;

  @IsOptional()
  @IsMongoId()
  titularId?: string | null;
}
