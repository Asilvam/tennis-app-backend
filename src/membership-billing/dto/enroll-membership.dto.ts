import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class PreviewMembershipEnrollmentDto {
  @IsString()
  @Matches(/^[2-9]\d{3}-(0[1-9]|1[0-2])$/)
  startPeriod: string;
}

export class EnrollMembershipDto extends PreviewMembershipEnrollmentDto {
  @IsString()
  @Matches(/^[a-f\d]{64}$/)
  approvalHash: string;

  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason: string;
}
