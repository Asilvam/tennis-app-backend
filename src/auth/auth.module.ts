import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import {TypeOrmModule} from "@nestjs/typeorm";
import {RegisterEntity} from "../register/entities/register.entity";
import {JwtService} from "../jwt/jwt.service";

@Module({
  controllers: [AuthController],
  providers: [AuthService, JwtService],
  imports: [TypeOrmModule.forFeature([RegisterEntity])],
})
export class AuthModule {}
