import { Logger } from '@nestjs/common';
import { BillingNotificationsService } from './billing-notifications.service';

function query(value: unknown) {
  return {
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('BillingNotificationsService', () => {
  let now: Date;
  let model: Record<string, jest.Mock>;
  let email: { sendEmail: jest.Mock };
  let config: { get: jest.Mock };
  let worker: BillingNotificationsService;
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;
  const id = '000000000000000000000001';
  const eventKey = 'membership-fixture:confirmed';
  const payment = () => ({
    _id: id,
    publicReference: 'membership-fixture',
    method: 'BANK_TRANSFER',
    status: 'CONFIRMED',
    amount: 180,
    payer: { name: 'Fixture', email: 'payer@example.invalid' },
    allocations: [{ beneficiaryName: 'Fixture', period: '2026-10', amount: 180 }],
    notifications: [
      {
        recipient: 'payer@example.invalid',
        eventKey,
        kind: 'CONFIRMED',
        status: 'PROCESSING',
        attempts: 1,
      },
    ],
  });
  const enqueue = (value = payment()) => {
    model.find.mockReturnValue(query([value]));
    model.findOneAndUpdate.mockReturnValue(query(value));
  };
  const failAt = (method: string, error: unknown) => {
    const result = query(null);
    result.exec.mockRejectedValueOnce(error);
    model[method].mockReturnValueOnce(result);
  };

  beforeEach(() => {
    now = new Date('2026-10-30T12:00:00Z');
    model = {
      updateMany: jest.fn(() => query({ modifiedCount: 0 })),
      find: jest.fn(() => query([])),
      findOneAndUpdate: jest.fn(() => query(null)),
      updateOne: jest.fn(() => query({ modifiedCount: 1 })),
    };
    email = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    config = { get: jest.fn().mockReturnValue('true') };
    worker = new BillingNotificationsService(model as any, email as any, config as any, () => now);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('does not send or mutate payments when the queue is empty', async () => {
    await worker.drain();
    expect(model.find.mock.calls[0][0].method.$in).toEqual([
      'BANK_TRANSFER',
      'BANK_DEPOSIT',
      'CASH',
      'MERCADO_PAGO',
    ]);
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(model.updateOne).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('preserves the existing Mercado Pago-only mode when admin billing is disabled', async () => {
    config.get.mockReturnValue('false');
    await worker.drain();
    expect(model.find.mock.calls[0][0].method.$in).toEqual(['MERCADO_PAGO']);
  });

  it('sends with the stable idempotency key and only updates notification fields', async () => {
    enqueue();
    await worker.drain();
    expect(email.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'payer@example.invalid',
        subject: 'Mensualidades pagadas - CTQ',
      }),
      eventKey,
      15000,
    );
    expect(model.updateOne).toHaveBeenCalledWith(
      { _id: id, 'notifications.eventKey': eventKey },
      {
        $set: { 'notifications.$.status': 'SENT', 'notifications.$.sentAt': now },
        $unset: { 'notifications.$.lastError': '', 'notifications.$.lockedAt': '' },
      },
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('skips a notification claimed by another worker', async () => {
    enqueue();
    model.findOneAndUpdate.mockReturnValue(query(null));
    await worker.drain();
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('cancels obsolete confirmation notices without sending', async () => {
    enqueue({ ...payment(), status: 'REVERSED' });
    await worker.drain();
    expect(email.sendEmail).not.toHaveBeenCalled();
    expect(model.updateOne.mock.calls[0][1]).toEqual({
      $set: { 'notifications.$.status': 'CANCELLED' },
    });
  });

  it('sends a reversal notice with the existing email template', async () => {
    const value = payment();
    value.status = 'REVERSED';
    value.notifications[0].kind = 'REVERSED';
    enqueue(value);
    await worker.drain();
    expect(email.sendEmail.mock.calls[0][0].subject).toBe('Registro de pago anulado - CTQ');
  });

  it.each([
    ['updateMany', 'recover-expired-leases'],
    ['find', 'find-pending'],
    ['findOneAndUpdate', 'claim-notification'],
    ['updateOne', 'cancel-obsolete'],
  ])('identifies database failure at %s without leaking raw error data', async (method, phase) => {
    enqueue({ ...payment(), status: 'REVERSED' });
    failAt(
      method,
      Object.assign(new Error('mongodb://private:secret@host payer@example.invalid'), {
        name: 'MongoServerError',
        code: 13,
      }),
    );
    await expect(worker.drain()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        phase,
        errorType: 'MongoServerError',
        code: 13,
        retryInMs: 30000,
      }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret|mongodb:|payer@/);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('backs off queue failures up to five minutes and resets after recovery', async () => {
    const bad = query(null);
    bad.exec.mockRejectedValue(new Error('database offline'));
    model.updateMany.mockReturnValue(bad);
    for (const delay of [30000, 60000, 120000, 240000, 300000, 300000]) {
      const before = model.updateMany.mock.calls.length;
      await worker.drain();
      expect(warn).toHaveBeenLastCalledWith(expect.objectContaining({ retryInMs: delay }));
      now = new Date(now.getTime() + delay - 1);
      await worker.drain();
      expect(model.updateMany).toHaveBeenCalledTimes(before + 1);
      now = new Date(now.getTime() + 1);
    }
    model.updateMany.mockReturnValue(query({ modifiedCount: 0 }));
    await worker.drain();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ previousFailures: 6 }));
    failAt('updateMany', new Error('offline again'));
    await worker.drain();
    expect(warn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        consecutiveFailures: 1,
        retryInMs: 30000,
      }),
    );
  });

  it('does not overlap scheduled cycles in the same instance', async () => {
    let complete: (value: unknown) => void;
    const result = query(null);
    result.exec.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    model.updateMany.mockReturnValueOnce(result);
    const first = worker.drain();
    await worker.drain();
    expect(model.updateMany).toHaveBeenCalledTimes(1);
    complete({ modifiedCount: 0 });
    await first;
    await worker.drain();
    expect(model.updateMany).toHaveBeenCalledTimes(2);
  });

  it('records a sanitized delivery failure with retry time without changing the financial state', async () => {
    enqueue();
    email.sendEmail.mockRejectedValue(
      Object.assign(new Error('private provider body token=secret'), {
        name: 'AxiosError',
        code: 'ERR_BAD_RESPONSE',
        response: { status: 503, data: 'secret' },
      }),
    );
    await worker.drain();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'send-email',
        attempt: 1,
        exhausted: false,
        errorType: 'AxiosError',
        code: 'ERR_BAD_RESPONSE',
        httpStatus: 503,
        nextAttemptAt: '2026-10-30T12:01:00.000Z',
      }),
    );
    const update = model.updateOne.mock.calls[0][1];
    expect(update.$set['notifications.$.status']).toBe('FAILED');
    expect(update.$set['notifications.$.nextAttemptAt']).toEqual(new Date(now.getTime() + 60000));
    expect(Object.keys(update.$set).every((key) => key.startsWith('notifications.'))).toBe(true);
    expect(JSON.stringify([warn.mock.calls, update])).not.toMatch(/secret|payer@|private provider/);
  });

  it('logs delivery failure before a failed database update, retaining both diagnostics', async () => {
    enqueue();
    email.sendEmail.mockRejectedValue(
      Object.assign(new Error('offline'), { code: 'ECONNREFUSED' }),
    );
    failAt('updateOne', Object.assign(new Error('db offline'), { name: 'MongoNetworkError' }));
    await worker.drain();
    expect(warn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ phase: 'send-email', code: 'ECONNREFUSED' }),
    );
    expect(warn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        phase: 'persist-delivery-failure',
        errorType: 'MongoNetworkError',
      }),
    );
  });

  it('does not misclassify an acknowledgement failure as an email failure or immediately resend', async () => {
    enqueue();
    failAt('updateOne', Object.assign(new Error('db offline'), { name: 'MongoNetworkError' }));
    await worker.drain();
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(model.updateOne).toHaveBeenCalledTimes(1);
    expect(model.updateOne.mock.calls[0][1].$set['notifications.$.status']).toBe('SENT');
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ phase: 'persist-sent' }));
    await worker.drain();
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('does not advertise another automatic delivery attempt after attempt six', async () => {
    const value = payment();
    value.notifications[0].attempts = 6;
    enqueue(value);
    email.sendEmail.mockRejectedValue(new Error('offline'));
    await worker.drain();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ exhausted: true, attempt: 6 }));
    expect(warn.mock.calls[0][0]).not.toHaveProperty('nextAttemptAt');
    expect(model.find.mock.calls[0][0].notifications.$elemMatch.attempts).toEqual({ $lt: 6 });
  });

  it.each([
    null,
    'private text',
    { name: 'secret', code: 'secret', response: { status: 'secret' } },
  ])('handles unknown thrown values without serializing them: %p', async (error) => {
    failAt('updateMany', error);
    await worker.drain();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ errorType: 'UnknownError' }));
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private text|secret/);
  });

  it('recognizes Mongoose buffering timeout without printing the query', async () => {
    failAt(
      'updateMany',
      Object.assign(new Error('Operation private-query buffering timed out after 10000ms'), {
        name: 'MongooseError',
      }),
    );
    await worker.drain();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ hint: 'mongoose-buffer-timeout' }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-query');
  });

  it('reads the original transport cause preserved by EmailService', async () => {
    enqueue();
    const error = new Error('wrapper private message');
    Object.defineProperty(error, 'cause', {
      value: {
        name: 'AxiosError',
        code: 'ECONNABORTED',
        response: { status: 504, data: 'private body' },
      },
    });
    email.sendEmail.mockRejectedValue(error);
    await worker.drain();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'send-email',
        errorType: 'AxiosError',
        code: 'ECONNABORTED',
        httpStatus: 504,
      }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
  });

  it('identifies missing email configuration without exposing configuration values', async () => {
    enqueue();
    email.sendEmail.mockRejectedValue(new Error('Email service is not configured'));
    await worker.drain();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ hint: 'email-service-not-configured' }),
    );
  });
});
