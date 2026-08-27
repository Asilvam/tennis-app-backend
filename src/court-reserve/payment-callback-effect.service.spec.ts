import { PaymentCallbackEffectService } from './payment-callback-effect.service';
import { PaymentCallbackEffectStatus } from './entities/payment-callback-effect.entity';

describe('PaymentCallbackEffectService', () => {
  function query(value: unknown) {
    return { exec: jest.fn().mockResolvedValue(value) };
  }

  it('executes an effect and persists PROCESSED', async () => {
    const model = {
      create: jest.fn().mockResolvedValue({}),
      findOneAndUpdate: jest.fn().mockReturnValue(query({ _id: 'effect-1' })),
      updateOne: jest.fn().mockReturnValue(query({ modifiedCount: 1 })),
    };
    const service = new PaymentCallbackEffectService(model as any);
    const effect = jest.fn().mockResolvedValue('done');

    const result = await service.executeOnce('key-1', 'EMAIL_CONFIRMATION', 'reserve-1', 'approved', effect);

    expect(result).toEqual({ processed: true, status: PaymentCallbackEffectStatus.PROCESSED, value: 'done' });
    expect(effect).toHaveBeenCalledTimes(1);
    expect(model.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: 'effect-1' }), expect.objectContaining({ $set: expect.objectContaining({ status: PaymentCallbackEffectStatus.PROCESSED }) }));
  });

  it('runs a concurrent idempotency key only once', async () => {
    let createCalls = 0;
    let claimCalls = 0;
    const model = {
      create: jest.fn().mockImplementation(async () => {
        createCalls += 1;
        if (createCalls > 1) throw { code: 11000 };
        return {};
      }),
      findOneAndUpdate: jest.fn().mockImplementation(() => query(claimCalls++ === 0 ? { _id: 'effect-1' } : null)),
      updateOne: jest.fn().mockReturnValue(query({ modifiedCount: 1 })),
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({
          status: PaymentCallbackEffectStatus.PROCESSED,
          effectType: 'EMAIL_CONFIRMATION',
          reservationId: 'reserve-1',
          paymentStatus: 'approved',
        }),
      }),
    };
    const service = new PaymentCallbackEffectService(model as any);
    const effect = jest.fn().mockResolvedValue(undefined);

    const results = await Promise.all([service.executeOnce('same-key', 'EMAIL_CONFIRMATION', 'reserve-1', 'approved', effect), service.executeOnce('same-key', 'EMAIL_CONFIRMATION', 'reserve-1', 'approved', effect)]);

    expect(effect).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.processed)).toHaveLength(1);
  });

  it('marks an effect FAILED and allows the caller to retry', async () => {
    const model = {
      create: jest.fn().mockResolvedValue({}),
      findOneAndUpdate: jest.fn().mockReturnValue(query({ _id: 'effect-1' })),
      updateOne: jest.fn().mockReturnValue(query({ modifiedCount: 1 })),
    };
    const service = new PaymentCallbackEffectService(model as any);

    await expect(
      service.executeOnce('key-1', 'RESERVATION_UPDATE', 'reserve-1', 'approved', async () => {
        throw new Error('Mongo disconnected');
      }),
    ).rejects.toThrow('Mongo disconnected');

    expect(model.updateOne).toHaveBeenCalledWith({ _id: 'effect-1' }, expect.objectContaining({ $set: expect.objectContaining({ status: PaymentCallbackEffectStatus.FAILED }) }));
  });

  it('rejects reuse of a key for a different effect', async () => {
    const model = {
      create: jest.fn().mockRejectedValue({ code: 11000 }),
      findOneAndUpdate: jest.fn().mockReturnValue(query(null)),
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({
          status: PaymentCallbackEffectStatus.PROCESSED,
          effectType: 'EMAIL_CONFIRMATION',
          reservationId: 'another-reserve',
          paymentStatus: 'approved',
        }),
      }),
    };
    const service = new PaymentCallbackEffectService(model as any);

    await expect(service.executeOnce('reused-key', 'EMAIL_CONFIRMATION', 'reserve-1', 'approved', jest.fn())).rejects.toThrow('Idempotency-Key was already used');
  });
});
