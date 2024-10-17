import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { RegisterService } from '../register/register.service';
import { JwtService } from '@nestjs/jwt';
import * as bcryptjs from 'bcryptjs';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  logger = new Logger(AuthService.name);
  secretKey = this.configService.get('SECRET_KEY');
  expiresIn = this.configService.get('TOKEN_EXPIRE_TIME');

  constructor(
    private readonly registerService: RegisterService,
    private readonly jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async login({ username, password }: LoginDto) {
    const user = await this.registerService.validatePlayerEmail(username);
    const { namePlayer, role } = user;
    if (!user) {
      throw new UnauthorizedException('email is wrong');
    }
    const isPasswordValid = await bcryptjs.compare(password, user.pwd);
    if (!isPasswordValid) {
      throw new UnauthorizedException('password is wrong');
    }

    if (!user.statePlayer) {
      throw new UnauthorizedException('user blocked');
    }

    if (!user.updatePayment) {
      throw new UnauthorizedException('user blocked for no payment');
    }

    const payload = {
      email: user.email,
      role: user.role,
    };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.secretKey,
      expiresIn: this.expiresIn,
    });
    return {
      accessToken,
      username,
      namePlayer,
      role,
    };
  }

  async profile({ email }: { email: string }) {
    return this.registerService.findOneByEmail(email);
  }

  async refreshToken(refreshToken: string) {
    this.logger.log('Try refresh token');
    try {
      const payload = await this.jwtService.decode(refreshToken);
      const newAccessToken = await this.jwtService.signAsync(
        { email: payload.email, role: payload.role },
        { secret: this.secretKey, expiresIn: this.expiresIn },
      );
      return {
        token: newAccessToken,
        username: payload.email,
      };
    } catch (err) {
      throw new UnauthorizedException('refresh token is wrong');
    }
  }

  async validateToken({ token }): Promise<any> {
    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.secretKey,
      });
      return payload;
    } catch (err) {
      throw new UnauthorizedException('Token is wrong');
    }
  }

  async verifyEmailToken(token: string) {
    const user = await this.registerService.findByVerificationToken(token);
    if (!user) {
      return null;
    }
    user.emailVerified = true;
    user.verificationToken = null;
    await user.save();
    return user;
  }
}
