import { Injectable, Logger } from '@nestjs/common';
import { CreateCourtDto } from './dto/create-court.dto';
import { UpdateCourtDto } from './dto/update-court.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Court } from './entities/court.entity';
import { Model } from 'mongoose';

@Injectable()
export class CourtService {
  logger = new Logger('CourtService');
  constructor(@InjectModel(Court.name) private readonly courtModel: Model<Court>) {}

  async create(createCourtDto: CreateCourtDto): Promise<Court> {
    const createdCourt = new this.courtModel(createCourtDto);
    return await createdCourt.save();
  }

  async findAllCourts(): Promise<string[]> {
    const courts = await this.courtModel.find({ state: true }).sort({ description: 'asc' }).exec();
    return courts.map((court) => court.courtName);
  }

  findAll() {
    return `This action returns all court`;
  }

  findOne(id: number) {
    return `This action returns entro aca a #${id} court`;
  }

  update(id: number, updateCourtDto: UpdateCourtDto) {
    return `This action updates a #${id} court`;
  }

  remove(id: number) {
    return `This action removes a #${id} court`;
  }
}
