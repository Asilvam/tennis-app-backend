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

  async sendResetPasswordEmail(to: string, newPassword: string) {
    const subject = 'Restablecimiento de Contraseña - Club de Tenis';
    const html = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px;">
        <h2 style="color: #0d47a1; text-align: center;">Restablecimiento de Contraseña</h2>
        <p>Hola,</p>
        <p>Se ha solicitado un restablecimiento de contraseña para tu cuenta en el sistema del Club de Tenis.</p>
        <p>Tu nueva contraseña es:</p>
        <p style="background-color: #e3f2fd; border: 1px solid #bbdefb; padding: 10px 15px; font-size: 18px; font-weight: bold; text-align: center; letter-spacing: 2px; border-radius: 5px;">
          ${newPassword}
        </p>
        <hr style="border: 0; border-top: 1px solid #eee;">
        <p style="font-size: 0.9em; color: #777; text-align: center;">Este es un correo electrónico generado automáticamente, por favor no respondas a este mensaje.</p>
      </div>
    `;
    try {
      await this.mailerService.sendMail({
        to,
        subject,
        html,
      });
      this.logger.log(`Reset password email sent successfully to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send reset password email to ${to}: ${error.message}`, error.stack);
      throw new Error(`Failed to send reset password email: ${error.message}`);
    }
  }

  async sendVerificationEmail(email: string, verificationLink: string) {
    const subject = 'Verifica tu dirección de correo electrónico - Club de Tenis Quintero';
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol'; color: #333; max-width: 600px; margin: auto; border: 1px solid #e0e0e0; border-radius: 12px; padding: 25px; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
        <h2 style="color: #0d47a1; text-align: center; margin-top: 0; border-bottom: 2px solid #0d47a1; padding-bottom: 15px;">
          ✉️ Verificación de Correo Electrónico ✉️
        </h2>
        <p style="font-size: 16px;">¡Hola!</p>
        <p style="font-size: 16px; line-height: 1.6;">Gracias por registrarte. Por favor, haz clic en el botón de abajo para verificar tu dirección de correo electrónico y activar tu cuenta.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationLink}" style="background-color: #0d47a1; color: white; padding: 15px 25px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold;">Verificar mi Correo</a>
        </div>
        <p style="font-size: 16px; line-height: 1.6;">Si no puedes hacer clic en el botón, copia y pega el siguiente enlace en tu navegador:</p>
        <p style="font-size: 14px; color: #555; word-break: break-all;">${verificationLink}</p>
        <p style="margin-top: 30px; font-size: 16px;">Atentamente,<br><strong>Club de Tenis Quintero</strong></p>
        <hr style="border: 0; border-top: 1px solid #eee; margin-top: 20px;">
        <p style="font-size: 0.9em; color: #777; text-align: center;">Este es un correo electrónico generado automáticamente, por favor no respondas a este mensaje.</p>
      </div>
    `;

    try {
      await this.mailerService.sendMail({ to: email, subject, html });
      this.logger.log(`Verification email sent successfully to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${email}: ${error.message}`, error.stack);
      // Re-throwing the error so the calling service can handle it
      throw new Error(`Failed to send verification email: ${error.message}`);
    }
  }
}
