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
  constructor(
    @InjectModel(MembershipPayment.name) private readonly payments: Model<MembershipPayment>,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    @Inject(BILLING_CLOCK) private readonly clock: () => Date,
  ) {}

  @Interval(30000)
  async drain() {
    if (this.running) return;
    const methods =
      this.config.get<string>('MEMBERSHIP_BILLING_ADMIN_ENABLED') === 'true'
        ? ['BANK_TRANSFER', 'BANK_DEPOSIT', 'MERCADO_PAGO']
        : ['MERCADO_PAGO'];
    this.running = true;
    try {
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
            await this.payments
              .updateOne(
                { _id: row._id, 'notifications.eventKey': claimed.eventKey },
                { $set: { 'notifications.$.status': 'CANCELLED' } },
              )
              .exec();
            continue;
          }
          try {
            await this.email.sendEmail(
              {
                to: claimed.recipient,
                ...buildMembershipPaymentEmail(payment, claimed.kind === 'REVERSED'),
              },
              claimed.eventKey,
              15000,
            );
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
          } catch {
            await this.payments
              .updateOne(
                { _id: row._id, 'notifications.eventKey': claimed.eventKey },
                {
                  $set: {
                    'notifications.$.status': 'FAILED',
                    'notifications.$.lastError': 'No se pudo enviar el aviso.',
                    'notifications.$.nextAttemptAt': new Date(
                      this.clock().getTime() + Math.min(3600000, 30000 * 2 ** claimed.attempts),
                    ),
                  },
                  $unset: { 'notifications.$.lockedAt': '' },
                },
              )
              .exec();
            this.logger.warn(`Aviso de mensualidad pendiente: ${payment.publicReference}`);
          }
        }
      }
    } catch {
      this.logger.warn('No se pudieron procesar los avisos pendientes de mensualidades.');
    } finally {
      this.running = false;
    }
  }
}
