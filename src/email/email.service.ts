import { Injectable, Logger } from '@nestjs/common';
import { SendEmailDto } from './dto/send-email.dto';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { buildPasswordChangedEmail, buildPasswordResetEmail, buildVerificationEmail } from './templates/transactional-email.templates';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  constructor(private readonly configService: ConfigService) {}

  async sendEmail(sendEmailDto: SendEmailDto, idempotencyKey?: string, timeoutMs?: number) {
    const { to, subject, html } = sendEmailDto;
    const emailServiceApiUrl = this.configService.get<string>('EMAIL_SERVICE_API_URL');
    const emailServiceApiKey = this.configService.get<string>('EMAIL_SERVICE_API_KEY');
    if (!emailServiceApiUrl || !emailServiceApiKey) {
      throw new Error('Email service is not configured');
    }
    try {
      await axios.post(
        `${emailServiceApiUrl}/send`,
        {
          to,
          subject,
          html,
        },
        {
          ...(timeoutMs ? { timeout: timeoutMs } : {}),
          headers: {
            'x-api-key': emailServiceApiKey,
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          },
        },
      );
      this.logger.log(`Email sent successfully to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}: ${error.message}`, error.stack);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async sendResetPasswordEmail(to: string, resetLink: string, validity: '15 minutos' | '24 horas' = '24 horas') {
    const subject = 'Restablecer contraseña - Club de Tenis Quintero';
    const html = buildPasswordResetEmail(resetLink, validity);
    try {
      await this.sendEmail({ to, subject, html });
      this.logger.log(`Reset password email sent successfully to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send reset password email to ${to}: ${error.message}`, error.stack);
      throw new Error(`Failed to send reset password email: ${error.message}`);
    }
  }

  async sendPasswordChangedEmail(to: string) {
    await this.sendEmail({ to, subject: 'Contraseña actualizada - Club de Tenis Quintero', html: buildPasswordChangedEmail() });
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
