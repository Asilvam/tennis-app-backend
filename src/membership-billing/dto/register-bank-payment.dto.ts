import {
  IsBoolean,
  Equals,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SelectMembershipDuesDto } from './select-membership-dues.dto';

export class RegisterBankPaymentDto extends SelectMembershipDuesDto {
  @IsOptional() @IsBoolean() matchingReferenceVerified?: boolean;
  @IsEnum({ BANK_TRANSFER: 'BANK_TRANSFER', BANK_DEPOSIT: 'BANK_DEPOSIT' }) method:
    'BANK_TRANSFER' | 'BANK_DEPOSIT';
  @IsInt() @Min(1) amount: number;
  @IsString() @MinLength(1) @MaxLength(140) payerName: string;
  @IsOptional() @IsMongoId() payerMemberId?: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) receivedDate: string;
  @IsString() @MinLength(1) @MaxLength(120) reference: string;
  @Equals(true) verified: boolean;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class ReverseBankPaymentDto {
  @IsString() @MinLength(5) @MaxLength(1000) reason: string;
}
