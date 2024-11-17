import { Injectable, Logger } from '@nestjs/common';
import { CreateMatchRankingDto } from './dto/create-match-ranking.dto';
import { UpdateMatchRankingDto } from './dto/update-match-ranking.dto';
import { ValidateMatchDto } from './dto/validate-match.dto';
import { InjectModel } from '@nestjs/mongoose';
import { MatchRanking } from './entities/match-ranking.entity';
import { Model } from 'mongoose';
import { CourtReserveService } from '../court-reserve/court-reserve.service';
import { RegisterService } from '../register/register.service';

@Injectable()
export class MatchRankingService {
  logger = new Logger('MatchRankingService');

  constructor(
    @InjectModel(MatchRanking.name)
    private readonly matchRankingModel: Model<MatchRanking>,
    private readonly courtReserveService: CourtReserveService,
    private readonly registerService: RegisterService,
  ) {}

  create(createMatchRankingDto: CreateMatchRankingDto) {
    return 'This action adds a new matchRanking';
  }

  async validateMatch(validateMatchDto: ValidateMatchDto) {
    // this.logger.log({ validateMatchDto });
    const response = await this.courtReserveService.validateIdReserve(validateMatchDto);
    this.logger.log({ response });
    return response;
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
