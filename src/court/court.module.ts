import { Module } from '@nestjs/common';
import { CourtService } from './court.service';
import { CourtController } from './court.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Court, CourtSchema } from './entities/court.entity';

@Module({
  imports: [MongooseModule.forFeature([{ name: Court.name, schema: CourtSchema }])],
  controllers: [CourtController],
  providers: [CourtService],
})
export class CourtModule {}
