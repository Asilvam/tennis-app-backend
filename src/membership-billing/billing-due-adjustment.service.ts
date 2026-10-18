import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { Register } from '../register/entities/register.entity';
import { AuditLog } from '../audit-log/entities/audit-log.entity';
import { MembershipDue } from './entities/membership-due.entity';
import { MembershipPayment } from './entities/membership-payment.entity';
import { MembershipBillingConfig } from './entities/membership-billing-config.entity';
import { BILLING_CLOCK } from './membership-billing.service';
import { BILLING_CONFIG_KEY, BillingMember } from './billing.types';
import { memberType, monthAt, priceFor } from './billing.policy';

@Injectable()
export class BillingDueAdjustmentService {
  constructor(
    @InjectModel(MembershipDue.name) private readonly dues: Model<MembershipDue>,
    @InjectModel(MembershipPayment.name) private readonly payments: Model<MembershipPayment>,
    @InjectModel(MembershipBillingConfig.name)
    private readonly configs: Model<MembershipBillingConfig>,
    @InjectModel(Register.name) private readonly members: Model<Register>,
    @InjectModel(AuditLog.name) private readonly audit: Model<AuditLog>,
    @Inject(BILLING_CLOCK) private readonly clock: () => Date,
  ) {}

  // The caller holds the member write lock inside the membership-change transaction.
  async repriceOpenDues(member: BillingMember, actorEmail: string, session: ClientSession) {
    const now = this.clock();
    const type = memberType(member);
    const rows = await this.dues
      .find({
        beneficiaryId: member._id,
        status: 'OPEN',
        period: { $gte: monthAt(now) },
        memberTypeSnapshot: { $ne: type },
      })
      .session(session)
      .lean();
    if (!rows.length) return 0;
    const actor =
      actorEmail &&
      (await this.members
        .findOne({ email: actorEmail.trim().toLowerCase(), statePlayer: true, role: 'admin' })
        .session(session)
        .lean());
    if (!actor)
      throw new ForbiddenException('Se requiere un administrador activo para ajustar cuotas.');
    const config = await this.configs.findOne({ key: BILLING_CONFIG_KEY }).session(session).lean();
    if (!config) throw new ServiceUnavailableException('Falta la configuracion de mensualidades.');
    const activePayment = await this.payments
      .exists({
        method: 'MERCADO_PAGO',
        'allocations.dueId': { $in: rows.map((row) => row._id) },
        $or: [
          { status: { $in: ['PENDING', 'REVIEW_REQUIRED'] } },
          { 'checkout.creationStatus': { $in: ['CREATING', 'UNKNOWN'] } },
          { status: { $in: ['REJECTED', 'CANCELLED'] }, 'checkout.expiresAt': { $gt: now } },
        ],
      })
      .session(session);
    if (activePayment)
      throw new ConflictException({
        code: 'MEMBERSHIP_CHECKOUT_IN_PROGRESS',
        message:
          'Hay un pago de mensualidades en curso o en revision. Resuelvelo antes de cambiar el tipo de socio.',
      });
    for (const row of rows) {
      const price = priceFor(member, row.period, config);
      if (
        price.pricingMode !== row.pricingMode ||
        price.currency !== row.currency ||
        price.tariffVersionId !== row.tariffVersionId
      )
        throw new ConflictException(
          'La tarifa original requiere revision administrativa antes de ajustar cuotas.',
        );
      // Only this audited path may amend frozen pricing, and only while the due is open.
      const result = await this.dues.collection.updateOne(
        {
          _id: row._id,
          status: 'OPEN',
          amount: row.amount,
          memberTypeSnapshot: row.memberTypeSnapshot,
          settlementPaymentId: { $exists: false },
          paidAt: { $exists: false },
        },
        {
          $set: { amount: price.amount, memberTypeSnapshot: type, updatedAt: now },
        },
        { session },
      );
      if (result.modifiedCount !== 1)
        throw new ConflictException('Una cuota cambio durante el ajuste.');
      await this.audit.create(
        [
          {
            eventId: `membership:due-adjustment:${randomUUID()}`,
            entityType: 'MEMBERSHIP_PAYMENT',
            entityId: String(row._id),
            action: 'UPDATE',
            performedBy: 'ADMIN',
            performedByUser: actor.namePlayer,
            performedByEmail: actor.email,
            description: 'Cuota pendiente ajustada por cambio de tipo de socio.',
            timestamp: now,
            beforeData: {
              dueId: String(row._id),
              beneficiaryId: String(member._id),
              period: row.period,
              amount: row.amount,
              memberTypeSnapshot: row.memberTypeSnapshot,
            },
            afterData: {
              amount: price.amount,
              memberTypeSnapshot: type,
              pricingMode: row.pricingMode,
              tariffVersionId: row.tariffVersionId,
            },
            metadata: { reason: 'MEMBERSHIP_TYPE_DUE_ADJUSTMENT' },
          },
        ],
        { session },
      );
    }
    return rows.length;
  }
}
