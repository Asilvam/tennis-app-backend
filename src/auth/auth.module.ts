import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Register } from '../register/entities/register';
import { JwtService } from '../jwt/jwt.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, JwtService],
  imports: [TypeOrmModule.forFeature([Register])],
})
export class AuthModule {}
