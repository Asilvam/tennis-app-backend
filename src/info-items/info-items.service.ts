import { Injectable, Logger } from '@nestjs/common';
import { CreateInfoItemDto } from './dto/create-info-item.dto';
import { UpdateInfoItemDto } from './dto/update-info-item.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InfoItem } from './entities/info-item.entity';

@Injectable()
export class InfoItemsService {
  logger = new Logger('InfoItemsService');

  constructor(
    @InjectModel('InfoItem')
    private readonly itemModel: Model<InfoItem>,
  ) {}

  async create(createInfoItemDto: CreateInfoItemDto) {
    const newItem = new this.itemModel(createInfoItemDto);
    const response = await newItem.save();
    return response;
  }

  async findAll() {
    return await this.itemModel.find({ state: true }).select('title content imageUrl state').exec();
  }

  findOne(id: number) {
    return `This action returns a #${id} infoItem`;
  }

  update(id: number, updateInfoItemDto: UpdateInfoItemDto) {
    return `This action updates a #${id} infoItem`;
  }

  remove(id: number) {
    return `This action removes a #${id} infoItem`;
  }
}
