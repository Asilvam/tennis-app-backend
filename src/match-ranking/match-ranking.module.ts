import { Module } from '@nestjs/common';
import { MatchRankingService } from './match-ranking.service';
import { MatchRankingController } from './match-ranking.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { MatchRanking, MatchResultSchema } from './entities/match-ranking.entity';
import { CourtReserveService } from '../court-reserve/court-reserve.service';
import { RegisterService } from '../register/register.service';
import { EmailService } from '../email/email.service';
import { CourtReserveModule } from '../court-reserve/court-reserve.module';
import { RegisterModule } from '../register/register.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: MatchRanking.name, schema: MatchResultSchema }]),
    CourtReserveModule,
    RegisterModule,
  ],
  providers: [MatchRankingService, CourtReserveService, RegisterService, EmailService],
  controllers: [MatchRankingController],
})
export class MatchRankingModule {}
