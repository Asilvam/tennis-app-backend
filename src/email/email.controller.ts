import { Controller, Post, Body, Logger } from '@nestjs/common';
import { EmailService } from './email.service';

@Controller('email')
export class EmailController {
  logger = new Logger(EmailController.name);
  constructor(private readonly emailService: EmailService) {}
  @Post('send')
  async sendEmail(
    @Body('to') to: string,
    @Body('subject') subject: string,
    @Body('body') body: string,
  ): Promise<string> {
    return this.emailService.sendEmail(to, subject, body);
  }

}
