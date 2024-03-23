import { Module } from '@nestjs/common';
import { TurnService } from './turn.service';
import { TurnController } from './turn.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Turn } from './entities/turn.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Turn])],
  controllers: [TurnController],
  providers: [TurnService],
})
export class TurnModule {}
