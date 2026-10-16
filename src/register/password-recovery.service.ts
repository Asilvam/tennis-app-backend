import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Model } from 'mongoose';
import { Register } from './entities/register.entity';
import { ConfirmPasswordResetDto } from './dto/confirm-password-reset.dto';
import { EmailService } from '../email/email.service';

export const PASSWORD_RESET_TTL_MS = 24 * 60 * 60_000;
export const PASSWORD_RESET_ADMIN_TTL_MS = PASSWORD_RESET_TTL_MS;
export const PASSWORD_RESET_COOLDOWN_MS = 24 * 60 * 60_000;
export const PASSWORD_RESET_REQUEST_MESSAGE = 'Si el correo pertenece a una cuenta activa y no solicitaste recuperación en las últimas 24 horas, recibirás un enlace para restablecer tu contraseña. Revisa también tu carpeta de spam.';
export const PASSWORD_RESET_ADMIN_MESSAGE = 'Si el correo pertenece a una cuenta activa, recibirá un enlace de un solo uso que vence en 24 horas. Revisa también la carpeta de spam.';
const INVALID_LINK = 'El enlace no es válido o ha vencido. Solicita uno nuevo.';

@Injectable()
export class PasswordRecoveryService {
  private readonly logger = new Logger(PasswordRecoveryService.name);

  constructor(
    @InjectModel('Register') private readonly registerModel: Model<Register>,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  private resetUrl(): URL {
    try {
      const url = new URL(this.configService.get<string>('PASSWORD_RESET_FRONTEND_URL'));
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.hash || url.search) throw new Error('Invalid reset URL');
      return url;
    } catch {
      throw new ServiceUnavailableException('La recuperación de contraseña no está configurada.');
    }
  }

  async requestReset(email: string, initiatedByAdmin = false): Promise<{ success: boolean; message: string }> {
    const started = Date.now();
    const url = this.resetUrl();
    const now = new Date();
    const ttl = initiatedByAdmin ? PASSWORD_RESET_ADMIN_TTL_MS : PASSWORD_RESET_TTL_MS;
    const validity = '24 horas';
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    let user: Register;
    try {
      // Active accounts only. The server-authorized admin route can bypass the
      // rolling 24-hour limit; public request bodies cannot choose this option.
      user = await this.registerModel.findOneAndUpdate({
        email: email.trim().toLowerCase(),
        statePlayer: true,
        ...(initiatedByAdmin ? {} : { $or: [
          { passwordResetRequestedAt: { $lte: new Date(now.getTime() - PASSWORD_RESET_COOLDOWN_MS) } },
          { passwordResetRequestedAt: { $exists: false } },
        ] }),
      }, { $set: {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: new Date(now.getTime() + ttl),
        passwordResetRequestedAt: now,
      } }, { new: true, runValidators: true }).select('_id email').exec();
    } catch {
      this.logger.error('No se pudo persistir la solicitud de recuperación.');
      throw new ServiceUnavailableException('No se pudo procesar la solicitud. Intenta nuevamente más tarde.');
    }
    if (user) {
      url.hash = new URLSearchParams({ token }).toString();
      // Do not put mail delivery latency on the public response path, or reveal
      // account existence through transport errors. No token/password is logged.
      void this.deliverResetLink(user.email, tokenHash, url.toString(), validity);
    }
    const remaining = 250 - (Date.now() - started);
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    return { success: true, message: initiatedByAdmin ? PASSWORD_RESET_ADMIN_MESSAGE : PASSWORD_RESET_REQUEST_MESSAGE };
  }

  private async deliverResetLink(email: string, tokenHash: string, link: string, validity: '15 minutos' | '24 horas'): Promise<void> {
    try {
      await this.emailService.sendResetPasswordEmail(email, link, validity);
    } catch {
      this.logger.error('No se pudo entregar el enlace de recuperación. La contraseña no cambió.');
      try {
        // A failed older send must never delete a newer token.
        await this.registerModel.updateOne({ email, passwordResetTokenHash: tokenHash }, { $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 } }).exec();
      } catch {
        this.logger.error('No se pudo invalidar el enlace de recuperación no entregado.');
      }
    }
  }

  async confirmReset(dto: ConfirmPasswordResetDto): Promise<{ success: boolean; message: string }> {
    if (!/^[a-f0-9]{64}$/.test(dto.token)) throw new BadRequestException(INVALID_LINK);
    if (typeof dto.password !== 'string' || dto.password.length < 6 || Buffer.byteLength(dto.password, 'utf8') > 72 || dto.password !== dto.passwordConfirmation) {
      throw new BadRequestException('Las contraseñas deben coincidir y tener al menos 6 caracteres y un máximo de 72 bytes.');
    }
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    const candidate = await this.registerModel.findOne({ passwordResetTokenHash: tokenHash, passwordResetExpiresAt: { $gt: new Date() } }).select('_id').exec();
    if (!candidate) throw new BadRequestException(INVALID_LINK);
    const pwd = await bcrypt.hash(dto.password, 10);
    // Recheck expiry after hashing and atomically change the password AND consume
    // the token. Two concurrent confirmations cannot both succeed.
    const updated = await this.registerModel.findOneAndUpdate({
      _id: candidate._id, passwordResetTokenHash: tokenHash, passwordResetExpiresAt: { $gt: new Date() },
    }, {
      $set: { pwd },
      $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 },
    }, { new: true, runValidators: true }).select('_id email').exec();
    if (!updated) throw new BadRequestException(INVALID_LINK);
    void this.emailService.sendPasswordChangedEmail(updated.email).catch(() => this.logger.error('No se pudo entregar la notificación de cambio de contraseña.'));
    return { success: true, message: 'Contraseña actualizada. Inicia sesión con tu nueva contraseña.' };
  }
}
