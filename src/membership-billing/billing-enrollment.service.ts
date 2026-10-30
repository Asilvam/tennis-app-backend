import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { createHash } from 'crypto';
import { Register } from '../register/entities/register.entity';
import { AuditLog } from '../audit-log/entities/audit-log.entity';
import { MembershipDue } from './entities/membership-due.entity';
import { MembershipPayment } from './entities/membership-payment.entity';
import { MembershipBillingConfig } from './entities/membership-billing-config.entity';
import { BILLING_CONFIG_KEY } from './billing.types';
import { BILLING_CLOCK } from './membership-billing.service';
import { BillingAdminService } from './billing-admin.service';
import {
  addMonths,
  assertBillingStart,
  assertConfiguration,
  assertMemberId,
  assertPeriod,
  assertPaymentPeriod,
  monthAt,
} from './billing.policy';
import {
  enrollmentReason,
  enrollmentState,
  initialEnrollmentPlan,
} from './billing-enrollment.policy';
import { uncertainMembershipPaymentFilter } from './billing-payment-state.policy';
import {
  ApplyBatchEnrollmentDto,
  ApproveBillingHistoryDto,
  PreviewBatchEnrollmentDto,
} from './dto/batch-enrollment.dto';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class BillingEnrollmentService {
  constructor(
    private readonly billing: BillingAdminService,
    @InjectModel(Register.name) private readonly members: Model<Register>,
    @InjectModel(MembershipDue.name) private readonly dues: Model<MembershipDue>,
    @InjectModel(MembershipPayment.name) private readonly payments: Model<MembershipPayment>,
    @InjectModel(MembershipBillingConfig.name)
    private readonly configs: Model<MembershipBillingConfig>,
    @InjectModel(AuditLog.name) private readonly audit: Model<AuditLog>,
    @Inject(BILLING_CLOCK) private readonly clock: () => Date,
  ) {}

  private async actor(email: string, session?: ClientSession) {
    if (typeof email !== 'string' || !email.trim())
      throw new ForbiddenException('Se requiere un administrador activo.');
    const actor = await this.members
      .findOne({ email: email?.trim().toLowerCase(), role: 'admin', statePlayer: true })
      .session(session || null)
      .lean();
    if (!actor) throw new ForbiddenException('Se requiere un administrador activo.');
    return actor;
  }
  private async config(session?: ClientSession) {
    const config = await this.configs
      .findOne({ key: BILLING_CONFIG_KEY })
      .session(session || null)
      .lean();
    if (!config)
      throw new ServiceUnavailableException('Mensualidades pendientes de configuracion.');
    assertConfiguration(config);
    return config;
  }
  private validateKey(key: string) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(key))
      throw new BadRequestException('Falta una clave de idempotencia valida.');
  }
  private async auditReady() {
    const indexes = await this.audit.collection.indexes();
    if (!indexes.some((row) => row.unique && Object.keys(row.key).join(',') === 'eventId'))
      throw new ServiceUnavailableException('Revisa el indice unico de auditoria.');
  }

  async previewBatch(email: string, input: PreviewBatchEnrollmentDto) {
    await this.actor(email);
    const config = await this.config();
    assertPeriod(input.startPeriod);
    const now = this.clock();
    const throughPeriod = input.throughPeriod ?? monthAt(now);
    assertPeriod(throughPeriod);
    assertPaymentPeriod(throughPeriod, now, 'admin');
    if (throughPeriod < input.startPeriod)
      throw new BadRequestException('El mes final es anterior al inicio.');
    if (
      input.startPeriod < config.billingStartsAtPeriod ||
      input.startPeriod > monthAt(this.clock())
    )
      throw new BadRequestException('Revisa el mes inicial aprobado.');
    if (input.familyMemberId) {
      assertMemberId(input.familyMemberId);
      if (!(await this.members.exists({ _id: input.familyMemberId })))
        throw new NotFoundException('Socio no encontrado.');
    }
    const filter = input.familyMemberId
      ? { $or: [{ _id: input.familyMemberId }, { titularId: input.familyMemberId }] }
      : { role: { $ne: 'admin' } };
    const people = await this.members
      .find(filter)
      .select('+billingPeriods +billingClosure')
      .sort({ namePlayer: 1, _id: 1 })
      .limit(501)
      .lean();
    if (people.length > 500)
      throw new BadRequestException('El lote admite hasta 500 socios; revisa por familias.');
    const ids = people.map((row) => row._id);
    const dueMembers = await this.dues.distinct('beneficiaryId', { beneficiaryId: { $in: ids } });
    const paymentMembers = await this.payments.distinct('allocations.beneficiaryId', {
      'allocations.beneficiaryId': { $in: ids },
    });
    const finance = new Set([...dueMembers, ...paymentMembers].map(String));
    const parents = await this.members
      .find({
        _id: { $in: people.filter((row) => row.titularId).map((row) => row.titularId) },
        partnerType: 'Titular',
      })
      .select('_id')
      .lean();
    const parentSet = new Set(parents.map((row) => String(row._id)));
    const items = people.map((person) => {
      const state = enrollmentState(
        person,
        finance.has(String(person._id)),
        parentSet.has(String(person.titularId)) && String(person.titularId) !== String(person._id),
      );
      return {
        memberId: String(person._id),
        name: person.namePlayer,
        memberType: person.partnerType,
        active: person.statePlayer,
        ...state,
        ...(state.status === 'ELIGIBLE'
          ? { plan: initialEnrollmentPlan(person, input.startPeriod, config, now, throughPeriod) }
          : {}),
      };
    });
    return {
      startPeriod: input.startPeriod,
      throughPeriod,
      currentPeriod: monthAt(this.clock()),
      minimumStartPeriod: config.billingStartsAtPeriod,
      items,
      counts: {
        eligible: items.filter((row) => row.status === 'ELIGIBLE').length,
        alreadyEnabled: items.filter((row) => row.status === 'ALREADY_ENABLED').length,
        reviewRequired: items.filter((row) => row.status === 'REVIEW_REQUIRED').length,
      },
    };
  }

  async applyBatch(email: string, input: ApplyBatchEnrollmentDto, key: string) {
    this.validateKey(key);
    const actor = await this.actor(email);
    await this.auditReady();
    const reason = enrollmentReason(input.reason);
    if (
      !input.items?.length ||
      input.items.length > 25 ||
      new Set(input.items.map((row) => row.memberId)).size !== input.items.length
    )
      throw new BadRequestException('Revisa seleccion y motivo.');
    assertPeriod(input.startPeriod);
    if (input.throughPeriod !== undefined) {
      assertPeriod(input.throughPeriod);
      assertPaymentPeriod(input.throughPeriod, this.clock(), 'admin');
      if (input.throughPeriod < input.startPeriod)
        throw new BadRequestException('El mes final es anterior al inicio.');
    }
    for (const row of input.items) {
      assertMemberId(row.memberId);
      if (!/^[a-f\d]{64}$/.test(row.approvalHash))
        throw new BadRequestException('Revisa las cuotas antes de confirmar.');
    }
    const canonical = {
      startPeriod: input.startPeriod,
      ...(input.throughPeriod !== undefined ? { throughPeriod: input.throughPeriod } : {}),
      reason,
      items: [...input.items].sort((a, b) => a.memberId.localeCompare(b.memberId)),
    };
    const requestHash = digest(canonical),
      eventId = `membership:enrollment-batch:${actor._id}:${key}`;
    // A durable request permits retries; beneficiary enrollment stays in its existing transaction.
    try {
      await this.members.db.transaction(async (session) => {
        await this.actor(email, session);
        const prior = await this.audit.findOne({ eventId }).session(session).lean();
        if (prior) {
          if (prior.afterData?.requestHash !== requestHash)
            throw new ConflictException('La clave pertenece a otra seleccion.');
          return;
        }
        await this.audit.create(
          [
            {
              eventId,
              entityType: 'MEMBERSHIP_PAYMENT',
              entityId: key,
              action: 'ADMIN_BULK_CREATE',
              performedBy: 'ADMIN',
              performedByEmail: actor.email,
              description: 'Solicitud revisada de habilitacion; no reemplaza socios existentes.',
              afterData: { requestHash, ...canonical },
              metadata: { reason: 'MEMBERSHIP_BATCH_REQUEST' },
              timestamp: this.clock(),
            },
          ],
          { session },
        );
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const prior = await this.audit.findOne({ eventId }).lean();
      if (prior?.afterData?.requestHash !== requestHash)
        throw new ConflictException('La clave pertenece a otra seleccion.');
    }
    const results: { memberId: string; outcome: string; message: string }[] = [];
    for (const row of canonical.items) {
      await this.actor(email);
      try {
        const result = await this.billing.enroll(
          email,
          row.memberId,
          {
            startPeriod: input.startPeriod,
            reason: canonical.reason,
            approvalHash: row.approvalHash,
            ...(input.throughPeriod !== undefined ? { throughPeriod: input.throughPeriod } : {}),
          },
          digest({ actor: String(actor._id), key, memberId: row.memberId }),
        );
        results.push({
          memberId: row.memberId,
          outcome: result.duplicate ? 'SKIPPED' : 'ENROLLED',
          message: result.duplicate
            ? 'Solicitud ya aplicada; sin cambios adicionales.'
            : 'Mensualidades habilitadas.',
        });
      } catch (error) {
        if (error.getStatus?.() === 403) throw error;
        const member = await this.members.findById(row.memberId).select('+billingPeriods').lean();
        const enabled =
          member && enrollmentState(member, false, false).status === 'ALREADY_ENABLED';
        const outcome = enabled
          ? 'SKIPPED'
          : [400, 404, 409].includes(error.getStatus?.())
            ? 'REVIEW_REQUIRED'
            : 'ERROR';
        results.push({
          memberId: row.memberId,
          outcome,
          message: enabled
            ? 'Ya habilitado; se conserva su inicio y registros.'
            : outcome === 'ERROR'
              ? 'No se confirmo la operacion. Reintenta el mismo lote.'
              : 'Los datos cambiaron o requieren revision.',
        });
      }
    }
    return {
      results,
      counts: {
        enrolled: results.filter((row) => row.outcome === 'ENROLLED').length,
        skipped: results.filter((row) => row.outcome === 'SKIPPED').length,
        reviewRequired: results.filter((row) => row.outcome === 'REVIEW_REQUIRED').length,
        errors: results.filter((row) => row.outcome === 'ERROR').length,
      },
    };
  }

  private async historyPlan(id: string, session?: ClientSession) {
    assertMemberId(id);
    const config = await this.config(session);
    const person = await this.members
      .findById(id)
      .select('+billingPeriods +billingClosure')
      .session(session || null)
      .lean();
    if (!person) throw new NotFoundException('Socio no encontrado.');
    const startPeriod = assertBillingStart(person, config),
      baseline = person.billingBaseline;
    if (
      !person.statePlayer ||
      person.billingPeriods !== undefined ||
      person.billingClosure ||
      !baseline?.migrationId ||
      !baseline.establishedBy ||
      !Number.isFinite(new Date(baseline.establishedAt || NaN).getTime()) ||
      baseline.throughPeriod !== addMonths(startPeriod, -1) ||
      startPeriod > monthAt(this.clock())
    )
      throw new ConflictException(
        'La vigencia anterior requiere revision; no se puede reemplazar ni inferir una baja.',
      );
    if (
      await this.payments
        .exists({
          'allocations.beneficiaryId': person._id,
          ...uncertainMembershipPaymentFilter(this.clock()),
        })
        .session(session || null)
    )
      throw new ConflictException('Hay un pago incierto que requiere revision previa.');
    const dues = await this.dues
      .find({ beneficiaryId: person._id })
      .session(session || null)
      .sort({ period: 1 })
      .lean();
    if (dues.some((row) => row.period < startPeriod || !['OPEN', 'PAID'].includes(row.status)))
      throw new ConflictException('Las cuotas anteriores requieren revision de vigencia.');
    const payments = await this.payments
      .find({ 'allocations.beneficiaryId': person._id })
      .session(session || null)
      .sort({ _id: 1 })
      .lean();
    const plan = {
      memberId: id,
      name: person.namePlayer,
      startPeriod,
      baselineThroughPeriod: baseline.throughPeriod,
      dues: dues.map((row) => ({
        id: String(row._id),
        period: row.period,
        status: row.status,
        amount: row.amount,
      })),
      payments: payments.map((row) => ({
        id: String(row._id),
        status: row.status,
        amount: row.amount,
      })),
    };
    return { ...plan, approvalHash: digest({ ...plan, baseline, version: person.__v || 0 }) };
  }
  async previewHistory(email: string, id: string) {
    await this.actor(email);
    return this.historyPlan(id);
  }
  async approveHistory(email: string, id: string, input: ApproveBillingHistoryDto, key: string) {
    this.validateKey(key);
    assertMemberId(id);
    await this.actor(email);
    await this.auditReady();
    const reason = input.reason?.trim();
    if (
      !reason ||
      reason.length < 5 ||
      reason.length > 1000 ||
      !/^[a-f\d]{64}$/.test(input.approvalHash || '')
    )
      throw new BadRequestException('Revisa el historial e indica un motivo valido.');
    return this.members.db.transaction(async (session) => {
      const actor = await this.actor(email, session),
        eventId = `membership:history-review:${actor._id}:${key}`;
      const requestHash = digest({ id, approvalHash: input.approvalHash, reason });
      const previous = await this.audit.findOne({ eventId }).session(session).lean();
      if (previous) {
        if (previous.afterData?.requestHash !== requestHash)
          throw new ConflictException('La clave pertenece a otra revision.');
        return { ...previous.afterData.result, duplicate: true };
      }
      const plan = await this.historyPlan(id, session);
      if (plan.approvalHash !== input.approvalHash)
        throw new ConflictException('El historial cambio. Vuelve a revisarlo.');
      await this.members.updateOne({ _id: actor._id }, { $inc: { __v: 1 } }, { session });
      const interval = {
        fromPeriod: plan.startPeriod,
        approvedAt: this.clock(),
        approvedBy: actor._id,
        reason,
      };
      const updated = await this.members.updateOne(
        {
          _id: id,
          statePlayer: true,
          billingStartPeriod: plan.startPeriod,
          billingPeriods: { $exists: false },
        },
        { $set: { billingPeriods: [interval] }, $inc: { __v: 1 } },
        { session, runValidators: true },
      );
      if (updated.modifiedCount !== 1)
        throw new ConflictException('La vigencia cambio durante la revision.');
      const result = {
        memberId: id,
        startPeriod: plan.startPeriod,
        preservedDues: plan.dues.length,
        preservedPayments: plan.payments.length,
      };
      await this.audit.create(
        [
          {
            eventId,
            entityType: 'MEMBERSHIP_PAYMENT',
            entityId: id,
            action: 'STATE_CHANGE',
            performedBy: 'ADMIN',
            performedByEmail: actor.email,
            description:
              'Vigencia anterior revisada; conserva inicio, cuotas y pagos sin reinscripcion.',
            beforeData: { billingPeriods: null },
            afterData: { requestHash, result, interval },
            metadata: { reason: 'MEMBERSHIP_LEGACY_HISTORY_APPROVAL' },
            timestamp: this.clock(),
          },
        ],
        { session },
      );
      return { ...result, duplicate: false };
    });
  }
}
