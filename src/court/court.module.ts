import { Module } from '@nestjs/common';
import { CourtService } from './court.service';
import { CourtController } from './court.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { RegisterModule } from '../register/register.module';
import { Court, CourtSchema } from './entities/court.entity';

@Module({
  imports: [MongooseModule.forFeature([{ name: Court.name, schema: CourtSchema }]), RegisterModule],
  controllers: [CourtController],
  providers: [CourtService],
})
export class CourtModule {}
