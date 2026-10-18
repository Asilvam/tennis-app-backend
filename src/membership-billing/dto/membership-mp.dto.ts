import { IsString, Matches } from 'class-validator';

export class MembershipPaymentEventDto {
  @IsString() @Matches(/^\d{1,30}$/) paymentId: string;
}
