import { Module } from '@nestjs/common';
import { TurnService } from './turn.service';
import { TurnController } from './turn.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Turn, TurnSchema } from './entities/turn.entity';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Turn.name, schema: TurnSchema }]),
  ],
  controllers: [TurnController],
  providers: [TurnService],
})
export class TurnModule {}
