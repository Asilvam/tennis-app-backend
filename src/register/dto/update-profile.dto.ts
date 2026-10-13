import { Transform } from 'class-transformer';
import { IsString, IsUrl, MinLength, ValidateIf } from 'class-validator';

export class UpdateProfileDto {
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(1)
  namePlayer?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  cellular?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  imageUrlProfile?: string;
}
