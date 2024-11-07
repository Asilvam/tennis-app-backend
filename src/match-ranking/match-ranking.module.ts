import { Module } from '@nestjs/common';
import { MatchRankingService } from './match-ranking.service';
import { MatchRankingController } from './match-ranking.controller';

@Module({
  controllers: [MatchRankingController],
  providers: [MatchRankingService],
})
export class MatchRankingModule {}
