import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendEmailDto {
  @ApiProperty({
    description: 'The recipient email address',
    example: 'recipient@example.com',
  })
  @IsEmail()
  to: string;

  @ApiProperty({
    description: 'The subject of the email',
    example: 'Welcome to Our Service!',
  })
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiProperty({
    description: 'The text body of the email',
    example: 'Thank you for signing up. We hope you enjoy our service!',
  })
  @IsString()
  @IsNotEmpty()
  html: string;
}
