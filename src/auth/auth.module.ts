import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { RegisterModule } from '../register/register.module';
import { JwtService } from '@nestjs/jwt';

@Module({
  imports: [RegisterModule,],
  controllers: [AuthController],
  providers: [AuthService, JwtService],
})
export class AuthModule {}
