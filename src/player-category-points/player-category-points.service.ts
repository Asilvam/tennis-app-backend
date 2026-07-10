import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PlayerCategoryPoints, PlayerCategoryPointsDocument } from './entities/player-category-points.entity';
import { MAIN_SINGLES_CATEGORIES } from '../register/enums/category.enum';

@Injectable()
export class PlayerCategoryPointsService {
  private readonly logger = new Logger(PlayerCategoryPointsService.name);
  private readonly MAIN_SINGLES_CATEGORIES = MAIN_SINGLES_CATEGORIES;

  constructor(
    @InjectModel(PlayerCategoryPoints.name)
    private playerCategoryPointsModel: Model<PlayerCategoryPointsDocument>,
  ) {}

  // Crear o actualizar puntos de una categoría
  async upsertPoints(playerEmail: string, category: string, pointsChange: number): Promise<PlayerCategoryPointsDocument> {
    const existing = await this.playerCategoryPointsModel.findOne({
      playerEmail,
      category,
    });

    if (existing) {
      existing.points += pointsChange;
      // No permitir puntos negativos
      existing.points = Math.max(0, existing.points);
      return existing.save();
    }

    // Si no existe, crear con los puntos iniciales
    return this.playerCategoryPointsModel.create({
      playerEmail,
      category,
      points: Math.max(0, pointsChange), // No permitir puntos negativos al crear
      isActive: true,
    });
  }

  // Actualizar puntos de múltiples categorías de un jugador
  async updatePlayerPoints(playerEmail: string, categories: any[]): Promise<void> {
    this.logger.log(`Updating points for player ${playerEmail}`, categories);

    await this._validateMainSinglesCategoryRuleInBatchUpdate(playerEmail, categories);

    for (const cat of categories) {
      await this.playerCategoryPointsModel.updateOne(
        {
          playerEmail,
          category: cat.category,
        },
        {
          $set: {
            points: cat.points,
            isActive: cat.isActive !== undefined ? cat.isActive : true,
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      );
    }
  }

  // Obtener puntos de un jugador en una categoría específica
  async getPoints(playerEmail: string, category: string): Promise<number> {
    const record = await this.playerCategoryPointsModel.findOne({
      playerEmail,
      category,
      isActive: true,
    });
    return record ? record.points : 0;
  }

  // Obtener todas las categorías de un jugador
  async getPlayerCategories(playerEmail: string): Promise<PlayerCategoryPointsDocument[]> {
    return this.playerCategoryPointsModel
      .find({
        playerEmail,
        // isActive: true, // Comentado para traer todas y poder editarlas en el front
      })
      .sort({ category: 1 });
  }

  // Inicializar categorías para un nuevo jugador
  async initializePlayerCategories(playerEmail: string, categories: { category: string }[]): Promise<void> {
    this._validateMainSinglesCategoryRuleInIncomingCategories(categories);

    const promises = [];

    for (const cat of categories) {
      promises.push(
        this.playerCategoryPointsModel.create({
          playerEmail,
          category: cat.category,
          points: 0,
          isActive: true,
        }),
      );
    }

    await Promise.all(promises);
    this.logger.log(`Initialized categories for player: ${playerEmail}`);
  }

  // Agregar una nueva categoría a un jugador existente
  async addCategoryToPlayer(playerEmail: string, category: string): Promise<PlayerCategoryPointsDocument> {
    await this._validateMainSinglesCategoryRuleForSingleAdd(playerEmail, category);

    const existing = await this.playerCategoryPointsModel.findOne({
      playerEmail,
      category,
    });

    if (existing) {
      existing.isActive = true;
      return existing.save();
    }

    return this.playerCategoryPointsModel.create({
      playerEmail,
      category,
      points: 0,
      isActive: true,
    });
  }

  // Desactivar una categoría (no eliminar, mantener historial)
  async deactivateCategory(playerEmail: string, category: string): Promise<void> {
    await this.playerCategoryPointsModel.updateOne({ playerEmail, category }, { isActive: false });
  }

  /**
   * ✅ PASO 3: Remover una categoría de un jugador
   */
  async removePlayerCategory(playerEmail: string, category: string): Promise<void> {
    const result = await this.playerCategoryPointsModel.deleteMany({
      playerEmail,
      category,
    });
    this.logger.log(`Removed category (${result.deletedCount} records) for ${category} and player ${playerEmail}`);
  }

  async getPlayerCategoryRecord(playerEmail: string, category: string): Promise<PlayerCategoryPointsDocument | null> {
    return this.playerCategoryPointsModel.findOne({
      playerEmail,
      category,
      isActive: true,
    });
  }

  private _validateMainSinglesCategoryRuleInIncomingCategories(categories: { category: string }[]): void {
    const mainSinglesCount = (categories || []).filter((item) => this.MAIN_SINGLES_CATEGORIES.includes(item.category)).length;

    if (mainSinglesCount > 1) {
      throw new BadRequestException('Un jugador solo puede tener una categoría principal activa entre 1, 2, 3 o 4.');
    }
  }

  private async _validateMainSinglesCategoryRuleForSingleAdd(playerEmail: string, category: string): Promise<void> {
    if (!this.MAIN_SINGLES_CATEGORIES.includes(category)) {
      return;
    }

    const activeMainCategory = await this.playerCategoryPointsModel.findOne({
      playerEmail,
      category: { $in: this.MAIN_SINGLES_CATEGORIES },
      isActive: true,
    });

    if (activeMainCategory && activeMainCategory.category !== category) {
      throw new BadRequestException(
        `El jugador ya tiene categoría principal activa (${activeMainCategory.category}). Debe desactivarla antes de activar ${category}.`,
      );
    }
  }

  private async _validateMainSinglesCategoryRuleInBatchUpdate(playerEmail: string, categories: any[]): Promise<void> {
    const currentCategories = await this.playerCategoryPointsModel.find({ playerEmail }).lean();
    const projectedState = new Map<string, { category: string; isActive: boolean }>();

    for (const current of currentCategories) {
      projectedState.set(current.category, {
        category: current.category,
        isActive: current.isActive,
      });
    }

    for (const incoming of categories || []) {
      projectedState.set(incoming.category, {
        category: incoming.category,
        isActive: incoming.isActive !== undefined ? incoming.isActive : true,
      });
    }

    const activeMainCount = Array.from(projectedState.values()).filter(
      (item) => this.MAIN_SINGLES_CATEGORIES.includes(item.category) && item.isActive,
    ).length;

    if (activeMainCount > 1) {
      throw new BadRequestException('Un jugador solo puede tener una categoría principal activa entre 1, 2, 3 o 4.');
    }
  }
}
