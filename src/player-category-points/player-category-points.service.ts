import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { createHash } from 'crypto';
import { PlayerCategoryPoints, PlayerCategoryPointsDocument } from './entities/player-category-points.entity';
import { Category, MAIN_SINGLES_CATEGORIES } from '../register/enums/category.enum';
import { Register } from '../register/entities/register.entity';
import { SaveCategoryAssignmentsDto } from './dto/category-editor.dto';

type CategoryRecord = Pick<PlayerCategoryPoints, 'category' | 'points' | 'isActive'>;
const EDIT_CONFLICT = 'Las categorías o puntos cambiaron mientras editabas. Recarga los datos antes de guardar.';

export function categoryRevision(rows: CategoryRecord[]): string {
  const state = rows.map((row) => [row.category, row.points, row.isActive === true]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

@Injectable()
export class PlayerCategoryPointsService {
  private readonly logger = new Logger(PlayerCategoryPointsService.name);
  private readonly MAIN_SINGLES_CATEGORIES = MAIN_SINGLES_CATEGORIES;

  constructor(
    @InjectModel(PlayerCategoryPoints.name)
    private playerCategoryPointsModel: Model<PlayerCategoryPointsDocument>,
    @InjectModel(Register.name) private readonly registerModel: Model<Register>,
  ) {}

  async getEditor(playerEmail: string) {
    const session = await this.registerModel.db.startSession();
    try {
      return await session.withTransaction(async () => {
        const player = await this.registerModel.findOne({ email: playerEmail }).select('namePlayer email statePlayer').session(session).lean().exec();
        if (!player) throw new NotFoundException('Socio no encontrado.');
        const categories = await this.playerCategoryPointsModel.find({ playerEmail }).session(session).lean().exec();
        return this.editorResult(player, categories);
      });
    } finally {
      await session.endSession();
    }
  }

  private editorResult(player: Pick<Register, 'namePlayer' | 'email' | 'statePlayer'>, rows: CategoryRecord[]) {
    return {
      player: { name: player.namePlayer, email: player.email, active: player.statePlayer },
      categories: rows.map((row) => ({ category: row.category, points: row.points, isActive: row.isActive === true })),
      revision: categoryRevision(rows),
    };
  }

  private async editCategories<T>(playerEmail: string, operation: (rows: CategoryRecord[], session: ClientSession) => Promise<T>, revision?: string) {
    const session = await this.registerModel.db.startSession();
    try {
      return await session.withTransaction(async () => {
        // All administrative category writers lock the same existing member document.
        const player = await this.registerModel
          .findOneAndUpdate({ email: playerEmail }, { $inc: { __v: 1 } }, { new: true, session })
          .select('namePlayer email statePlayer')
          .lean()
          .exec();
        if (!player) throw new NotFoundException('Socio no encontrado.');
        if (!player.statePlayer) throw new BadRequestException('Activa al socio antes de modificar sus categorías.');
        const rows = await this.playerCategoryPointsModel.find({ playerEmail }).session(session).lean().exec();
        if (revision && revision !== categoryRevision(rows)) throw new ConflictException(EDIT_CONFLICT);
        return operation(rows, session);
      });
    } finally {
      await session.endSession();
    }
  }

  async saveAssignments(playerEmail: string, dto: SaveCategoryAssignmentsDto) {
    this._validateMainSinglesCategoryRuleInIncomingCategories(dto.activeCategories.map((category) => ({ category })));
    return this.editCategories(
      playerEmail,
      async (rows, session) => {
        const active = new Set(dto.activeCategories);
        const adjustments = new Map(dto.pointAdjustments.map((row) => [row.category, row.points]));
        for (const category of adjustments.keys()) {
          if (!active.has(category) && !rows.some((row) => row.category === category)) {
            throw new BadRequestException('No se pueden ajustar puntos de una categoría no asignada.');
          }
        }
        for (const category of Object.values(Category)) {
          const existing = rows.find((row) => row.category === category);
          if (!existing && !active.has(category)) continue;
          const update = { isActive: active.has(category), ...(adjustments.has(category) ? { points: adjustments.get(category) } : {}) };
          await this.playerCategoryPointsModel
            .updateOne(
              { playerEmail, category },
              {
                $set: update,
                ...(!adjustments.has(category) ? { $setOnInsert: { points: 0 } } : {}),
              },
              { upsert: true, runValidators: true, session },
            )
            .exec();
        }
        const updated = await this.playerCategoryPointsModel.find({ playerEmail }).session(session).lean().exec();
        const player = await this.registerModel.findOne({ email: playerEmail }).select('namePlayer email statePlayer').session(session).lean().exec();
        return this.editorResult(player, updated);
      },
      dto.revision,
    );
  }

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

    await this.editCategories(playerEmail, async (currentCategories, session) => {
      this._validateMainSinglesCategoryRuleInBatchUpdate(currentCategories, categories);
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
          { upsert: true, setDefaultsOnInsert: true, runValidators: true, session },
        );
      }
    });
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
    return this.editCategories(playerEmail, async (rows, session) => {
      this._validateMainSinglesCategoryRuleInBatchUpdate(rows, [{ category, isActive: true }]);

      const existing = await this.playerCategoryPointsModel
        .findOne({
          playerEmail,
          category,
        })
        .session(session);

      if (existing) {
        existing.isActive = true;
        return existing.save({ session });
      }

      const [created] = await this.playerCategoryPointsModel.create(
        [
          {
            playerEmail,
            category,
            points: 0,
            isActive: true,
          },
        ],
        { session },
      );
      return created;
    });
  }

  // Desactivar una categoría (no eliminar, mantener historial)
  async deactivateCategory(playerEmail: string, category: string): Promise<void> {
    await this.editCategories(playerEmail, async (_, session) => {
      await this.playerCategoryPointsModel.updateOne({ playerEmail, category }, { isActive: false }, { session });
    });
  }

  /**
   * ✅ PASO 3: Remover una categoría de un jugador
   */
  async removePlayerCategory(playerEmail: string, category: string): Promise<void> {
    const result = await this.editCategories(playerEmail, async (_, session) =>
      this.playerCategoryPointsModel.deleteMany(
        {
          playerEmail,
          category,
        },
        { session },
      ),
    );
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

  private _validateMainSinglesCategoryRuleInBatchUpdate(currentCategories: CategoryRecord[], categories: { category: string; isActive?: boolean }[]): void {
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

    const activeMainCount = Array.from(projectedState.values()).filter((item) => this.MAIN_SINGLES_CATEGORIES.includes(item.category) && item.isActive).length;

    if (activeMainCount > 1) {
      throw new BadRequestException('Un jugador solo puede tener una categoría principal activa entre 1, 2, 3 o 4.');
    }
  }
}
