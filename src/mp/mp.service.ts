import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { CreateMpDto } from './dto/create-mp.dto';
import { UpdateMpDto } from './dto/update-mp.dto';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CourtReserve } from '../court-reserve/entities/court-reserve.entity';

@Injectable()
export class MpService {
  private readonly logger = new Logger(MpService.name);
  constructor(
    private readonly configService: ConfigService,
    @InjectModel(CourtReserve.name)
    private readonly courtReserveModel: Model<CourtReserve>,
  ) {}

  async create(createMpDto: CreateMpDto) {
    const mpApiUrl = this.configService.get<string>('MP_API_URL');
    const internalApiKey = this.configService.get<string>('INTERNAL_API_KEY');
    if (!mpApiUrl || !internalApiKey) {
      throw new ServiceUnavailableException('Mercado Pago integration is not configured');
    }

    const reserve = await this.courtReserveModel
      .findOne({ idCourtReserve: createMpDto.idCourtReserve })
      .select('idCourtReserve court dateToPlay turn player1 isPaidNight isVisit wasPaid')
      .lean()
      .exec();
    if (!reserve) {
      throw new NotFoundException(`Reserva ${createMpDto.idCourtReserve} no encontrada`);
    }
    if (reserve.wasPaid) {
      throw new BadRequestException(`Reserva ${createMpDto.idCourtReserve} ya fue pagada`);
    }

    const paymentPayload: CreateMpDto = {
      courtId: reserve.court,
      date: reserve.dateToPlay,
      time: reserve.turn,
      player1: reserve.player1,
      amount: this.calculateAmount(Boolean(reserve.isPaidNight), Boolean(reserve.isVisit)),
      idCourtReserve: reserve.idCourtReserve,
    };
    const initPoint = await axios.post(`${mpApiUrl}/create-preference`, paymentPayload, {
      headers: { 'x-api-key': internalApiKey },
      timeout: 10_000,
    });
    this.logger.log(`Mercado Pago preference created for reservation ${reserve.idCourtReserve}`);
    return initPoint.data;
  }

  private calculateAmount(isPaidNight: boolean, isVisit: boolean): number {
    if (!isPaidNight && !isVisit) {
      throw new BadRequestException('La reserva no requiere pago');
    }

    const configKey = isPaidNight && isVisit ? 'MP_NIGHT_VISIT_AMOUNT' : isPaidNight ? 'MP_NIGHT_AMOUNT' : 'MP_VISIT_AMOUNT';
    const defaultAmount = isPaidNight && isVisit ? 11_000 : isPaidNight ? 4_000 : 7_000;
    const amount = Number(this.configService.get<string>(configKey, String(defaultAmount)));
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new ServiceUnavailableException(`Invalid ${configKey} configuration`);
    }
    return amount;
  }

  findAll() {
    return `This action returns all mp`;
  }

  findOne(id: string) {
    return `This action returns a #${id} mp`;
  }

  update(id: number, updateMpDto: UpdateMpDto) {
    return `This action updates a #${id} mp`;
  }

  remove(id: number) {
    return `This action removes a #${id} mp`;
  }
}
