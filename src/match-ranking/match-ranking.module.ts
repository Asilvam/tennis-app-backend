import { Module } from '@nestjs/common';
import { MatchRankingService } from './match-ranking.service';
import { MatchRankingController } from './match-ranking.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { MatchRanking, MatchResultSchema } from './entities/match-ranking.entity';
import { CourtReserveModule } from '../court-reserve/court-reserve.module';
import { RegisterModule } from '../register/register.module';
import { CourtReserve, CourtReserveSchema } from '../court-reserve/entities/court-reserve.entity';
import { Register, RegisterSchema } from '../register/entities/register.entity';
// import { EmailModule } from '../email/email.module';
import { EmailService } from '../email/email.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MatchRanking.name, schema: MatchResultSchema },
      { name: CourtReserve.name, schema: CourtReserveSchema },
      { name: Register.name, schema: RegisterSchema },
    ]),
    CourtReserveModule,
    RegisterModule,
    // EmailModule,
  ],
  providers: [MatchRankingService, EmailService],
  controllers: [MatchRankingController],
})
export class MatchRankingModule {}
