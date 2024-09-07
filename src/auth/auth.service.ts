import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { RegisterService } from '../register/register.service';
import { JwtService } from '@nestjs/jwt';
import * as bcryptjs from 'bcryptjs';
import { RefreshToken } from './entities/refresh-token.entity';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';

@Injectable()
export class AuthService {
  logger = new Logger(AuthService.name);
  constructor(
    private readonly registerService: RegisterService,
    private readonly jwtService: JwtService,
    @InjectModel(RefreshToken.name) private refreshTokenModel: Model<RefreshToken>,
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

  async generateRefreshToken2DB(refreshToken: string, username: string): Promise<void> {
    const expireTime = process.env.REFRESH_TOKEN_EXPIRE_TIME; // "30d"
    const numbersOnly = parseInt(expireTime.replace(/\D/g, ''), 10);
    try {
      await this.refreshTokenModel.deleteMany({ username });
      await this.refreshTokenModel.create({
        token: refreshToken,
        username,
        expiresAt: new Date(Date.now() + numbersOnly * 24 * 60 * 60 * 1000),
      });
      this.logger.log('Refresh Token to DB');
    } catch (err) {
      throw new UnauthorizedException('refresh token 2 DB is wrong');
    }
  }

  async takeRefreshTokenFromDB(username: string) {
    try {
      const refreshToken = await this.refreshTokenModel.findOne({ username }).select('token');
      return refreshToken ? refreshToken.token : null;
    } catch (err) {
      throw new UnauthorizedException('refresh token from DB is wrong');
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
