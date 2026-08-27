import { AuditLogService } from './audit-log.service';

describe('AuditLogService payment persistence', () => {
  it('uses an append-only idempotent upsert keyed by eventId', async () => {
    const exec = jest.fn().mockResolvedValue({ upsertedCount: 1 });
    const model = { updateOne: jest.fn().mockReturnValue({ exec }) };
    const service = new AuditLogService(model as any);

    await service.logPaymentEffect('reserve-1', 'effect-1', 'PAYMENT_CONFIRMATION', 'approved', 'PROCESSED');

    expect(model.updateOne).toHaveBeenCalledWith(
      { eventId: 'effect-1' },
      {
        $setOnInsert: expect.objectContaining({
          eventId: 'effect-1',
          entityId: 'reserve-1',
          action: 'PAYMENT_CONFIRMATION',
          metadata: { paymentStatus: 'approved', outcome: 'PROCESSED' },
        }),
      },
      { upsert: true },
    );
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('propagates persistence failures so the caller can retry only the audit', async () => {
    const model = { updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockRejectedValue(new Error('Mongo unavailable')) }) };
    const service = new AuditLogService(model as any);

    await expect(service.logPaymentEffect('reserve-1', 'effect-1', 'STATE_CHANGE', 'approved', 'PROCESSED')).rejects.toThrow('Mongo unavailable');
  });
});
