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
  create(createAuthDto: CreateAuthDto) {
    return 'This action adds a new auth';
  }

  findAll() {
    return `This action returns all auth`;
  }

  findOne(id: number) {
    return `This action returns a #${id} auth`;
  }

  update(id: number, updateAuthDto: UpdateAuthDto) {
    return `This action updates a #${id} auth`;
  }

  remove(id: number) {
    return `This action removes a #${id} auth`;
  }

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
}
