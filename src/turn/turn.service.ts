import { Injectable, Logger } from '@nestjs/common';
import { UpdateTurnDto } from './dto/update-turn.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Turn } from './entities/turn.entity';

@Injectable()
export class TurnService {
  logger = new Logger(TurnService.name);
  constructor(
    @InjectRepository(Turn)
    private turnRepository: Repository<Turn>,
  ) {}

  async create(createTurnDto: any) {
    return await this.turnRepository.save(createTurnDto);
  }

  async findAll() {
    return await this.turnRepository.find();
  }

  async findAllTurns() {
    const turns = await this.turnRepository.find({ where: { state: true } });
    // this.logger.log(turns.map((turn) => turn.description));
    return turns.map((turn) => turn.description);
  }

  findOne(id: number) {
    return `This action returns a #${id} turn`;
  }

  update(id: number, updateTurnDto: UpdateTurnDto) {
    this.logger.log(updateTurnDto);
    return `This action updates a #${id} turn`;
  }

  remove(id: number) {
    return `This action removes a #${id} turn`;
  }
}
