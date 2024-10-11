import { Module } from '@nestjs/common';
import { TurnService } from './turn.service';
import { TurnController } from './turn.controller';
import { AuthService } from '../auth/auth.service';
import { JwtService } from '@nestjs/jwt';
import { RegisterService } from '../register/register.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Register, RegisterSchema } from '../register/entities/register.entity';
import { Turn, TurnSchema } from './entities/turn.entity';
import { EmailService } from '../email/email.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Turn.name, schema: TurnSchema },
      { name: Register.name, schema: RegisterSchema },
    ]),
  ],
  controllers: [TurnController],
  providers: [TurnService, AuthService, JwtService, RegisterService, EmailService],
})
export class TurnModule {}
