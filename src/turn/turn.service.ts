import { Injectable } from '@nestjs/common';
import { CreateTurnDto } from './dto/create-turn.dto';
import { UpdateTurnDto } from './dto/update-turn.dto';
import {InjectRepository} from "@nestjs/typeorm";
import {CourtReserve} from "../court-reserve/entities/court-reserve.entity";
import {Repository} from "typeorm";
import {Turn} from "./entities/turn.entity";

@Injectable()
export class TurnService {
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
    const turns = await this.turnRepository.find({where: {state: true}});
    console.log(turns);
    return turns.map(turn => turn.description);
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
