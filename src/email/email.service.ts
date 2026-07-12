import { Injectable, Logger } from '@nestjs/common';
import { SendEmailDto } from './dto/send-email.dto';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { buildPasswordResetEmail, buildVerificationEmail } from './templates/transactional-email.templates';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  constructor(private readonly configService: ConfigService) {}

  async sendEmail(sendEmailDto: SendEmailDto) {
    const { to, subject, html } = sendEmailDto;
    const emailServiceApiUrl = this.configService.get<string>('EMAIL_SERVICE_API_URL');
    try {
      await axios.post(
        `${emailServiceApiUrl}/send`,
        {
          to,
          subject,
          html,
        },
        {
          headers: {
            'x-api-key': 'API_KEY_1234567890',
          },
        },
      );
      this.logger.log(`Email sent successfully to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}: ${error.message}`, error.stack);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async sendResetPasswordEmail(to: string, newPassword: string) {
    const subject = 'Contraseña restablecida - Club de Tenis Quintero';
    const html = buildPasswordResetEmail(newPassword);
    try {
      await this.sendEmail({ to, subject, html });
      this.logger.log(`Reset password email sent successfully to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send reset password email to ${to}: ${error.message}`, error.stack);
      throw new Error(`Failed to send reset password email: ${error.message}`);
    }
  }

  async sendVerificationEmail(email: string, verificationLink: string) {
    const subject = 'Verifica tu correo - Club de Tenis Quintero';
    const html = buildVerificationEmail(verificationLink);

    try {
      await this.sendEmail({ to: email, subject, html });
      this.logger.log(`Verification email sent successfully to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${email}: ${error.message}`, error.stack);
      // Re-throwing the error so the calling service can handle it
      throw new Error(`Failed to send verification email: ${error.message}`);
    }
  }
}
