import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { SendEmailDto } from './dto/send-email.dto';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  constructor(private mailerService: MailerService) {}

  async sendEmail(sendEmailDto: SendEmailDto) {
    const { to, subject, html } = sendEmailDto;

    try {
      await this.mailerService.sendMail({
        to,
        subject,
        html, // Make sure `text` is directly passed, or use `html` for rich text emails
      });
      this.logger.log(`Email sent successfully to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}: ${error.message}`, error.stack);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async sendVerificationEmail(email: string, verificationLink: string) {
    this.logger.log(email, verificationLink);
    await this.mailerService.sendMail({
      to: email,
      subject: 'Verify your email',
      html: `<p>Please verify your email by clicking on the link below:</p>
               <a href="${verificationLink}">Verify Email</a>`,
    });
  }
}
