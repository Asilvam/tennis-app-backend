import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { RegisterService } from '../register/register.service';
import { JwtService } from '@nestjs/jwt';
import * as bcryptjs from 'bcryptjs';
import { BillingPortalService } from '../membership-billing/billing-portal.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly registerService: RegisterService,
    private readonly jwtService: JwtService,
    @Optional() private readonly billingPortal?: BillingPortalService,
  ) {}

  async login({ username, password }: LoginDto) {
    const user = await this.registerService.validatePlayerEmail(username);
    if (!user) {
      throw new UnauthorizedException('email is wrong');
    }
    const { namePlayer, role } = user;
    const isPasswordValid = await bcryptjs.compare(password, user.pwd);
    if (!isPasswordValid) {
      throw new UnauthorizedException('password is wrong');
    }

    if (!user.statePlayer) {
      throw new UnauthorizedException('user blocked');
    }

    const payload = {
      email: user.email,
      role: user.role,
    };
    const accessToken = await this.jwtService.signAsync(payload);
    let membershipAccess: {
      financiallyRestricted: boolean;
      canReserve?: boolean;
      reason?: string | null;
    };
    if (this.billingPortal) {
      try {
        membershipAccess = await this.billingPortal.permissions(user.email);
      } catch (error) {
        if (error instanceof ForbiddenException || error instanceof UnauthorizedException)
          throw error;
        this.logger.warn(
          'No se pudieron verificar permisos de reserva al iniciar sesion; reservas restringidas.',
        );
        membershipAccess = {
          financiallyRestricted: true,
          canReserve: false,
          reason: 'BILLING_UNAVAILABLE',
        };
      }
    }
    return {
      accessToken,
      username,
      namePlayer,
      role,
      ...(membershipAccess
        ? {
            financiallyRestricted: membershipAccess.financiallyRestricted,
            canReserve: membershipAccess.canReserve,
            reservationBlockReason: membershipAccess.reason,
          }
        : {}),
    };
  }

  async profile({ email }: { email: string }) {
    return this.registerService.findOneByEmail(email);
  }

  async validateToken({ token }): Promise<any> {
    try {
      const payload = await this.jwtService.verifyAsync(token);
      return payload;
    } catch (err) {
      throw new UnauthorizedException('Token is wrong');
    }
  }

  async verifyEmailToken(token: string): Promise<{ message: string }> {
    if (!token) {
      throw new BadRequestException('Verification token is missing.');
    }
    const user = await this.registerService.findByVerificationToken(token);
    if (!user) {
      throw new NotFoundException(
        'Invalid or expired verification token. Please request a new one.',
      );
    }
    if (user.emailVerified) {
      throw new ConflictException('This email address has already been verified.');
    }
    user.statePlayer = true;
    user.emailVerified = true;
    user.verificationToken = null; // Invalidate the token after use
    await user.save();
    this.logger.log(`Email successfully verified for user: ${user.email}`);
    return { message: 'Your email has been successfully verified.' };
  }

  async checkIfUserIsBlocked(email: string): Promise<boolean> {
    try {
      const user = await this.registerService.validatePlayerEmail(email);

      if (!user) {
        // Si el usuario no existe, considerarlo como "bloqueado"
        return true;
      }

      // Payment restrictions affect booking, never login identity.
      const isBlocked = !user.statePlayer;

      this.logger.log(`User ${email} blocked status: ${isBlocked}`);
      return isBlocked;
    } catch (error) {
      this.logger.error(`Error checking if user is blocked: ${error.message}`);
      // Si hay un error al buscar el usuario, considerarlo bloqueado por seguridad
      return true;
    }
  }
}
