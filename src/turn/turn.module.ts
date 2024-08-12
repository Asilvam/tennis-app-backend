import { Module } from '@nestjs/common';
import { TurnService } from './turn.service';
import { TurnController } from './turn.controller';

@Module({
  controllers: [TurnController],
  providers: [TurnService],
})
export class TurnModule {}
