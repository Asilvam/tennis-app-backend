import { Injectable } from '@nestjs/common';
import { CreateCourtDto } from './dto/create-court.dto';
import { UpdateCourtDto } from './dto/update-court.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Court } from './entities/court.entity';
import { Model } from 'mongoose';

@Injectable()
export class CourtService {
  constructor(@InjectModel(Court.name) private readonly courtModel: Model<Court>) {}

  async create(createCourtDto: CreateCourtDto): Promise<Court> {
    const createdCourt = new this.courtModel(createCourtDto);
    return await createdCourt.save();
  }

  async findAllCourts(): Promise<string[]> {
    const courts = await this.courtModel.find({ state: true }).sort({ description: 'asc' }).exec();

    // this.logger.log(courts.map((court) => court.description)); // Uncomment if you have a logger
    return courts.map((court) => court.description);
  }

  findAll() {
    return `This action returns all court`;
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
