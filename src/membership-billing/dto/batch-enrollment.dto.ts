import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { PreviewMembershipEnrollmentDto } from './enroll-membership.dto';

export class PreviewBatchEnrollmentDto extends PreviewMembershipEnrollmentDto {
  @IsOptional() @IsMongoId() familyMemberId?: string;
}
export class BatchEnrollmentItemDto {
  @IsMongoId() memberId: string;
  @IsString() @Matches(/^[a-f\d]{64}$/) approvalHash: string;
}
export class ApplyBatchEnrollmentDto extends PreviewMembershipEnrollmentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @ArrayUnique((row: BatchEnrollmentItemDto) => row?.memberId)
  @ValidateNested({ each: true })
  @Type(() => BatchEnrollmentItemDto)
  items: BatchEnrollmentItemDto[];
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason?: string;
}
export class ApproveBillingHistoryDto {
  @IsString() @Matches(/^[a-f\d]{64}$/) approvalHash: string;
  @IsString() @MinLength(5) @MaxLength(1000) reason: string;
}
