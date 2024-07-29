import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CourtReserveController } from './court-reserve.controller';
import { CourtReserveService } from './court-reserve.service';
import { CourtReserve } from './entities/court-reserve.entity';
import { RegisterService } from '../register/register.service';
import { Register } from '../register/entities/register';
import { EmailService } from '../email/email.service';

@Module({
  imports: [TypeOrmModule.forFeature([CourtReserve, Register])],
  controllers: [CourtReserveController],
  providers: [CourtReserveService, RegisterService, EmailService],
})
export class CourtReserveModule {}
