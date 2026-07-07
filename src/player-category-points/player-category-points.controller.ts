import { Controller, Get, Post, Put, Body, Param, Patch, Delete, Logger } from '@nestjs/common';
import { PlayerCategoryPointsService } from './player-category-points.service';

@Controller('player-category-points')
export class PlayerCategoryPointsController {
  private readonly logger = new Logger(PlayerCategoryPointsController.name);

  constructor(private readonly playerCategoryPointsService: PlayerCategoryPointsService) {}

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
  async updatePoints(@Param('email') email: string, @Body() body: { categories: any[] }) {
    this.logger.log(`Updating points for player: ${email}`, body.categories);
    await this.playerCategoryPointsService.updatePlayerPoints(email, body.categories);
    return { message: 'Points updated successfully' };
  }

  @Post(':email/add-category')
  async addCategory(@Param('email') email: string, @Body() body: { category: string }) {
    this.logger.log(`Adding category for player: ${email}`, body);
    return this.playerCategoryPointsService.addCategoryToPlayer(email, body.category);
  }

  @Patch(':email/deactivate')
  async deactivateCategory(@Param('email') email: string, @Body() body: { category: string }) {
    this.logger.log(`Deactivating category for player: ${email}`, body);
    await this.playerCategoryPointsService.deactivateCategory(email, body.category);
    return { message: 'Category deactivated successfully' };
  }

  @Delete(':email/:category')
  async removeCategory(@Param('email') email: string, @Param('category') category: string) {
    this.logger.log(`Removing category ${category}  for player: ${email}`);
    await this.playerCategoryPointsService.removePlayerCategory(email, category);
    return { message: 'Category removed successfully' };
  }
}
