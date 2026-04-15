import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { MatchRankingService } from './match-ranking.service';
import { CreateMatchRankingDto } from './dto/create-match-ranking.dto';
import { UpdateMatchRankingDto } from './dto/update-match-ranking.dto';
import { ValidateMatchDto } from './dto/validate-match.dto';
import { RankingPorCategoria, Resultado } from './interfaces/tennis.types';

@Controller('match-ranking')
export class MatchRankingController {
  constructor(private readonly matchRankingService: MatchRankingService) {}

  @Post()
  create(@Body() createMatchRankingDto: CreateMatchRankingDto) {
    return this.matchRankingService.create(createMatchRankingDto);
  }

  @Post('validate-match')
  validateMatch(@Body() validateMatchDto: ValidateMatchDto) {
    return this.matchRankingService.validateMatch(validateMatchDto);
  }

  // --- NUEVOS ENDPOINTS PARA EL RANKING Y RESULTADOS ---
  @Get('ranking')
  getRanking(): Promise<RankingPorCategoria> {
    // La llamada al servicio ahora es más simple, sin argumentos.
    return this.matchRankingService.getRanking();
  }

  @Get('history/:email')
  async getPlayerResults(@Param('email') email: string): Promise<Resultado[]> {
    return this.matchRankingService.getPlayerResults(email);
  }

  @Get()
  findAll() {
    return this.matchRankingService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.matchRankingService.findOne(id);
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
