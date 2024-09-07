import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { RegisterService } from '../register/register.service';
import { JwtService } from '@nestjs/jwt';
import * as bcryptjs from 'bcryptjs';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';

@Injectable()
export class AuthService {
  logger = new Logger(AuthService.name);
  constructor(
    private readonly registerService: RegisterService,
    private readonly jwtService: JwtService,
  ) {}

  async login({ username, password }: LoginDto) {
    const user = await this.registerService.validatePlayerEmail(username);
    if (!user) {
      throw new UnauthorizedException('email is wrong');
    }
    const isPasswordValid = await bcryptjs.compare(password, user.pwd);
    if (!isPasswordValid) {
      throw new UnauthorizedException('password is wrong');
    }
    const payload = {
      email: user.email,
      role: user.role,
    };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: process.env.SECRET_KEY,
      expiresIn: process.env.TOKEN_EXPIRE_TIME,
    });
    return {
      accessToken,
      username,
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
        { secret: process.env.SECRET_KEY, expiresIn: process.env.TOKEN_EXPIRE_TIME },
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
        secret: process.env.SECRET_KEY,
      });
      return payload;
    } catch (err) {
      throw new UnauthorizedException('Token is wrong');
    }
  }
}
