import { Controller, Get, Post, Put, Body, Param, Patch, Delete, Logger, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { PlayerCategoryPointsService } from './player-category-points.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CategoryNameDto, LegacyCategoryUpdatesDto, SaveCategoryAssignmentsDto } from './dto/category-editor.dto';

@Controller('player-category-points')
export class PlayerCategoryPointsController {
  private readonly logger = new Logger(PlayerCategoryPointsController.name);

  constructor(private readonly playerCategoryPointsService: PlayerCategoryPointsService) {}

  @Get(':email/editor')
  @UseGuards(JwtAuthGuard, AdminGuard)
  getEditor(@Param('email') email: string) {
    return this.playerCategoryPointsService.getEditor(email);
  }

  @Put(':email/assignments')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  saveAssignments(@Param('email') email: string, @Body() body: SaveCategoryAssignmentsDto) {
    return this.playerCategoryPointsService.saveAssignments(email, body);
  }

  @Get(':email')
  async getPlayerCategories(@Param('email') email: string) {
    this.logger.log(`Getting categories for player: ${email}`);
    return this.playerCategoryPointsService.getPlayerCategories(email);
  }

  @Get(':email/:category')
  async getPlayerPoints(@Param('email') email: string, @Param('category') category: string) {
    this.logger.log(`Getting points for player: ${email}, category: ${category}`);
    const points = await this.playerCategoryPointsService.getPoints(email, category);
    return { playerEmail: email, category, points };
  }

  @Put(':email/points')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async updatePoints(@Param('email') email: string, @Body() body: LegacyCategoryUpdatesDto) {
    this.logger.log(`Updating points for player: ${email}`, body.categories);
    await this.playerCategoryPointsService.updatePlayerPoints(email, body.categories);
    return { message: 'Points updated successfully' };
  }

  @Post(':email/add-category')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async addCategory(@Param('email') email: string, @Body() body: CategoryNameDto) {
    this.logger.log(`Adding category for player: ${email}`, body);
    return this.playerCategoryPointsService.addCategoryToPlayer(email, body.category);
  }

  @Patch(':email/deactivate')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async deactivateCategory(@Param('email') email: string, @Body() body: CategoryNameDto) {
    this.logger.log(`Deactivating category for player: ${email}`, body);
    await this.playerCategoryPointsService.deactivateCategory(email, body.category);
    return { message: 'Category deactivated successfully' };
  }

  @Delete(':email/:category')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async removeCategory(@Param('email') email: string, @Param('category') category: string) {
    this.logger.log(`Removing category ${category}  for player: ${email}`);
    await this.playerCategoryPointsService.removePlayerCategory(email, category);
    return { message: 'Category removed successfully' };
  }
}
