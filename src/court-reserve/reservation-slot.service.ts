import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import axios from 'axios';
import { DateTime } from 'luxon';
import { CourtReserve } from './entities/court-reserve.entity';
import { ReservationSlot } from './entities/reservation-slot.entity';

type SlotReservation = Pick<CourtReserve, 'court' | 'dateToPlay' | 'turn' | 'idCourtReserve'>;

@Injectable()
export class ReservationSlotService implements OnModuleInit, OnModuleDestroy {
  readonly holdDurationMs = 10 * 60 * 1000;
  private readonly logger = new Logger(ReservationSlotService.name);
  private timer?: ReturnType<typeof setInterval>;
  private draining = false;

  constructor(
    @InjectModel(ReservationSlot.name) private readonly slots: Model<ReservationSlot>,
    @InjectModel(CourtReserve.name) private readonly reserves: Model<CourtReserve>,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.expireDue(), 15_000);
    this.timer.unref?.();
    void this.expireDue();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private key(reserve: SlotReservation) {
    return JSON.stringify([reserve.dateToPlay, reserve.court, reserve.turn]);
  }

  async acquire(reserve: SlotReservation, ownerEmail?: string, adminOverride = false): Promise<ReservationSlot> {
    const now = new Date();
    const value = {
      reservationId: reserve.idCourtReserve,
      court: reserve.court,
      dateToPlay: reserve.dateToPlay,
      turn: reserve.turn,
      ownerEmail: ownerEmail ? ownerEmail.toLowerCase() : null,
      status: 'HELD' as const,
      expiresAt: new Date(now.getTime() + this.holdDurationMs),
    };
    let slot: ReservationSlot;
    const replaceable = adminOverride ? await this.reserves.findOne({
      court: reserve.court, dateToPlay: reserve.dateToPlay, turn: reserve.turn, state: true,
    }).select('idCourtReserve').lean().exec() : null;
    try {
      slot = await this.slots.create({ _id: this.key(reserve), ...value });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      slot = await this.slots.findOneAndUpdate(
        {
          _id: this.key(reserve),
          $or: [
            { status: { $in: ['RELEASED', 'EXPIRED', 'REVIEW'] } },
            { status: 'HELD', expiresAt: { $lte: now } },
            ...(replaceable ? [{ status: 'CONFIRMED', reservationId: replaceable.idCourtReserve }] : []),
          ],
        },
        { $set: value, $unset: { preferenceId: 1, initPoint: 1, nextReconcileAt: 1, reconcileUntil: 1, reconciliationToken: 1 } },
        { new: true },
      ).lean().exec();
      if (!slot) throw new ConflictException('La cancha está reservada o pendiente de pago.');
    }

    if (!adminOverride) {
      const existing = await this.reserves.findOne({
        court: reserve.court, dateToPlay: reserve.dateToPlay, turn: reserve.turn,
        state: true, idCourtReserve: { $ne: reserve.idCourtReserve },
      }).select('idCourtReserve').lean().exec();
      if (existing) {
        await this.releaseUnstarted(reserve.idCourtReserve);
        throw new ConflictException('La cancha ya fue reservada por otro usuario.');
      }
    }
    return slot;
  }

  async releaseUnstarted(reservationId: string) {
    return this.slots.findOneAndUpdate(
      { reservationId, status: 'HELD' }, { $set: { status: 'RELEASED' } }, { new: true },
    ).lean().exec();
  }

  async cancel(reservationId: string, ownerEmail: string) {
    const slot = await this.slots.findOne({ reservationId }).lean().exec();
    if (!slot) {
      const reserve = await this.reserves.findOne({ idCourtReserve: reservationId }).select('ownerEmail wasPaid reservationStatus').lean().exec();
      if (!reserve) throw new NotFoundException('Retención no encontrada.');
      if (reserve.ownerEmail !== ownerEmail.toLowerCase()) throw new ForbiddenException('La retención pertenece a otro usuario.');
      return { released: !reserve.wasPaid, status: reserve.reservationStatus };
    }
    if (slot.ownerEmail !== ownerEmail.toLowerCase()) throw new ForbiddenException('La retención pertenece a otro usuario.');
    const released = await this.releaseUnstarted(reservationId);
    if (released) {
      await this.reserves.updateOne({ idCourtReserve: reservationId, wasPaid: { $ne: true } }, { $set: { reservationStatus: 'CANCELLED', state: false } }).exec();
      return { released: true };
    }
    // A redirect, lost response, or closed browser cannot cancel an in-flight payment.
    return { released: slot.status === 'RELEASED' || slot.status === 'EXPIRED', status: slot.status };
  }

  async beginCheckout(reserve: SlotReservation, ownerEmail?: string) {
    let slot: ReservationSlot = await this.slots.findOne({ reservationId: reserve.idCourtReserve }).lean().exec();
    // Compatibility with existing reservations created before this stage.
    if (!slot) slot = await this.acquire(reserve, ownerEmail);
    if (slot.ownerEmail && slot.ownerEmail !== ownerEmail?.toLowerCase()) throw new ForbiddenException('La reserva pertenece a otro usuario.');
    if (slot.expiresAt <= new Date()) throw new ConflictException('La retención venció. Selecciona nuevamente el horario.');
    if (slot.status === 'CHECKOUT' && slot.initPoint) return slot;
    const claimed = await this.slots.findOneAndUpdate(
      { reservationId: reserve.idCourtReserve, status: 'HELD', expiresAt: { $gt: new Date() } },
      { $set: { status: 'CHECKOUT', nextReconcileAt: slot.expiresAt } }, { new: true },
    ).lean().exec();
    if (!claimed) throw new ConflictException('Este pago ya está en proceso o la retención venció.');
    return claimed;
  }

  async assertEditable(reservationId: string, ownerEmail: string) {
    const slot = await this.slots.findOne({ reservationId }).lean().exec();
    if (!slot) throw new NotFoundException('Retención no encontrada.');
    if (slot.ownerEmail !== ownerEmail.toLowerCase()) throw new ForbiddenException('La retención pertenece a otro usuario.');
    if (slot.status !== 'HELD' || slot.expiresAt <= new Date()) throw new ConflictException('La retención venció o el pago ya comenzó.');
    return slot;
  }

  async storeCheckout(reservationId: string, preference: { preferenceId: string; initPoint: string }) {
    await this.slots.updateOne({ reservationId, status: 'CHECKOUT' }, { $set: preference }).exec();
  }

  async confirm(reserve: SlotReservation): Promise<boolean> {
    const [start, end] = reserve.turn.split('-').map(value => value.trim());
    const startAt = DateTime.fromISO(`${reserve.dateToPlay}T${start}`, { zone: 'America/Santiago' });
    let endAt = DateTime.fromISO(`${reserve.dateToPlay}T${end}`, { zone: 'America/Santiago' });
    if (endAt <= startAt) endAt = endAt.plus({ days: 1 });
    if (!endAt.isValid || endAt.toMillis() <= Date.now()) {
      await this.markReview(reserve.idCourtReserve);
      return false;
    }
    // An expired hold may only be confirmed if no other reservation took its slot.
    let slot: ReservationSlot = await this.slots.findOne({ _id: this.key(reserve) }).lean().exec();
    if (!slot || slot.reservationId !== reserve.idCourtReserve || ['RELEASED', 'EXPIRED', 'REVIEW'].includes(slot.status)) {
      try {
        slot = await this.acquire(reserve);
      } catch (error) {
        if (error instanceof ConflictException) return false;
        throw error;
      }
    }
    const existing = await this.reserves.findOne({
      court: reserve.court, dateToPlay: reserve.dateToPlay, turn: reserve.turn,
      state: true, idCourtReserve: { $ne: reserve.idCourtReserve },
    }).select('idCourtReserve').lean().exec();
    if (existing) {
      await this.markReview(reserve.idCourtReserve);
      return false;
    }
    const confirmed = await this.slots.findOneAndUpdate(
      { _id: this.key(reserve), reservationId: reserve.idCourtReserve, status: { $in: ['HELD', 'CHECKOUT', 'CONFIRMED'] } },
      { $set: { status: 'CONFIRMED' } }, { new: true },
    ).lean().exec();
    return Boolean(confirmed);
  }

  private async markReview(reservationId: string) {
    await this.slots.updateOne({ reservationId, status: { $in: ['HELD', 'CHECKOUT'] } }, { $set: { status: 'REVIEW' } }).exec();
  }

  async releaseConfirmed(reservationId: string) {
    await this.slots.updateOne({ reservationId, status: 'CONFIRMED' }, { $set: { status: 'RELEASED' } }).exec();
  }

  async pendingForDate(dateToPlay: string) {
    return this.slots.find({ dateToPlay, $or: [
      { status: 'HELD', expiresAt: { $gt: new Date() } },
      { status: 'CHECKOUT' },
    ] }).lean().exec();
  }

  async expireDue() {
    if (this.draining) return;
    this.draining = true;
    try {
      const now = new Date();
      const due = await this.slots.find({ expiresAt: { $lte: now }, $or: [
        { status: 'HELD' },
        { status: 'CHECKOUT', nextReconcileAt: { $lte: now } },
      ] }).limit(20).lean().exec();
      for (const slot of due) {
        try {
          await this.expireSlot(slot);
        } catch (error) {
          this.logger.warn(`No se liberó ${slot.reservationId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      this.logger.error('No se pudieron consultar las retenciones vencidas', error);
    } finally {
      this.draining = false;
    }
  }

  private async expireSlot(slot: ReservationSlot) {
    let filter: Record<string, unknown> = { _id: slot._id, reservationId: slot.reservationId, status: 'HELD', expiresAt: { $lte: new Date() } };
    if (slot.status === 'CHECKOUT') {
      const token = randomUUID();
      const claimed = await this.slots.findOneAndUpdate(
        { _id: slot._id, reservationId: slot.reservationId, status: 'CHECKOUT', $or: [
          { reconcileUntil: { $exists: false } }, { reconcileUntil: { $lte: new Date() } },
        ] },
        { $set: { reconciliationToken: token, reconcileUntil: new Date(Date.now() + 60_000), nextReconcileAt: new Date(Date.now() + 30_000) } },
        { new: true },
      ).lean().exec();
      if (!claimed) return;
      const mpUrl = this.config.get<string>('MP_API_URL');
      const key = this.config.get<string>('INTERNAL_API_KEY');
      if (!mpUrl || !key) throw new Error('Mercado Pago no está configurado para conciliar el pago.');
      const { data } = await axios.post<{ status: string }>(`${mpUrl}/reconcile-reservation`, { reservationId: slot.reservationId }, {
        headers: { 'x-api-key': key }, timeout: 15_000,
      });
      if (!['unpaid', 'rejected', 'cancelled'].includes(data.status)) return;
      filter = { _id: slot._id, reservationId: slot.reservationId, status: 'CHECKOUT', reconciliationToken: token };
    }
    const expired = await this.slots.findOneAndUpdate(filter, { $set: { status: 'EXPIRED' } }, { new: true }).lean().exec();
    if (expired) {
      await this.reserves.updateOne({ idCourtReserve: slot.reservationId, wasPaid: { $ne: true } }, { $set: { reservationStatus: 'EXPIRED', state: false } }).exec();
    }
  }
}
