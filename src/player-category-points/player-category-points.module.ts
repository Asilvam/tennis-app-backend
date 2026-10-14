import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PlayerCategoryPoints, PlayerCategoryPointsSchema } from './entities/player-category-points.entity';
import { PlayerCategoryPointsService } from './player-category-points.service';
import { PlayerCategoryPointsController } from './player-category-points.controller';
import { Register, RegisterSchema } from '../register/entities/register.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PlayerCategoryPoints.name, schema: PlayerCategoryPointsSchema },
      { name: Register.name, schema: RegisterSchema },
    ]),
  ],
  controllers: [PlayerCategoryPointsController],
  providers: [PlayerCategoryPointsService],
  exports: [PlayerCategoryPointsService], // Exportar para que otros módulos puedan usarlo
})
export class PlayerCategoryPointsModule {}
