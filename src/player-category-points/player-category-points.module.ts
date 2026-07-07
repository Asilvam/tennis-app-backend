import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PlayerCategoryPoints, PlayerCategoryPointsSchema } from './entities/player-category-points.entity';
import { PlayerCategoryPointsService } from './player-category-points.service';
import { PlayerCategoryPointsController } from './player-category-points.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: PlayerCategoryPoints.name, schema: PlayerCategoryPointsSchema }])],
  controllers: [PlayerCategoryPointsController],
  providers: [PlayerCategoryPointsService],
  exports: [PlayerCategoryPointsService], // Exportar para que otros módulos puedan usarlo
})
export class PlayerCategoryPointsModule {}
