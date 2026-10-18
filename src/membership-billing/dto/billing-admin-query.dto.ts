import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class BillingAdminQueryDto {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @Matches(/^[2-9]\d{3}-(0[1-9]|1[0-2])$/) period?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @IsOptional() @IsMongoId() beneficiaryId?: string;
  @IsOptional()
  @IsEnum({
    CONFIRMED: 'CONFIRMED',
    REVERSED: 'REVERSED',
    PENDING: 'PENDING',
    REJECTED: 'REJECTED',
    REVIEW_REQUIRED: 'REVIEW_REQUIRED',
    CANCELLED: 'CANCELLED',
  })
  status?: string;
  @IsOptional()
  @IsEnum({
    BANK_TRANSFER: 'BANK_TRANSFER',
    BANK_DEPOSIT: 'BANK_DEPOSIT',
    MERCADO_PAGO: 'MERCADO_PAGO',
  })
  method?: string;
}

export class PrepareAdminDuesDto {
  @IsOptional() @Matches(/^[2-9]\d{3}-(0[1-9]|1[0-2])$/) throughPeriod?: string;
}
