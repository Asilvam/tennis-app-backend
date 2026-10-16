import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Req,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { MatchRankingService } from './match-ranking.service';
import { CreateMatchRankingDto } from './dto/create-match-ranking.dto';
import { UpdateMatchRankingDto } from './dto/update-match-ranking.dto';
import { ValidateMatchDto } from './dto/validate-match.dto';
import { RankingPorCategoria, Resultado } from './interfaces/tennis.types';
import { MatchResultDocument } from './entities/match-ranking.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RankingActor } from '../court-reserve/ranking-match-policy.service';
import { AdminMatchHistoryDto } from './dto/admin-match-history.dto';

@Controller('match-ranking')
export class MatchRankingController {
  constructor(private readonly matchRankingService: MatchRankingService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  create(@Body() createMatchRankingDto: CreateMatchRankingDto, @Req() request: { user: RankingActor }) {
    return this.matchRankingService.create(createMatchRankingDto, request.user);
  }

  @Get('pending')
  @UseGuards(JwtAuthGuard)
  pending(@Req() request: { user: RankingActor }, @Query('playerEmail') playerEmail?: string) {
    return this.matchRankingService.getPendingMatches(request.user, playerEmail);
  }

  @Get('admin/history')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  adminHistory(@Req() request: { user: RankingActor }, @Query() query: AdminMatchHistoryDto) {
    return this.matchRankingService.getAdminMatchHistory(request.user, query);
  }

  @Post('validate-match')
  @UseGuards(JwtAuthGuard)
  validateMatch(@Body() validateMatchDto: ValidateMatchDto, @Req() request: { user: RankingActor }) {
    return this.matchRankingService.validateMatch(validateMatchDto, request.user);
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
  findAll(): Promise<MatchResultDocument[]> {
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
