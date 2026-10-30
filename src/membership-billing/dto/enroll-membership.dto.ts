import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class PreviewMembershipReenrollmentDto {
  @IsString()
  @Matches(/^[2-9]\d{3}-(0[1-9]|1[0-2])$/)
  startPeriod: string;
}

export class PreviewMembershipEnrollmentDto extends PreviewMembershipReenrollmentDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/^[2-9]\d{3}-(0[1-9]|1[0-2])$/)
  throughPeriod?: string;
}

export class ReenrollMembershipDto extends PreviewMembershipReenrollmentDto {
  @IsString()
  @Matches(/^[a-f\d]{64}$/)
  approvalHash: string;

  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason: string;
}

export class EnrollMembershipDto extends PreviewMembershipEnrollmentDto {
  @IsString()
  @Matches(/^[a-f\d]{64}$/)
  approvalHash: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason?: string;
}
