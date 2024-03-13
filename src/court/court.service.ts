import { Injectable } from '@nestjs/common';
import { CreateCourtDto } from './dto/create-court.dto';
import { UpdateCourtDto } from './dto/update-court.dto';
import {InjectRepository} from "@nestjs/typeorm";
import {Repository} from "typeorm";
import {Court} from "./entities/court.entity";

@Injectable()
export class CourtService {
  constructor(
      @InjectRepository(Court)
      private courtRepository: Repository<Court>,
  ) {}

  async create(createCourtDto: any) {
    return await this.courtRepository.save(createCourtDto);
  }

  async findAllCourts() {
    const courts = await this.courtRepository.find({where: {state: true}});
    console.log(courts);
    return courts.map(court => court.description);
  }

  async findAll() {
    return await this.courtRepository.find();
  }

  findOne(id: number) {
    return `This action returns a #${id} court`;
  }

  update(id: number, updateCourtDto: UpdateCourtDto) {
    return `This action updates a #${id} court`;
  }

  remove(id: number) {
    return `This action removes a #${id} court`;
  }
}
