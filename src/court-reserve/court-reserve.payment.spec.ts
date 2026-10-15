import { BadRequestException, ConflictException } from '@nestjs/common';
import { CourtReserveService } from './court-reserve.service';
import { MercadoPagoPaymentStatus } from './dto/payment-confirmation.dto';
import { PaymentCallbackEffectStatus } from './entities/payment-callback-effect.entity';

describe('CourtReserveService payment callbacks', () => {
  function createService(policy?: any) {
    const model = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({ reservationStatus: 'CONFIRMED' }),
      }),
      findOneAndUpdate: jest.fn(),
    };
    const emailService = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    const auditLogService = { logPaymentEffect: jest.fn().mockResolvedValue(undefined) };
    const effectService = {
      executeOnce: jest.fn(async (_key, _type, _reservation, _status, effect) => ({
        processed: true,
        status: PaymentCallbackEffectStatus.PROCESSED,
        value: await effect(),
      })),
    };
    const slots = { confirm: jest.fn().mockResolvedValue(true), markReview: jest.fn() };
    const service = new CourtReserveService(
      model as any,
      {} as any,
      emailService as any,
      auditLogService as any,
      effectService as any,
      slots as any,
      policy,
    );
    return { service, model, emailService, auditLogService, effectService, slots };
  }

  it('requires Idempotency-Key for callbacks', async () => {
    const { service } = createService();
    await expect(service.updateStateReserve('reserve-1', undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates a paid reservation and stores payment traceability', async () => {
    const { service, model, auditLogService } = createService();
    model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ state: false, wasPaid: false }) });
    model.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ idCourtReserve: 'reserve-1', wasPaid: true }),
    });

    await service.updateStateReserve('reserve-1', 'mercadopago:pay-1:reservation-approved');

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { idCourtReserve: 'reserve-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          wasPaid: true,
          paymentStatus: 'approved',
          paymentIdempotencyKey: 'mercadopago:pay-1:reservation-approved',
        }),
      }),
      { new: true },
    );
    expect(auditLogService.logPaymentEffect).toHaveBeenCalledTimes(1);
  });

  it('does not execute a duplicate reservation update', async () => {
    const { service, model, effectService, auditLogService } = createService();
    effectService.executeOnce.mockResolvedValue({
      processed: false,
      status: PaymentCallbackEffectStatus.PROCESSED,
      value: undefined,
    });

    const response = await service.updateStateReserve('reserve-1', 'same-key');

    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    expect(response).toEqual({ idCourtReserve: 'reserve-1', reservationStatus: 'CONFIRMED', duplicate: true });
    expect(auditLogService.logPaymentEffect).toHaveBeenCalledWith(
      'reserve-1',
      'same-key',
      'STATE_CHANGE',
      'approved',
      'SKIPPED_DUPLICATE',
    );
  });

  it('sends a pending email instead of a rejected-payment email', async () => {
    const { service, emailService } = createService();
    jest.spyOn(service as any, 'getCourtReserveById').mockResolvedValue({ player1: 'Player' });
    jest.spyOn(service, 'findOneEmail').mockResolvedValue({ email: 'player@example.com' });

    await service.sendEmailConfirmation('reserve-1', MercadoPagoPaymentStatus.PENDING, 'email-key');

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Pago en proceso'),
        html: expect.not.stringContaining('Pago Rechazado'),
      }),
      'email-key',
    );
  });

  it('does not send a duplicate confirmation email', async () => {
    const { service, emailService, effectService } = createService();
    effectService.executeOnce.mockResolvedValue({
      processed: false,
      status: PaymentCallbackEffectStatus.PROCESSED,
      value: undefined,
    });

    const response = await service.sendEmailConfirmation(
      'reserve-1',
      MercadoPagoPaymentStatus.APPROVED,
      'same-email-key',
    );

    expect(emailService.sendEmail).not.toHaveBeenCalled();
    expect(response.duplicate).toBe(true);
  });

  it('records an approved payment for review when another reservation owns the slot', async () => {
    const { service, model, slots } = createService();
    model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ wasPaid: false }) });
    slots.confirm.mockResolvedValue(false);
    model.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ state: false, wasPaid: true, reservationStatus: 'PAYMENT_REVIEW_REQUIRED' }),
    });
    const result = await service.updateStateReserve('late', 'late-payment');
    expect(result.reservationStatus).toBe('PAYMENT_REVIEW_REQUIRED');
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { idCourtReserve: 'late' },
      expect.objectContaining({ $set: expect.objectContaining({ state: false, wasPaid: true }) }),
      { new: true },
    );
  });

  it('does not send a confirmation for a paid reservation requiring review', async () => {
    const { service, emailService } = createService();
    jest
      .spyOn(service as any, 'getCourtReserveById')
      .mockResolvedValue({ player1: 'Player', wasPaid: true, reservationStatus: 'PAYMENT_REVIEW_REQUIRED' });
    const result = await service.sendEmailConfirmation('late', MercadoPagoPaymentStatus.APPROVED, 'review-key');
    expect(result.skipped).toBe('PAYMENT_REVIEW_REQUIRED');
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });

  it('preserves an approved ranking payment for review if another active reservation exists', async () => {
    const policy = {
      withBookingPolicy: jest.fn().mockRejectedValue(new ConflictException({ code: 'ACTIVE_RESERVATION' })),
    };
    const { service, model, slots } = createService(policy);
    model.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ idCourtReserve: 'rank', wasPaid: false, isForRanking: true }),
    });
    model.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ wasPaid: true, state: false, reservationStatus: 'PAYMENT_REVIEW_REQUIRED' }),
    });
    const result = await service.updateStateReserve('rank', 'approved-key');
    expect(result.reservationStatus).toBe('PAYMENT_REVIEW_REQUIRED');
    expect(slots.confirm).not.toHaveBeenCalled();
    expect(slots.markReview).toHaveBeenCalledWith('rank');
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { idCourtReserve: 'rank', wasPaid: { $ne: true } },
      expect.objectContaining({
        $set: expect.objectContaining({ wasPaid: true, state: false, paymentIdempotencyKey: 'approved-key' }),
      }),
      { new: true },
    );
  });

  it('does not recheck capacity or reactivate a payment already persisted under the same key', async () => {
    const policy = { withBookingPolicy: jest.fn() };
    const { service, model, slots } = createService(policy);
    model.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        idCourtReserve: 'rank',
        wasPaid: true,
        isForRanking: true,
        paymentIdempotencyKey: 'same-key',
        state: false,
      }),
    });
    expect(await service.updateStateReserve('rank', 'same-key')).toMatchObject({ wasPaid: true, state: false });
    expect(policy.withBookingPolicy).not.toHaveBeenCalled();
    expect(slots.confirm).not.toHaveBeenCalled();
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('uses the participant transaction for the slot and reservation updates together', async () => {
    const session = {};
    const policy = { withBookingPolicy: jest.fn(async (_reserve, _exclude, operation) => operation(session)) };
    const { service, model, slots } = createService(policy);
    const reserve = { idCourtReserve: 'rank', wasPaid: false, isForRanking: true };
    model.findOne.mockReturnValue({ session: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(reserve) });
    const update = {
      session: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue({ ...reserve, wasPaid: true }),
    };
    model.findOneAndUpdate.mockReturnValue(update);
    await service.updateStateReserve('rank', 'approved-key');
    expect(slots.confirm).toHaveBeenCalledWith(reserve, session);
    expect(update.session).toHaveBeenCalledWith(session);
  });
});
