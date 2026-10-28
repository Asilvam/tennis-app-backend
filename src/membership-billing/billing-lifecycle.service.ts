import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { ClientSession, Model } from 'mongoose';
import { createHash } from 'crypto';
import { Register } from '../register/entities/register.entity';
import { AuditLog } from '../audit-log/entities/audit-log.entity';
import { MembershipDue } from './entities/membership-due.entity';
import { MembershipPayment } from './entities/membership-payment.entity';
import { MembershipBillingConfig } from './entities/membership-billing-config.entity';
import { BILLING_CLOCK, MembershipBillingService } from './membership-billing.service';
import { MembershipMpService } from './billing-mp.service';
import { BILLING_CONFIG_KEY, BILLING_TIMEZONE, BillingDue, BillingMember } from './billing.types';
import { assertConfiguration, isBillablePeriod, monthAt, periodsBetween } from './billing.policy';
import { overdueClosure } from './billing-lifecycle.policy';
import { uncertainMembershipPaymentFilter } from './billing-payment-state.policy';

@Injectable()
export class BillingLifecycleService implements OnApplicationBootstrap {
  private running = false;
  private readonly logger = new Logger(BillingLifecycleService.name);

  constructor(
    private readonly core: MembershipBillingService,
    @InjectModel(MembershipDue.name) private readonly dues: Model<MembershipDue>,
    @InjectModel(MembershipPayment.name) private readonly payments: Model<MembershipPayment>,
    @InjectModel(MembershipBillingConfig.name)
    private readonly configs: Model<MembershipBillingConfig>,
    @InjectModel(Register.name) private readonly members: Model<Register>,
    @InjectModel(AuditLog.name) private readonly audit: Model<AuditLog>,
    private readonly mp: MembershipMpService,
    private readonly settings: ConfigService,
    @Inject(BILLING_CLOCK) private readonly clock: () => Date,
  ) {}

  async onApplicationBootstrap() {
    await this.tick();
  }

  private uncertain(now: Date) {
    return uncertainMembershipPaymentFilter(now);
  }

  private async configuration(session?: ClientSession) {
    const config = await this.configs
      .findOne({ key: BILLING_CONFIG_KEY })
      .session(session || null)
      .lean();
    if (config) assertConfiguration(config);
    return config;
  }

  private async indexesReady() {
    for (const [model, fields] of [
      [this.dues, 'beneficiaryId,period'],
      [this.audit, 'eventId'],
    ] as const) {
      const indexes = await model.collection.indexes();
      if (!indexes.some((row) => row.unique && Object.keys(row.key).join(',') === fields))
        throw new ServiceUnavailableException(
          'Revisa los indices antes de automatizar mensualidades.',
        );
    }
  }

  private async reviewReasons(
    member: BillingMember,
    rows: BillingDue[],
    now: Date,
    session?: ClientSession,
  ) {
    const closure = overdueClosure(member, rows, monthAt(now), now);
    if (!closure) return { closure: null, reasons: [], references: [] };
    const reasons: string[] = [];
    if (!member.billingPeriods?.length) reasons.push('BILLING_HISTORY_REQUIRES_REVIEW');
    const pending = await this.payments
      .find({
        'allocations.beneficiaryId': member._id,
        ...this.uncertain(now),
      })
      .session(session || null)
      .select('publicReference')
      .lean();
    if (pending.length) reasons.push('PAYMENT_RECONCILIATION_REQUIRED');
    if (rows.some((row) => row.status === 'PAID' && row.period > closure.throughPeriod))
      reasons.push('PREPAID_PERIOD_REQUIRES_REVIEW');
    if (
      await this.payments
        .exists({
          'allocations.beneficiaryId': member._id,
          status: 'REVERSED',
          'allocations.period': { $in: closure.overduePeriods },
        })
        .session(session || null)
    )
      reasons.push('REVERSED_PAYMENT_REQUIRES_REVIEW');
    return { closure, reasons, references: pending.map((row) => row.publicReference).sort() };
  }

  async preview(email: string) {
    const admin = await this.members.findOne({ email, role: 'admin', statePlayer: true }).lean();
    if (!admin) throw new ForbiddenException('Se requiere un administrador activo.');
    const config = await this.configuration();
    if (!config)
      throw new ServiceUnavailableException('Mensualidades pendientes de configuracion.');
    const now = this.clock();
    const through = monthAt(now);
    const items = [];
    // Read-only: no due generation, provider requests, locks or audit writes in a preview.
    for await (const member of this.members
      .find({ statePlayer: true, billingStartPeriod: { $exists: true } })
      .select('+billingPeriods')
      .lean()
      .cursor()) {
      try {
        const rows = await this.dues.find({ beneficiaryId: member._id }).lean();
        const missing = periodsBetween(member.billingStartPeriod, through).filter(
          (period) =>
            isBillablePeriod(member, period) && !rows.some((row) => row.period === period),
        );
        const review = await this.reviewReasons(member, rows, now);
        items.push({
          memberId: String(member._id),
          name: member.namePlayer,
          missingPeriods: missing,
          closure: review.closure,
          reviewReasons: review.reasons,
          exempt: member.role === 'admin',
        });
      } catch {
        items.push({ memberId: String(member._id), reviewReasons: ['INVALID_BILLING_DATA'] });
      }
    }
    return { enabled: config.automation?.enabled === true, period: through, items };
  }

  private async record(
    eventId: string,
    memberId: string,
    reason: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    session: ClientSession,
    now: Date,
  ) {
    if (await this.audit.exists({ eventId }).session(session)) return;
    await this.audit.create(
      [
        {
          eventId,
          entityType: 'MEMBERSHIP_PAYMENT',
          entityId: memberId,
          action: 'STATE_CHANGE',
          performedBy: 'SYSTEM',
          performedByUser: 'Mensualidades CTQ',
          description: reason,
          metadata: { reason },
          beforeData: before,
          afterData: after,
          timestamp: now,
        },
      ],
      { session },
    );
  }

  async processMember(id: string, now = this.clock()) {
    await this.indexesReady();
    return this.members.db.transaction(async (session) => {
      const config = await this.configuration(session);
      if (!config?.automation?.enabled) return { outcome: 'DISABLED' };
      const member = await this.members
        .findById(id)
        .select('+billingPeriods +billingClosure')
        .session(session)
        .lean();
      if (!member?.statePlayer || !member.billingStartPeriod) return { outcome: 'SKIPPED' };
      const before = await this.dues.find({ beneficiaryId: member._id }).session(session).lean();
      await this.core.ensureMemberDues(member, monthAt(now), config, session);
      const rows = await this.dues.find({ beneficiaryId: member._id }).session(session).lean();
      const created = rows.filter(
        (row) => !before.some((old) => String(old._id) === String(row._id)),
      );
      if (created.length) {
        const fingerprint = createHash('sha256')
          .update(
            created
              .map((row) => String(row._id))
              .sort()
              .join(','),
          )
          .digest('hex');
        await this.record(
          `membership:generation:${id}:${fingerprint}`,
          id,
          'MEMBERSHIP_MONTHLY_GENERATION',
          {},
          {
            periods: created.map((row) => row.period),
            dueIds: created.map((row) => String(row._id)),
          },
          session,
          now,
        );
      }
      const { closure, reasons, references } = await this.reviewReasons(member, rows, now, session);
      if (!closure) return { outcome: 'GENERATED', created: created.length };
      if (reasons.length) {
        const fingerprint = createHash('sha256')
          .update(JSON.stringify({ reasons, references }))
          .digest('hex');
        await this.record(
          `membership:closure-review:${id}:${closure.throughPeriod}:${fingerprint}`,
          id,
          'MEMBERSHIP_CLOSURE_REVIEW',
          {},
          { ...closure, reasons, references },
          session,
          now,
        );
        return { outcome: 'REVIEW_REQUIRED', reasons, created: created.length };
      }
      // Lock the deciding dues as well as the member: a concurrent verified payment must retry this decision.
      await this.dues.updateMany(
        { beneficiaryId: member._id, period: { $in: closure.overduePeriods } },
        { $inc: { __v: 1 } },
        { session },
      );
      const intervals = member.billingPeriods.map((interval, index) =>
        index === member.billingPeriods.length - 1
          ? {
              ...interval,
              throughPeriod: closure.throughPeriod,
              closedAt: closure.effectiveAt,
              closureReason: 'THREE_CONSECUTIVE_OVERDUE',
            }
          : interval,
      );
      const future = rows.filter(
        (row) => row.period > closure.throughPeriod && row.status === 'OPEN',
      );
      const voided = { at: now, effectiveAt: closure.effectiveAt, reason: 'MEMBERSHIP_TERMINATED' };
      await this.dues.updateMany(
        { _id: { $in: future.map((row) => row._id) }, status: 'OPEN' },
        { $set: { status: 'VOID', voided } },
        { session, runValidators: true },
      );
      await this.members.updateOne(
        { _id: member._id, statePlayer: true, role: { $ne: 'admin' } },
        {
          $set: {
            statePlayer: false,
            billingPeriods: intervals,
            billingClosure: { ...closure, processedAt: now, reason: 'THREE_CONSECUTIVE_OVERDUE' },
          },
          $inc: { __v: 1 },
        },
        { session, runValidators: true },
      );
      await this.record(
        `membership:closure:${id}:${closure.throughPeriod}`,
        id,
        'MEMBERSHIP_AUTOMATIC_TERMINATION',
        { active: true, futureDues: future },
        { active: false, ...closure, voidedDueIds: future.map((row) => String(row._id)) },
        session,
        now,
      );
      return { outcome: 'TERMINATED', ...closure, voided: future.length, created: created.length };
    });
  }

  @Cron('0 0 * * * *', { timeZone: BILLING_TIMEZONE })
  async tick() {
    if (this.running || this.settings.get('MEMBERSHIP_BILLING_ADMIN_ENABLED') !== 'true') return;
    this.running = true;
    try {
      const config = await this.configuration();
      if (!config?.automation?.enabled) return;
      await this.indexesReady();
      const now = this.clock();
      for await (const member of this.members
        .find({ statePlayer: true, billingStartPeriod: { $exists: true } })
        .select('_id')
        .lean()
        .cursor()) {
        try {
          const pending = await this.payments
            .find({
              'allocations.beneficiaryId': member._id,
              ...this.uncertain(now),
            })
            .select('publicReference')
            .limit(5)
            .lean();
          for (const payment of pending) {
            try {
              await this.mp.reconcileForBilling(payment.publicReference);
            } catch {
              /* Uncertain evidence remains a review hold, never grounds for termination. */
            }
          }
          await this.processMember(String(member._id), now);
        } catch (error) {
          this.logger.error(`Monthly processing failed member=${member._id}: ${error.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Monthly processing unavailable: ${error.message}`);
    } finally {
      this.running = false;
    }
  }
}
