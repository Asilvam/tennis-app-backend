import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { EmailService } from '../email/email.service';
import { MembershipPayment } from './entities/membership-payment.entity';
import { BILLING_CLOCK } from './membership-billing.service';
import { buildMembershipPaymentEmail } from './billing-payment-email';

@Injectable()
export class BillingNotificationsService {
  private readonly logger = new Logger(BillingNotificationsService.name);
  private running = false;
  private failures = 0;
  private retryAfter = 0;
  constructor(
    @InjectModel(MembershipPayment.name) private readonly payments: Model<MembershipPayment>,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    @Inject(BILLING_CLOCK) private readonly clock: () => Date,
  ) {}

  @Interval(30000)
  async drain() {
    if (this.running || this.clock().getTime() < this.retryAfter) return;
    this.running = true;
    let phase = 'recover-expired-leases';
    try {
      const methods =
        this.config.get<string>('MEMBERSHIP_BILLING_ADMIN_ENABLED') === 'true'
          ? ['BANK_TRANSFER', 'BANK_DEPOSIT', 'CASH', 'MERCADO_PAGO']
          : ['MERCADO_PAGO'];
      const now = this.clock();
      const expired = new Date(now.getTime() - 5 * 60000);
      await this.payments
        .updateMany(
          {
            method: { $in: methods },
            notifications: {
              $elemMatch: {
                status: 'PROCESSING',
                attempts: { $gte: 6 },
                lockedAt: { $lte: expired },
              },
            },
          },
          {
            $set: {
              'notifications.$[note].status': 'FAILED',
              'notifications.$[note].lastError': 'Se agoto el limite de reintentos.',
            },
            $unset: { 'notifications.$[note].lockedAt': '' },
          },
          {
            arrayFilters: [
              {
                'note.status': 'PROCESSING',
                'note.attempts': { $gte: 6 },
                'note.lockedAt': { $lte: expired },
              },
            ],
          },
        )
        .exec();
      const eligible = {
        attempts: { $lt: 6 },
        $or: [
          { status: { $in: ['PENDING', 'FAILED'] }, nextAttemptAt: { $lte: now } },
          { status: 'PROCESSING', lockedAt: { $lte: expired } },
        ],
      };
      phase = 'find-pending';
      const rows = await this.payments
        .find({
          method: { $in: methods },
          notifications: { $elemMatch: eligible },
        })
        .limit(20)
        .lean()
        .exec();
      for (const row of rows) {
        for (const note of row.notifications) {
          phase = 'claim-notification';
          const payment = await this.payments
            .findOneAndUpdate(
              {
                _id: row._id,
                notifications: { $elemMatch: { ...eligible, eventKey: note.eventKey } },
              },
              {
                $set: { 'notifications.$.status': 'PROCESSING', 'notifications.$.lockedAt': now },
                $inc: { 'notifications.$.attempts': 1 },
              },
              { new: true },
            )
            .lean()
            .exec();
          if (!payment) continue;
          const claimed = payment.notifications.find((item) => item.eventKey === note.eventKey);
          if (claimed.kind === 'CONFIRMED' && payment.status !== 'CONFIRMED') {
            phase = 'cancel-obsolete';
            await this.payments
              .updateOne(
                { _id: row._id, 'notifications.eventKey': claimed.eventKey },
                { $set: { 'notifications.$.status': 'CANCELLED' } },
              )
              .exec();
            continue;
          }
          phase = 'send-email';
          try {
            await this.email.sendEmail(
              {
                to: claimed.recipient,
                ...buildMembershipPaymentEmail(payment, claimed.kind === 'REVERSED'),
              },
              claimed.eventKey,
              15000,
            );
          } catch (error) {
            const retryAt = new Date(
              this.clock().getTime() + Math.min(3600000, 30000 * 2 ** claimed.attempts),
            );
            const diagnostic = this.safeDiagnostic(error);
            this.logger.warn({
              message: 'No se pudo enviar el aviso de mensualidad.',
              phase,
              paymentId: String(row._id),
              attempt: claimed.attempts,
              exhausted: claimed.attempts >= 6,
              ...(claimed.attempts < 6 ? { nextAttemptAt: retryAt.toISOString() } : {}),
              ...diagnostic,
            });
            phase = 'persist-delivery-failure';
            await this.payments
              .updateOne(
                { _id: row._id, 'notifications.eventKey': claimed.eventKey },
                {
                  $set: {
                    'notifications.$.status': 'FAILED',
                    'notifications.$.lastError': JSON.stringify(diagnostic),
                    'notifications.$.nextAttemptAt': retryAt,
                  },
                  $unset: { 'notifications.$.lockedAt': '' },
                },
              )
              .exec();
            continue;
          }
          // A persistence failure after delivery must not be classified as a send failure.
          phase = 'persist-sent';
          await this.payments
            .updateOne(
              { _id: row._id, 'notifications.eventKey': claimed.eventKey },
              {
                $set: {
                  'notifications.$.status': 'SENT',
                  'notifications.$.sentAt': this.clock(),
                },
                $unset: { 'notifications.$.lastError': '', 'notifications.$.lockedAt': '' },
              },
            )
            .exec();
        }
      }
      if (this.failures) {
        this.logger.log({
          message: 'Se recupero el procesamiento de avisos de mensualidades.',
          previousFailures: this.failures,
        });
      }
      this.failures = 0;
      this.retryAfter = 0;
    } catch (error) {
      this.failures += 1;
      const retryInMs = Math.min(300000, 30000 * 2 ** Math.min(this.failures - 1, 4));
      this.retryAfter = this.clock().getTime() + retryInMs;
      this.logger.warn({
        message: 'No se pudieron procesar los avisos pendientes de mensualidades.',
        phase,
        consecutiveFailures: this.failures,
        retryInMs,
        ...this.safeDiagnostic(error),
      });
    } finally {
      this.running = false;
    }
  }

  private safeDiagnostic(error: unknown) {
    const cause = (error as { cause?: unknown })?.cause;
    const value = (cause && typeof cause === 'object' ? cause : error) as {
      name?: string;
      code?: unknown;
      message?: string;
      response?: { status?: number };
    };
    const knownNames = [
      'Error',
      'TypeError',
      'MongoServerError',
      'MongoNetworkError',
      'MongoNetworkTimeoutError',
      'MongoServerSelectionError',
      'MongooseServerSelectionError',
      'MongooseError',
      'MongoNotConnectedError',
      'MongoTopologyClosedError',
      'ValidationError',
      'CastError',
      'AxiosError',
      'AggregateError',
    ];
    const knownCodes = [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'ECONNABORTED',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ERR_NETWORK',
      'ERR_BAD_RESPONSE',
      'ERR_BAD_REQUEST',
      'ERR_CANCELED',
    ];
    const code =
      typeof value?.code === 'number' && Number.isSafeInteger(value.code)
        ? value.code
        : knownCodes.includes(value?.code as string)
          ? value.code
          : undefined;
    const status = value?.response?.status;
    const hint =
      typeof value?.message === 'string' && /buffering timed out/i.test(value.message)
        ? 'mongoose-buffer-timeout'
        : value?.message === 'Email service is not configured'
          ? 'email-service-not-configured'
          : undefined;
    // Never log raw messages, stacks, connection URIs, HTTP bodies or recipients.
    return {
      errorType: knownNames.includes(value?.name) ? value.name : 'UnknownError',
      ...(code !== undefined ? { code } : {}),
      ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { httpStatus: status } : {}),
      ...(hint ? { hint } : {}),
    };
  }
}
