import { BadRequestException, GatewayTimeoutException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { CreateMpDto } from './dto/create-mp.dto';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CourtReserve } from '../court-reserve/entities/court-reserve.entity';
import { ReservationSlotService } from '../court-reserve/reservation-slot.service';

const DEFAULT_PAYMENT_AMOUNTS = {
  MP_NIGHT_AMOUNT: 4_000,
  MP_VISIT_AMOUNT: 7_000,
  MP_NIGHT_VISIT_AMOUNT: 11_000,
};

@Injectable()
export class MpService {
  private readonly logger = new Logger(MpService.name);
  constructor(
    private readonly configService: ConfigService,
    @InjectModel(CourtReserve.name)
    private readonly courtReserveModel: Model<CourtReserve>,
    private readonly reservationSlots: ReservationSlotService,
  ) {}

  getRates() {
    return {
      currency: 'CLP' as const,
      nightAmount: this.configuredAmount('MP_NIGHT_AMOUNT'),
      visitAmount: this.configuredAmount('MP_VISIT_AMOUNT'),
      nightVisitAmount: this.configuredAmount('MP_NIGHT_VISIT_AMOUNT'),
    };
  }

  async create(createMpDto: CreateMpDto, ownerEmail?: string) {
    const mpApiUrl = this.configService.get<string>('MP_API_URL');
    const internalApiKey = this.configService.get<string>('INTERNAL_API_KEY');
    if (!mpApiUrl || !internalApiKey) {
      throw new ServiceUnavailableException('Mercado Pago integration is not configured');
    }

    const reserve = await this.courtReserveModel
      .findOne({ idCourtReserve: createMpDto.idCourtReserve })
      .select('idCourtReserve court dateToPlay turn player1 isPaidNight isVisit wasPaid ownerEmail reservationStatus checkoutReady')
      .lean()
      .exec();
    if (!reserve) {
      throw new NotFoundException(`Reserva ${createMpDto.idCourtReserve} no encontrada`);
    }
    if (reserve.wasPaid) {
      throw new BadRequestException(`Reserva ${createMpDto.idCourtReserve} ya fue pagada`);
    }
    if (reserve.ownerEmail && !reserve.checkoutReady) throw new BadRequestException('Completa los participantes de la reserva antes de pagar.');

    const amount = this.calculateAmount(Boolean(reserve.isPaidNight), Boolean(reserve.isVisit));
    const slot = await this.reservationSlots.beginCheckout(reserve, ownerEmail?.toLowerCase());
    if (slot.initPoint && slot.preferenceId) return { initPoint: slot.initPoint, preferenceId: slot.preferenceId };
    const paymentPayload: CreateMpDto = {
      courtId: reserve.court,
      date: reserve.dateToPlay,
      time: reserve.turn,
      player1: reserve.player1,
      amount,
      idCourtReserve: reserve.idCourtReserve,
      expiresAt: slot.expiresAt.toISOString(),
    };
    try {
      const initPoint = await axios.post(`${mpApiUrl}/create-preference`, paymentPayload, {
        headers: { 'x-api-key': internalApiKey },
        timeout: 30_000,
      });
      await this.reservationSlots.storeCheckout(reserve.idCourtReserve, initPoint.data);
      this.logger.log(`Mercado Pago preference created for reservation ${reserve.idCourtReserve}`);
      return initPoint.data;
    } catch (error) {
      if (axios.isAxiosError(error) && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')) {
        this.logger.warn(`Mercado Pago preference request timed out for reservation ${reserve.idCourtReserve}; no automatic retry`);
        throw new GatewayTimeoutException(
          'Mercado Pago no respondió a tiempo. El enlace de pago podría haberse creado. Revisa tu reserva antes de intentar nuevamente.',
        );
      }
      throw error;
    }
  }
  private calculateAmount(isPaidNight: boolean, isVisit: boolean): number {
    if (!isPaidNight && !isVisit) {
      throw new BadRequestException('La reserva no requiere pago');
    }

    const configKey = isPaidNight && isVisit ? 'MP_NIGHT_VISIT_AMOUNT' : isPaidNight ? 'MP_NIGHT_AMOUNT' : 'MP_VISIT_AMOUNT';
    return this.configuredAmount(configKey);
  }

  private configuredAmount(configKey: keyof typeof DEFAULT_PAYMENT_AMOUNTS): number {
    const amount = Number(this.configService.get<string>(configKey, String(DEFAULT_PAYMENT_AMOUNTS[configKey])));
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new ServiceUnavailableException(`Invalid ${configKey} configuration`);
    }
    return amount;
  }
}
