import { IsEmail } from 'class-validator';

export class CheckBlockedDto {
  @IsEmail()
  email: string;
}
