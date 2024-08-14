import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { CreateAuthDto } from './dto/create-auth.dto';
import { UpdateAuthDto } from './dto/update-auth.dto';
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
    // this.logger.log(email);
    const user = await this.registerService.validatePlayerEmail(username);
    if (!user) {
      throw new UnauthorizedException('email is wrong');
    }
    // this.logger.log({ user });
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
}
