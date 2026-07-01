import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MonthPayCtqService } from './month-pay-ctq.service';
import { MonthPayCtqController } from './month-pay-ctq.controller';
import { MonthPayCtq, MonthPayCtqSchema } from './entities/monthpayctq.entity';
import { RegisterModule } from '../register/register.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: MonthPayCtq.name, schema: MonthPayCtqSchema }]),
    RegisterModule,
    EmailModule,
  ],
  controllers: [MonthPayCtqController],
  providers: [MonthPayCtqService],
  exports: [MonthPayCtqService],
})
export class MonthPayCtqModule {}
