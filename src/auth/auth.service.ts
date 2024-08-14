import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { RegisterService } from '../register/register.service';
import { JwtService } from '@nestjs/jwt';
import * as bcryptjs from 'bcryptjs';

@Injectable()
export class AuthService {
  logger = new Logger(AuthService.name);
  constructor(
    private readonly registerService: RegisterService,
    private readonly jwtService: JwtService,
  ) {}

  async login({ username, password }: LoginDto) {
    this.logger.log('Try login');
    const user = await this.registerService.validatePlayerEmail(username);
    if (!user) {
      throw new UnauthorizedException('email is wrong');
    }
    const isPasswordValid = await bcryptjs.compare(password, user.pwd);
    if (!isPasswordValid) {
      throw new UnauthorizedException('password is wrong');
    }
    const payload = { email: user.email, role: user.role };
    const token = await this.jwtService.signAsync(payload);
    return {
      token,
      username,
    };
  }

  async profile({ email, role }: { email: string; role: string }) {
    return this.registerService.findOneByEmail(email);
  }

  async refreshToken(refreshToken: string) {
    this.logger.log("Try refresh token");
    try {
      const payload = await this.jwtService.decode(refreshToken);
      const newAccessToken = await this.jwtService.signAsync({ email: payload.email, role: payload.role });

      return {
        token: newAccessToken,
        username: payload.email
      };
    } catch (err) {
      throw new UnauthorizedException("refresh token is wrong");
    }
  }
}
