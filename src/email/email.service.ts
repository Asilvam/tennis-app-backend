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
    await this.mailerService.sendMail({
      to,
      subject,
      html,
    });
  }

  async sendVerificationEmail(email: string, verificationLink: string) {
    this.logger.log(email, verificationLink);
    await this.mailerService.sendMail({
      to: email,
      subject: 'Validar tu direccion email',
      html: `<p>Por favor, verifica tu correo electrónico haciendo clic en el enlace a continuación.:</p>
               <a href="${verificationLink}">Valida Email</a>`,
    });
  }
}
