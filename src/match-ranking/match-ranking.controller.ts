import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { MatchRankingService } from './match-ranking.service';
import { CreateMatchRankingDto } from './dto/create-match-ranking.dto';
import { UpdateMatchRankingDto } from './dto/update-match-ranking.dto';

@Controller('match-ranking')
export class MatchRankingController {
  constructor(private readonly matchRankingService: MatchRankingService) {}

  @Post()
  create(@Body() createMatchRankingDto: CreateMatchRankingDto) {
    return this.matchRankingService.create(createMatchRankingDto);
  }

  @Get()
  findAll() {
    return this.matchRankingService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.matchRankingService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateMatchRankingDto: UpdateMatchRankingDto) {
    return this.matchRankingService.update(+id, updateMatchRankingDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.matchRankingService.remove(+id);
  }
}
