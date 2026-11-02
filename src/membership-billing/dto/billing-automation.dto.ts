import { IsBoolean, IsIn, Matches } from 'class-validator';

export class UpdateBillingAutomationDto {
  @IsIn(['generation', 'autoBlock'])
  setting: 'generation' | 'autoBlock';

  @IsBoolean()
  enabled: boolean;

  @Matches(/^[a-f\d]{64}$/)
  revision: string;
}
