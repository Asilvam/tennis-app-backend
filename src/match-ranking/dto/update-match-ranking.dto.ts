import { PartialType } from '@nestjs/swagger';
import { CreateMatchRankingDto } from './create-match-ranking.dto';

export class UpdateMatchRankingDto extends PartialType(CreateMatchRankingDto) {}
