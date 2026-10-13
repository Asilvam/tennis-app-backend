import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateCourtReserveDto } from './dto/create-court-reserve.dto';
import { UpdateCourtReserveDto } from './dto/update-court-reserve.dto';
import { CourtReserve } from './entities/court-reserve.entity';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DateTime } from 'luxon';
import { EmailService } from '../email/email.service';
import { RegisterService } from '../register/register.service';
import { AuditLogService } from '../audit-log/audit-log.service';
// import { ConfigService } from '@nestjs/config';
import { TimeSlot } from './interfaces/court-reserve.interface';
import { buildReservationCancellationEmail, buildReservationConfirmationEmail } from '../email/templates/reservation-email.templates';
import { PaymentCallbackEffectService } from './payment-callback-effect.service';
import { MercadoPagoPaymentStatus } from './dto/payment-confirmation.dto';
import { PaymentCallbackEffectStatus } from './entities/payment-callback-effect.entity';
import { ReservationSlotService } from './reservation-slot.service';
import { randomUUID } from 'crypto';

type AdminReserveActor = {
  email: string;
  role: string;
};

const normalizeReservationDate = (value: string) => {
  const date = DateTime.fromISO(value, { zone: 'America/Santiago' });
  if (!date.isValid) throw new BadRequestException('Fecha de reserva inválida.');
  return date.toISODate();
};

const getTurnDateRange = (dateToPlay: string, turn: string, timezone: string) => {
  const [start, end] = turn.split('-').map((value) => value.trim());
  const startTime = DateTime.fromISO(`${dateToPlay}T${start}`, { zone: timezone });
  let endTime = DateTime.fromISO(`${dateToPlay}T${end}`, { zone: timezone });

  if (endTime <= startTime) {
    endTime = endTime.plus({ days: 1 });
  }

  return { startTime, endTime };
};

@Injectable()
export class CourtReserveService {
  private readonly logger = new Logger(CourtReserveService.name);

  constructor(
    @InjectModel('CourtReserve')
    private readonly courtReserveModel: Model<CourtReserve>,
    private readonly registerService: RegisterService,
    private readonly emailService: EmailService,
    private readonly auditLogService: AuditLogService,
    private readonly paymentCallbackEffectService: PaymentCallbackEffectService,
    private readonly reservationSlots: ReservationSlotService,
  ) {}

  playerHasActiveReserve = (player: string, activeReserves: any[]) => {
    return activeReserves.some((reserve) => reserve.player1 === player || reserve.player2 === player || reserve.player3 === player || reserve.player4 === player);
  };

  playerActiveReserve = (player: string, activeReserves: CourtReserve[]) => {
    const matchingReserve = activeReserves.find((reserve) => reserve.player1 === player || reserve.player2 === player || reserve.player3 === player || reserve.player4 === player);
    return matchingReserve || null; // Return the matching reservation or null if not found
  };

  validateDateTurn = async (dateToPlay: string, court: string, turn: string): Promise<boolean> => {
    const timezone = 'America/Santiago'; // Chile timezone
    const currentTime = DateTime.now().setZone(timezone); // Current time in the specified timezone
    const playDate = DateTime.fromISO(dateToPlay, { zone: timezone }).startOf('day');
    const today = currentTime.startOf('day');
    if (playDate < today) {
      return false;
    }
    if (playDate.hasSame(today, 'day')) {
      const { endTime } = getTurnDateRange(dateToPlay, turn, timezone);
      if (currentTime >= endTime) {
        this.logger.log('Current time is after the turn.');
        return false;
      }
    }
    const getDateTurn = await this.getAllCourtAvailable(dateToPlay);
    if (!getDateTurn) return false;
    const selectedTurn = getDateTurn.find((item) => item.time === turn);
    if (!selectedTurn) return false;
    const selectedCourt = selectedTurn.slots.find((item) => item.court === court);
    if (!selectedCourt) return false;
    return selectedCourt ? selectedCourt.available : false;
  };

  async adminReserve(createCourtReserveDtoArray: CreateCourtReserveDto[], actor?: AdminReserveActor) {
    const savedReservations = [];
    const errors = [];
    const performedBy = actor?.role === 'profesor' ? 'PROFESOR' : 'ADMIN';
    const performedByEmail = actor?.email?.trim().toLowerCase();

    for (const reservation of createCourtReserveDtoArray) {
      try {
        reservation.dateToPlay = normalizeReservationDate(reservation.dateToPlay);
        const { dateToPlay, turn, court, blockedMotive } = reservation;
        const newCourtReserve = new this.courtReserveModel(reservation);
        await this.reservationSlots.acquire(newCourtReserve, performedByEmail, true);
        const existingReserve = await this.courtReserveModel.findOne({ dateToPlay, turn, court, state: true }).select('idCourtReserve').exec();
        if (existingReserve?.idCourtReserve) {
          try {
            await this.sendEmailRemove(existingReserve.idCourtReserve, blockedMotive);
          } catch (emailErr) {
            this.logger.warn(`Failed to send cancellation email for ${existingReserve.idCourtReserve}`, emailErr);
          }
        }
        await this.courtReserveModel.updateMany({ dateToPlay, turn, court }, { state: false });
        const savedReservation = await newCourtReserve.save();
        await this.reservationSlots.confirm(savedReservation);
        savedReservations.push(savedReservation);

        // ✅ AUDITORÍA: Registrar creación individual
        try {
          await this.auditLogService.logReserveCreation(
            savedReservation.toObject(),
            performedBy,
            actor?.role === 'profesor' ? reservation.player1 : 'Admin Bulk Operation',
            performedByEmail,
          );
        } catch (auditErr) {
          this.logger.error('[adminReserve] Error logging audit', auditErr);
        }

        this.logger.log(`Reserva guardada: ${savedReservation.idCourtReserve}`);
      } catch (err) {
        const errorMsg = err?.message || String(err);
        this.logger.error(`Error procesando reserva`, errorMsg, err?.stack);
        errors.push({
          reservation: { dateToPlay: reservation.dateToPlay, court: reservation.court, turn: reservation.turn },
          error: errorMsg,
        });
      }
    }

    // ✅ AUDITORÍA: Registrar operación masiva
    if (savedReservations.length > 0) {
      try {
        await this.auditLogService.logBulkAdminReserves(savedReservations.length, performedBy, performedByEmail);
      } catch (auditErr) {
        this.logger.error('[adminReserve] Error logging bulk audit', auditErr);
      }
    }

    return { savedReservations, errors };
  }

  async adminCreate(createCourtReserveDto: CreateCourtReserveDto) {
    createCourtReserveDto.dateToPlay = normalizeReservationDate(createCourtReserveDto.dateToPlay);
    const { court, turn, dateToPlay } = createCourtReserveDto;
    const newCourtReserve = new this.courtReserveModel(createCourtReserveDto);
    await this.reservationSlots.acquire(newCourtReserve, undefined, true);
    await this.courtReserveModel.findOneAndUpdate({ dateToPlay, turn, court }, { state: false });
    const savedReservation = await newCourtReserve.save();
    await this.reservationSlots.confirm(savedReservation);

    // ✅ AUDITORÍA: Registrar creación por admin
    try {
      await this.auditLogService.logReserveCreation(savedReservation.toObject(), 'ADMIN', 'Admin User');
    } catch (auditErr) {
      this.logger.error('[adminCreate] Error logging audit', auditErr);
    }

    this.logger.log(savedReservation);
    return savedReservation;
  }

  async createHold(dto: CreateCourtReserveDto, email: string) {
    const ownerEmail = email.trim().toLowerCase();
    const player = await this.registerService.findOneByEmail(ownerEmail);
    if (!player?.namePlayer) throw new NotFoundException('No se encontró el jugador de la sesión.');
    const isPaidNight = ['20:15-22:00', '22:15-00:00'].includes(dto.turn);
    if (!isPaidNight && !dto.isVisit) throw new BadRequestException('Este horario no requiere pago.');
    const reserve = await this.create({
      court: dto.court, dateToPlay: dto.dateToPlay, turn: dto.turn,
      player1: player.namePlayer, player2: dto.player2, player3: dto.player3, player4: dto.player4,
      isVisit: Boolean(dto.isVisit), visitName: dto.visitName, isDouble: Boolean(dto.isDouble),
      isForRanking: !dto.isVisit && Boolean(dto.isForRanking), isPaidNight,
    }, { hold: true, ownerEmail });
    return { ...reserve.toObject(), serverNow: new Date().toISOString() };
  }

  async cancelHold(reservationId: string, ownerEmail: string) {
    return this.reservationSlots.cancel(reservationId, ownerEmail);
  }

  async prepareHold(reservationId: string, dto: CreateCourtReserveDto, ownerEmail: string) {
    const slot = await this.reservationSlots.assertEditable(reservationId, ownerEmail);
    const reserve = await this.courtReserveModel.findOne({ idCourtReserve: reservationId }).exec();
    if (!reserve) throw new NotFoundException('Reserva no encontrada.');
    const participants = {
      player1: reserve.player1, player2: dto.player2, player3: dto.player3, player4: dto.player4,
      isVisit: Boolean(dto.isVisit), visitName: dto.visitName, isDouble: Boolean(dto.isDouble),
      isForRanking: !dto.isVisit && Boolean(dto.isForRanking),
    };
    this.validateParticipants(participants);
    if (!reserve.isPaidNight && !participants.isVisit) throw new BadRequestException('La reserva ya no requiere pago.');
    const active = await this.getAllCourtReserves();
    for (const player of [participants.player1, participants.player2, participants.player3, participants.player4].filter(Boolean)) {
      if (this.playerHasActiveReserve(player, active || [])) throw new ConflictException(`El jugador ${player} ya tiene una reserva activa.`);
    }
    await this.reservationSlots.assertEditable(reservationId, ownerEmail);
    const prepared = await this.courtReserveModel.findOneAndUpdate(
      { idCourtReserve: reservationId, reservationStatus: 'PENDING_PAYMENT', wasPaid: false, checkoutReady: false },
      { $set: { ...participants, checkoutReady: true } }, { new: true },
    ).exec();
    if (!prepared) throw new ConflictException('La reserva ya no está pendiente de pago.');
    return { idCourtReserve: reservationId, expiresAt: slot.expiresAt };
  }

  async create(createCourtReserveDto: CreateCourtReserveDto, options: { hold?: boolean; ownerEmail?: string } = {}) {
    createCourtReserveDto = {
      court: createCourtReserveDto.court, dateToPlay: normalizeReservationDate(createCourtReserveDto.dateToPlay), turn: createCourtReserveDto.turn,
      player1: createCourtReserveDto.player1, player2: createCourtReserveDto.player2,
      player3: createCourtReserveDto.player3, player4: createCourtReserveDto.player4,
      isVisit: Boolean(createCourtReserveDto.isVisit), visitName: createCourtReserveDto.visitName,
      isDouble: Boolean(createCourtReserveDto.isDouble), isForRanking: Boolean(createCourtReserveDto.isForRanking),
      isPaidNight: ['20:15-22:00', '22:15-00:00'].includes(createCourtReserveDto.turn), wasPaid: false,
    };
    const { player1, player2, player3, player4, court, turn, dateToPlay, isVisit, isDouble } = createCourtReserveDto;
    if (!options.hold) this.validateParticipants(createCourtReserveDto);
    const validateDateTurn = await this.validateDateTurn(dateToPlay, court, turn);
    if (validateDateTurn) {
      const existingReserve = await this.courtReserveModel.findOne({ dateToPlay, turn, court, state: true }).select('idCourtReserve').exec();
      if (existingReserve) {
        throw new BadRequestException('This court is already reserved for this time');
      }
      const activeReserves = await this.getAllCourtReserves();
      if (activeReserves) {
        const playersToCheck = isVisit ? [player1] : isDouble ? [player1, player2, player3, player4] : [player1, player2];
        for (const player of playersToCheck.filter(Boolean)) {
          if (this.playerHasActiveReserve(player, activeReserves)) throw new ConflictException(`El jugador ${player} ya tiene una reserva activa.`);
        }
      }
      const newCourtReserve = new this.courtReserveModel({ ...createCourtReserveDto, ...(options.hold ? { idCourtReserve: randomUUID() } : {}) });
      const slot = await this.reservationSlots.acquire(newCourtReserve, options.ownerEmail);
      newCourtReserve.ownerEmail = options.ownerEmail;
      newCourtReserve.holdExpiresAt = slot.expiresAt;
      newCourtReserve.checkoutReady = !options.hold;
      newCourtReserve.reservationStatus = newCourtReserve.isPaidNight || newCourtReserve.isVisit ? 'PENDING_PAYMENT' : 'CONFIRMED';
      let response;
      try {
        response = await newCourtReserve.save();
        if (response.state) await this.reservationSlots.confirm(response);
      } catch (error) {
        await this.reservationSlots.releaseUnstarted(newCourtReserve.idCourtReserve);
        throw error;
      }
      try {
        const playerEmail = await this.findOneEmail(player1);
        await this.auditLogService.logReserveCreation(response.toObject(), 'USER', player1, playerEmail?.email);
      } catch (auditErr) {
        this.logger.error('[create] Error logging audit', auditErr);
      }
      try {
        if (!response.isPaidNight && !response.isVisit) await this.sendEmailReserve(response);
      } catch (error) {
        this.logger.error('Failed to send reservation email', error);
      }
      return response;
    }
    throw new BadRequestException('Invalid input');
  }

  private validateParticipants(createCourtReserveDto: Partial<CreateCourtReserveDto>) {
    const { player1, player2, player3, player4, isVisit, isDouble } = createCourtReserveDto;
    if (isDouble) {
      if (isVisit) {
        throw new BadRequestException('Doubles reserves cannot be marked as visit');
      }
      if (!player1 || !player2 || !player3 || !player4) {
        throw new BadRequestException('Doubles reserves require player1, player2, player3, and player4');
      }
    } else if (isVisit) {
      if (!player1 || !createCourtReserveDto.visitName) {
        throw new BadRequestException('Visit reserves require player1 and visitName');
      }
      if (player2 || player3 || player4) {
        throw new BadRequestException('Visit reserves cannot include player2, player3, or player4');
      }
    } else {
      if (!player1 || !player2) {
        throw new BadRequestException('Singles reserves require player1 and player2');
      }
      if (player3 || player4 || createCourtReserveDto.visitName) {
        throw new BadRequestException('Singles reserves cannot include player3, player4, or visitName');
      }
    }
  }

  async findAll() {
    return await this.courtReserveModel.find();
  }

  async validateIdReserve({ id, pass }) {
    const getShortNames = (names: string[]): string[] =>
      names.map((name) => {
        const nameParts = name.split(' ');
        const firstInitial = `${nameParts[0][0]}.`;
        const lastName = nameParts.length > 2 ? nameParts[nameParts.length - 2] : nameParts[1];
        return `${firstInitial} ${lastName}`;
      });
    // this.logger.log(id, pass);
    let player1Data;
    let player2Data;
    let player3Data;
    let player4Data;

    const reserves = await this.courtReserveModel
      .findOne({
        idCourtReserve: id,
        passCourtReserve: pass,
        isForRanking: true,
      })
      .select('idCourtReserve court turn dateToPlay player1 player2 player3 player4 isDouble state resultMatchUpdated');
    if (reserves === null) {
      throw new BadRequestException('No se encontro la reserva');
    }
    if (!reserves.state) {
      throw new BadRequestException('Reserva no valida, fue cancelada');
    }

    if (reserves.resultMatchUpdated) {
      throw new ConflictException('Otro jugador ya registró el resultado de este partido.');
    }

    const timezone = 'America/Santiago';
    const matchDate = DateTime.fromISO(reserves.dateToPlay, { zone: timezone }).startOf('day');
    const currentDate = DateTime.now().setZone(timezone).startOf('day');

    const diffInDays = currentDate.diff(matchDate, 'days').days;

    if (diffInDays > 2) {
      throw new BadRequestException('No se puede actualizar el resultado. El plazo para hacerlo ha expirado (2 días después del partido).');
    }

    if (reserves) {
      if (reserves.isDouble) {
        player3Data = await this.registerService.findOneEmail(reserves.player3);
        player4Data = await this.registerService.findOneEmail(reserves.player4);
      }
      player1Data = await this.registerService.findOneEmail(reserves.player1);
      player2Data = await this.registerService.findOneEmail(reserves.player2);
    }

    if (reserves.isDouble) {
      return {
        isValid: true,
        players: getShortNames([reserves.player1, reserves.player2, reserves.player3, reserves.player4]),
        isDouble: reserves.isDouble,
        dataPlayers: [player1Data, player2Data, player3Data, player4Data],
        dateToPlay: reserves.dateToPlay,
      };
    } else
      return {
        isValid: true,
        players: getShortNames([reserves.player1, reserves.player2]),
        isDouble: reserves.isDouble,
        dataPlayers: [player1Data, player2Data],
        dateToPlay: reserves.dateToPlay,
      };
  }

  update(id: number, updateCourtReserveDto: UpdateCourtReserveDto) {
    this.logger.log('updateCourtReserveDto', updateCourtReserveDto);
    return `This action updates a #${id} courtReserve`;
  }

  async claimResultMatch(idCourtReserve: string): Promise<CourtReserve> {
    const updatedReserve = await this.courtReserveModel.findOneAndUpdate(
      {
        idCourtReserve,
        state: true,
        isForRanking: true,
        resultMatchUpdated: false,
      },
      { resultMatchUpdated: true },
      { new: true },
    );

    if (!updatedReserve) {
      throw new ConflictException('Otro jugador ya registró el resultado de este partido.');
    }

    return updatedReserve;
  }

  async releaseResultMatch(idCourtReserve: string): Promise<void> {
    await this.courtReserveModel.updateOne({ idCourtReserve, resultMatchUpdated: true }, { resultMatchUpdated: false }).exec();
  }

  async logResultMatchUpdate(idCourtReserve: string, playerName?: string): Promise<void> {
    try {
      await this.auditLogService.logMatchResultUpdate(idCourtReserve, playerName);
    } catch (auditErr) {
      this.logger.error('[logResultMatchUpdate] Error logging audit', auditErr);
    }

    this.logger.log(`Match result updated for reserve: ${idCourtReserve}`);
  }

  async updateStateReserve(idCourtReserve: string, idempotencyKey: string) {
    this.validateIdempotencyKey(idempotencyKey);

    const result = await this.paymentCallbackEffectService.executeOnce(
      idempotencyKey,
      'RESERVATION_UPDATE',
      idCourtReserve,
      MercadoPagoPaymentStatus.APPROVED,
      async () => {
        const currentReserve = await this.courtReserveModel.findOne({ idCourtReserve }).exec();
        if (!currentReserve) {
          throw new NotFoundException(`Reserve with idCourtReserve ${idCourtReserve} not found`);
        }
        if (currentReserve.wasPaid && currentReserve.paymentIdempotencyKey && currentReserve.paymentIdempotencyKey !== idempotencyKey) {
          throw new ConflictException(`Reserve ${idCourtReserve} was already paid by another payment`);
        }

        const confirmed = await this.reservationSlots.confirm(currentReserve);
        return this.courtReserveModel
          .findOneAndUpdate(
            { idCourtReserve },
            {
              $set: {
                state: confirmed,
                wasPaid: true,
                reservationStatus: confirmed ? 'CONFIRMED' : 'PAYMENT_REVIEW_REQUIRED',
                paymentStatus: MercadoPagoPaymentStatus.APPROVED,
                paymentIdempotencyKey: idempotencyKey,
                paidAt: currentReserve.paidAt || new Date(),
              },
            },
            { new: true },
          )
          .exec();
      },
    );

    if (result.status === PaymentCallbackEffectStatus.PROCESSED) {
      await this.auditLogService.logPaymentEffect(
        idCourtReserve,
        idempotencyKey,
        'STATE_CHANGE',
        MercadoPagoPaymentStatus.APPROVED,
        result.processed ? 'PROCESSED' : 'SKIPPED_DUPLICATE',
      );
    }

    if (result.value) return result.value;
    const persisted = await this.courtReserveModel.findOne({ idCourtReserve }).select('idCourtReserve reservationStatus state wasPaid').lean().exec();
    return { ...persisted, idCourtReserve, duplicate: true };
  }

  async sendEmailConfirmation(idCourtReserve: string, paymentStatus: MercadoPagoPaymentStatus, idempotencyKey: string) {
    this.validateIdempotencyKey(idempotencyKey);

    const result = await this.paymentCallbackEffectService.executeOnce(
      idempotencyKey,
      'EMAIL_CONFIRMATION',
      idCourtReserve,
      paymentStatus,
      async () => {
        const reserve = await this.getCourtReserveById(idCourtReserve);
        if (reserve.reservationStatus === 'PAYMENT_REVIEW_REQUIRED') return { skipped: 'PAYMENT_REVIEW_REQUIRED' };
        if (paymentStatus === MercadoPagoPaymentStatus.APPROVED && !reserve.wasPaid) {
          throw new ConflictException('El pago requiere verificar la reserva antes de enviar una confirmación.');
        }
        const email = await this.findOneEmail(reserve.player1);
        if (!email) {
          throw new NotFoundException(`[sendEmailConfirmation] Email for player ${reserve.player1} not found`);
        }

        await this.emailService.sendEmail(this.buildPaymentStatusEmail(email.email, reserve.player1, paymentStatus), idempotencyKey);
      },
    );

    if (result.status === PaymentCallbackEffectStatus.PROCESSED) {
      await this.auditLogService.logPaymentEffect(
        idCourtReserve,
        idempotencyKey,
        'PAYMENT_CONFIRMATION',
        paymentStatus,
        result.processed ? 'PROCESSED' : 'SKIPPED_DUPLICATE',
      );
    }

    return { idCourtReserve, paymentStatus, duplicate: !result.processed, ...(result.value || {}) };
  }

  private validateIdempotencyKey(idempotencyKey: string): void {
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw new BadRequestException('A valid Idempotency-Key header is required');
    }
  }

  private buildPaymentStatusEmail(to: string, player: string, paymentStatus: MercadoPagoPaymentStatus) {
    const approved = paymentStatus === MercadoPagoPaymentStatus.APPROVED;
    const pending = [
      MercadoPagoPaymentStatus.AUTHORIZED,
      MercadoPagoPaymentStatus.PENDING,
      MercadoPagoPaymentStatus.IN_PROCESS,
      MercadoPagoPaymentStatus.IN_MEDIATION,
    ].includes(paymentStatus);
    const title = approved ? '✅ Pago Confirmado' : pending ? '⏳ Pago en proceso' : '⚠️ Pago no completado';
    const subject = approved
      ? '✅ Pago Confirmado - Reserva Aprobada'
      : pending
        ? '⏳ Pago en proceso - Reserva pendiente'
        : '⚠️ Actualización de pago de tu reserva';
    const message = approved
      ? 'Tu pago fue confirmado y tu reserva está definitivamente aprobada.'
      : pending
        ? 'Mercado Pago aún está procesando tu operación. Te avisaremos cuando exista una confirmación definitiva.'
        : `Mercado Pago informó el estado “${paymentStatus}”. Tu reserva no fue marcada como pagada.`;

    return {
      to,
      subject,
      html: `<div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: auto; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px;">
  <h2>${title}</h2>
  <p>Hola ${player},</p>
  <p>${message}</p>
  <p><strong>Club de Tenis Quintero</strong></p>
</div>`,
    };
  }

  async remove(idCourtReserve: string) {
    const reserve = await this.getCourtReserveById(idCourtReserve);

    // ✅ AUDITORÍA: Registrar cancelación antes de eliminar
    try {
      await this.auditLogService.logReserveCancellation(idCourtReserve, reserve, reserve.isBlockedByAdmin ? 'ADMIN' : 'USER', reserve.player1, reserve.blockedMotive);
    } catch (auditErr) {
      this.logger.error('[remove] Error logging audit', auditErr);
    }

    if (!reserve.isBlockedByAdmin) {
      this.sendEmailRemove(idCourtReserve);
    }
    const updatedRegister = await this.courtReserveModel.findOneAndUpdate({ idCourtReserve: idCourtReserve }, { state: false }, { new: true }).exec();
    if (!updatedRegister) {
      throw new NotFoundException(`Register with idCourtReserve ${idCourtReserve} not found`);
    }
    await this.reservationSlots.releaseConfirmed(idCourtReserve);
    return updatedRegister;
  }

  async getAllCourtAvailable(selectedDate: string) {
    selectedDate = normalizeReservationDate(selectedDate);
    const formatPlayerNames = (players: { [key: string]: string }): string => {
      return Object.values(players)
        .filter((name) => name) // Remove empty names
        .map((name) => {
          const nameParts = name.split(' ');
          const firstInitial = nameParts[0][0].toUpperCase();
          const lastName = nameParts.length > 2 ? nameParts[nameParts.length - 2] : nameParts[nameParts.length - 1];
          return `${firstInitial}. ${lastName.charAt(0).toUpperCase() + lastName.slice(1).toLowerCase()}`;
        })
        .join(', ');
    };

    const activeReserves = await this.courtReserveModel
      .find({ dateToPlay: selectedDate, state: true })
      .select(['dateToPlay', 'court', 'turn', 'player1', 'player2', 'player3', 'player4', 'isDouble', 'isVisit', 'visitName', 'isBlockedByAdmin', 'blockedMotive'])
      .exec();
    // this.logger.log(activeReserves);
    const AllTimeSlotsAvailable: TimeSlot[] = [
      {
        time: '08:15-10:00',
        slots: [
          { available: true, court: 'Cancha 1', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 2', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 3', isPayed: false, isBlockedByAdmin: false, data: null },
        ],
      },
      {
        time: '10:15-12:00',
        slots: [
          { available: true, court: 'Cancha 1', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 2', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 3', isPayed: false, isBlockedByAdmin: false, data: null },
        ],
      },
      {
        time: '12:15-14:00',
        slots: [
          { available: true, court: 'Cancha 1', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 2', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 3', isPayed: false, isBlockedByAdmin: false, data: null },
        ],
      },
      {
        time: '14:15-16:00',
        slots: [
          { available: true, court: 'Cancha 1', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 2', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 3', isPayed: false, isBlockedByAdmin: false, data: null },
        ],
      },
      {
        time: '16:15-18:00',
        slots: [
          { available: true, court: 'Cancha 1', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 2', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 3', isPayed: false, isBlockedByAdmin: false, data: null },
        ],
      },
      {
        time: '18:15-20:00',
        slots: [
          { available: true, court: 'Cancha 1', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 2', isPayed: false, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 3', isPayed: false, isBlockedByAdmin: false, data: null },
        ],
      },
      {
        time: '20:15-22:00',
        slots: [
          { available: true, court: 'Cancha 1', isPayed: true, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 2', isPayed: true, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 3', isPayed: true, isBlockedByAdmin: false, data: null },
        ],
      },
      {
        time: '22:15-00:00',
        slots: [
          { available: true, court: 'Cancha 1', isPayed: true, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 2', isPayed: true, isBlockedByAdmin: false, data: null },
          { available: true, court: 'Cancha 3', isPayed: true, isBlockedByAdmin: false, data: null },
        ],
      },
    ];
    const generateTimeSlotAvailability = () => {
      return AllTimeSlotsAvailable.map((timeSlot) => ({
        time: timeSlot.time,
        slots: timeSlot.slots.map((slot) => ({ ...slot })),
      }));
    };
    const availability = generateTimeSlotAvailability();
    const pendingSlots = await this.reservationSlots.pendingForDate(selectedDate);
    availability.forEach((turn) => {
      if (activeReserves.length > 0) {
        // this.logger.log(activeReserves);
        activeReserves.forEach((reserve) => {
          if (turn.time === reserve.turn) {
            const court = turn.slots.find((slot) => slot.court === reserve.court);
            if (court) {
              court.available = false;
              if (!reserve.isBlockedByAdmin) {
                court.data = formatPlayerNames({
                  player1: reserve.player1,
                  player2: reserve.player2,
                  player3: reserve.player3,
                  player4: reserve.player4,
                  visitName: reserve.visitName,
                });
              } else {
                court.isBlockedByAdmin = true;
                court.data = reserve.blockedMotive;
              }
            }
          }
        });
      }
    });
    for (const pending of pendingSlots) {
      const slot = availability.find((turn) => turn.time === pending.turn)?.slots.find((court) => court.court === pending.court);
      if (slot?.available) {
        slot.available = false;
        slot.isPendingPayment = true;
        slot.holdExpiresAt = pending.expiresAt.toISOString();
        slot.data = 'Pendiente de pago';
      }
    }
    return availability;
  }

  async getAllHistoryReservesFor(namePlayer: string): Promise<CourtReserve[] | null> {
    try {
      return await this.courtReserveModel
        .find({
          $or: [{ player1: namePlayer }, { player2: namePlayer }, { player3: namePlayer }, { player4: namePlayer }],
        })
        .select('dateToPlay court turn player1 player2 player3 player4 ' + 'visitName idCourtReserve state passCourtReserve isForRanking resultMatchUpdated')
        .sort({
          dateToPlay: 'desc',
          turn: 'asc',
          court: 'asc',
        })
        .exec();
    } catch (error) {
      this.logger.error(error);
    }
  }

  async getAllIsForRankingReservesFor(namePlayer: string): Promise<CourtReserve[] | null> {
    const timezone = 'America/Santiago';
    const currentDate = DateTime.now().setZone(timezone).startOf('day');

    try {
      const reserves = await this.courtReserveModel
        .find({
          state: true,
          isForRanking: true,
          resultMatchUpdated: false,
          $or: [{ player1: namePlayer }, { player2: namePlayer }, { player3: namePlayer }, { player4: namePlayer }],
        })
        .select('dateToPlay court turn player1 player2 player3 player4 visitName idCourtReserve state passCourtReserve isForRanking resultMatchUpdated')
        .sort({
          dateToPlay: 'desc',
          turn: 'asc',
          court: 'asc',
        })
        .exec();

      if (!reserves.length) {
        return [];
      }

      const filteredReserves = reserves.filter((reserve) => {
        const matchDate = DateTime.fromISO(reserve.dateToPlay, { zone: timezone }).startOf('day');

        if (!matchDate.isValid) {
          return false;
        }

        const diffDays = currentDate.diff(matchDate, 'days').days;
        return diffDays >= 0 && diffDays <= 1;
      });

      return filteredReserves.length > 0 ? filteredReserves : null;
    } catch (error) {
      this.logger.error('Error retrieving ranking reserves:', error);
      return null;
    }
  }

  async getAllReservesFor(namePlayer: string): Promise<CourtReserve[] | null> {
    const timezone = 'America/Santiago'; // Chile timezone
    const currentTime = DateTime.now().setZone(timezone); // Current time in the specified timezone
    const today = currentTime.startOf('day');
    try {
      const courtReserves = await this.courtReserveModel
        .find({
          dateToPlay: { $gte: today.toISODate() },
          state: true,
          $or: [{ player1: namePlayer }, { player2: namePlayer }, { player3: namePlayer }, { player4: namePlayer }],
        })
        .select('dateToPlay court turn')
        .sort({
          dateToPlay: 'asc',
          turn: 'asc',
          court: 'asc',
        })
        .exec();
      if (courtReserves.length > 0) {
        const filteredReserves = courtReserves.filter((reserve) => {
          const reservationDate = DateTime.fromISO(reserve.dateToPlay, { zone: timezone });
          const isToday = reservationDate.hasSame(today, 'day');
          const { endTime } = getTurnDateRange(reserve.dateToPlay, reserve.turn, timezone);
          const hasNotEnded = currentTime < endTime;
          const isFutureDate = reservationDate > today;
          return (isToday && hasNotEnded) || isFutureDate;
        });
        // this.logger.log(filteredReserves);
        return filteredReserves.length > 0 ? filteredReserves : null;
      }
    } catch (error) {
      this.logger.error('Error retrieving court reserves:', error);
      throw error; // Optionally re-throw the error to propagate it
    }
  }

  async getAllCourtReserves(): Promise<CourtReserve[] | null> {
    const timezone = 'America/Santiago'; // Chile timezone
    const currentTime = DateTime.now().setZone(timezone); // Current time in the specified timezone
    const today = currentTime.startOf('day');
    try {
      const courtReserves = await this.courtReserveModel
        .find({
          dateToPlay: { $gte: today.toISODate() }, // Filter by today and later
        })
        .sort({
          dateToPlay: 'asc',
          turn: 'asc',
          court: 'asc',
        })
        .exec();
      if (courtReserves.length > 0) {
        const filteredReserves = courtReserves.filter((reserve) => {
          const reservationDate = DateTime.fromISO(reserve.dateToPlay, { zone: timezone });
          const isToday = reservationDate.hasSame(today, 'day');
          const { endTime } = getTurnDateRange(reserve.dateToPlay, reserve.turn, timezone);
          const hasNotEnded = currentTime < endTime;
          const isActive = reserve.state === true;
          const isFutureDate = reservationDate > today;
          return (isToday && hasNotEnded && isActive) || (isFutureDate && isActive);
        });
        return filteredReserves.length > 0 ? filteredReserves : null;
      } else {
        this.logger.log('No court reserves found');
        return null;
      }
    } catch (error) {
      this.logger.error('Error retrieving court reserves:', error);
      throw error; // Optionally re-throw the error to propagate it
    }
  }

  async findOneEmail(player: string): Promise<any> {
    return await this.registerService.findOneEmail(player);
  }

  async sendEmailReserve(courtReserve: CourtReserve) {
    const getEmailData = (email: { email: string }, courtReserve: CourtReserve) => {
      // --- Formateo de datos para el correo ---
      const formattedDate = DateTime.fromISO(courtReserve.dateToPlay).toFormat('dd-MM-yyyy');
      const courtNumber = courtReserve.court.replace('Cancha ', '');

      const [turnStart] = courtReserve.turn.split('-');
      const turnStartTime = DateTime.fromFormat(turnStart, 'HH:mm');
      const maintenanceThresholdTime = DateTime.fromFormat('14:15', 'HH:mm');
      const requiresMaintenance = turnStartTime >= maintenanceThresholdTime;

      return {
        to: email.email,
        subject: courtReserve.isPaidNight || courtReserve.isVisit ? 'Reserva recibida - Pago pendiente' : 'Reserva confirmada',
        html: buildReservationConfirmationEmail({
          reserve: courtReserve,
          formattedDate,
          courtNumber,
          requiresMaintenance,
        }),
      };
    };

    const sendEmailIfNeeded = async (player: string | null) => {
      if (player) {
        const email = await this.findOneEmail(player);
        if (email) {
          await this.emailService.sendEmail(getEmailData(email, courtReserve));
        }
      }
    };
    const email1 = await this.findOneEmail(courtReserve.player1);
    await this.emailService.sendEmail(getEmailData(email1, courtReserve));
    if (!courtReserve.isVisit) {
      await sendEmailIfNeeded(courtReserve.player2);
    }
    if (courtReserve.isDouble) {
      await sendEmailIfNeeded(courtReserve.player3);
      await sendEmailIfNeeded(courtReserve.player4);
    }
    if (courtReserve.isVisit || courtReserve.isPaidNight) {
      const notificationEmail = 'clubquinterotenis@gmail.com'; // Reemplaza esto con el email deseado
      await this.emailService.sendEmail(getEmailData({ email: notificationEmail }, courtReserve));
    }
  }

  private async getCourtReserveById(idCourtReserve: string): Promise<CourtReserve> {
    const reserve = await this.courtReserveModel.findOne({ idCourtReserve }).select('dateToPlay court turn player1 player2 player3 player4 visitName isVisit isDouble isBlockedByAdmin wasPaid reservationStatus').exec();

    if (!reserve) {
      throw new NotFoundException(`Reserva ${idCourtReserve} no encontrada`);
    }

    return reserve;
  }

  async sendEmailRemove(idCourtReserve: string, reason?: string): Promise<void> {
    const courtReserve = await this.getCourtReserveById(idCourtReserve);

    const formatDate = (iso: string) => DateTime.fromISO(iso).toFormat('dd-MM-yyyy');
    const courtNumber = courtReserve.court.replace('Cancha ', '');
    const formattedDate = formatDate(courtReserve.dateToPlay);

    const buildCancellationEmail = (emailAddress: string) => ({
      to: emailAddress,
      subject: 'Reserva anulada',
      html: buildReservationCancellationEmail({
        reserve: courtReserve,
        formattedDate,
        courtNumber,
        reason,
      }),
    });

    const notifyPlayer = async (playerName: string | null) => {
      if (!playerName) return;
      try {
        if (playerName === 'clubquinterotenis@gmail.com') {
          await this.emailService.sendEmail(buildCancellationEmail(playerName));
        } else {
          const emailData = await this.findOneEmail(playerName);
          if (emailData?.email) {
            await this.emailService.sendEmail(buildCancellationEmail(emailData.email));
          }
        }
      } catch (err) {
        this.logger.error(`Error notifying ${playerName}`, err?.stack || err?.message || String(err));
      }
    };

    const players = [courtReserve.player1];
    if (!courtReserve.isVisit) players.push(courtReserve.player2);
    if (courtReserve.isDouble) players.push(courtReserve.player3, courtReserve.player4);
    if (courtReserve.isVisit || courtReserve.isPaidNight) {
      players.push('clubquinterotenis@gmail.com');
    }

    await Promise.allSettled(players.map(notifyPlayer));
  }
}
