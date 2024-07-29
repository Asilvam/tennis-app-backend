import { Module } from '@nestjs/common';
import { RegisterService } from './register.service';
import { RegisterController } from './register.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Register } from './entities/register';
import { EmailService } from '../email/email.service';

@Module({
  controllers: [RegisterController],
  providers: [RegisterService, EmailService],
  imports: [TypeOrmModule.forFeature([Register])],
})
export class RegisterModule {}
