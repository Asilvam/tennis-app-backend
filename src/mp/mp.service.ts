import { Injectable, Logger } from '@nestjs/common';
import { CreateMpDto } from './dto/create-mp.dto';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class MpService {
  private readonly logger = new Logger(MpService.name);
  constructor(private readonly configService: ConfigService) {}

  async create(createMpDto: CreateMpDto) {
    const mpApiUrl = this.configService.get<string>('MP_API_URL');
    const initPoint = await axios.post(`${mpApiUrl}/create-preference`, createMpDto);
    this.logger.log(initPoint.data);
    return initPoint.data;
  }
}
