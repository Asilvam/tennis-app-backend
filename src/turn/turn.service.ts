import { Injectable, Logger } from '@nestjs/common';
import { CreateTurnDto } from './dto/create-turn.dto';
import { UpdateTurnDto } from './dto/update-turn.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Turn } from './entities/turn.entity';

@Injectable()
export class TurnService {
  logger = new Logger('TurnService');

  constructor(
    @InjectModel('Turn')
    private readonly turnModel: Model<Turn>,
  ) {}

  async create(createTurnDto: CreateTurnDto) {
    const newTurn = new this.turnModel(createTurnDto);
    return newTurn.save();
  }

  async findAll() {
    return this.turnModel.find({ state: true });
  }

  async findAllTurns() {
    const turns = await this.turnModel.find({ state: true }).sort({ turnNumber: 1 });
    return turns.map((turn) => ({
      time: turn.schedule,
      isPayed: turn.isPayed,
      available: turn.state,
    }));
  }

  findOne(id: number) {
    return `This action returns a #${id} turn`;
  }

  update(id: number, updateTurnDto: UpdateTurnDto) {
    return `This action updates a #${id} turn`;
  }

  remove(id: number) {
    return `This action removes a #${id} turn`;
  }
}
