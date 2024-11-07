import { Injectable } from '@nestjs/common';
import { CreateMatchRankingDto } from './dto/create-match-ranking.dto';
import { UpdateMatchRankingDto } from './dto/update-match-ranking.dto';

@Injectable()
export class MatchRankingService {
  create(createMatchRankingDto: CreateMatchRankingDto) {
    return 'This action adds a new matchRanking';
  }

  findAll() {
    return `This action returns all matchRanking`;
  }

  findOne(id: number) {
    return `This action returns a #${id} matchRanking`;
  }

  update(id: number, updateMatchRankingDto: UpdateMatchRankingDto) {
    return `This action updates a #${id} matchRanking`;
  }

  remove(id: number) {
    return `This action removes a #${id} matchRanking`;
  }
}
