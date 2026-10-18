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
import { createHash, randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { ClientSession, Model, Types } from 'mongoose';
import { Register } from '../register/entities/register.entity';
import { AuditLog } from '../audit-log/entities/audit-log.entity';
import { MembershipDue } from './entities/membership-due.entity';
import { MembershipPayment } from './entities/membership-payment.entity';
import { MembershipBillingConfig } from './entities/membership-billing-config.entity';
import { BILLING_CLOCK, MembershipBillingService } from './membership-billing.service';
import {
  assertAmount,
  assertConfiguration,
  assertMemberId,
  monthAt,
  priceFor,
} from './billing.policy';
import { BILLING_CONFIG_KEY, BILLING_TIMEZONE } from './billing.types';
import { BillingAdminQueryDto } from './dto/billing-admin-query.dto';
import { RegisterBankPaymentDto } from './dto/register-bank-payment.dto';

@Injectable()
export class BillingAdminService {
  constructor(
    private readonly core: MembershipBillingService,
    @InjectModel(MembershipDue.name) private readonly dues: Model<MembershipDue>,
    @InjectModel(MembershipPayment.name) private readonly payments: Model<MembershipPayment>,
    @InjectModel(MembershipBillingConfig.name)
    private readonly configs: Model<MembershipBillingConfig>,
    @InjectModel(Register.name) private readonly members: Model<Register>,
    @InjectModel(AuditLog.name) private readonly audit: Model<AuditLog>,
    @Inject(BILLING_CLOCK) private readonly clock: () => Date,
  ) {}

  private async admin(email: string, session?: ClientSession) {
    if (typeof email !== 'string' || !email.trim())
      throw new ForbiddenException('Se requiere un administrador activo.');
    const actor = await this.members
      .findOne({ email: email.trim().toLowerCase() })
      .session(session || null)
      .lean()
      .exec();
    if (!actor || actor.role !== 'admin' || !actor.statePlayer)
      throw new ForbiddenException('Se requiere un administrador activo.');
    return actor;
  }

  private key(value: string) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(value))
      throw new BadRequestException('Falta una clave de idempotencia valida.');
    return value;
  }

  private async config() {
    const config = await this.configs.findOne({ key: BILLING_CONFIG_KEY }).lean().exec();
    if (!config)
      throw new ServiceUnavailableException(
        'Mensualidades pendientes de configuracion y migracion.',
      );
    assertConfiguration(config);
    return config;
  }

  private async indexesReady() {
    try {
      const [dues, payments, audit] = await Promise.all([
        this.dues.collection.indexes(),
        this.payments.collection.indexes(),
        this.audit.collection.indexes(),
      ]);
      const unique = (rows: typeof dues, fields: string[]) =>
        rows.some((row) => row.unique && Object.keys(row.key).join(',') === fields.join(','));
      if (
        !unique(dues, ['beneficiaryId', 'period']) ||
        !unique(payments, ['publicReference']) ||
        !unique(payments, ['idempotency.actorId', 'idempotency.key']) ||
        !unique(audit, ['eventId'])
      )
        throw new Error('Missing billing indexes');
    } catch {
      throw new ServiceUnavailableException(
        'Falta revisar los indices de mensualidades antes de registrar pagos.',
      );
    }
  }

  async searchMembers(email: string, query: BillingAdminQueryDto) {
    await this.admin(email);
    const config = await this.config();
    const escaped = (query.search || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = escaped
      ? {
          $or: [
            { namePlayer: { $regex: escaped, $options: 'i' } },
            { email: { $regex: escaped, $options: 'i' } },
          ],
        }
      : {};
    const page = query.page || 1;
    const [rows, total] = await Promise.all([
      this.members
        .find(filter)
        .select('namePlayer email partnerType titularId statePlayer billingStartPeriod')
        .sort({ namePlayer: 1, _id: 1 })
        .skip((page - 1) * 20)
        .limit(20)
        .lean()
        .exec(),
      this.members.countDocuments(filter).exec(),
    ]);
    const period = query.period || monthAt(this.clock());
    const dues = await this.dues
      .find({ beneficiaryId: { $in: rows.map((row) => row._id) }, period })
      .lean()
      .exec();
    return {
      page,
      pageSize: 20,
      total,
      period,
      items: rows.map((row) => {
        const due = dues.find((item) => String(item.beneficiaryId) === String(row._id));
        const validType = ['Titular', 'Carga', 'Familiar'].includes(row.partnerType);
        const enrolled = Boolean(
          validType && row.billingStartPeriod && row.billingStartPeriod <= period,
        );
        let estimatedAmount: number | null = null;
        if (enrolled) estimatedAmount = priceFor(row, period, config).amount;
        return {
          id: String(row._id),
          name: row.namePlayer,
          email: row.email,
          memberType: row.partnerType,
          active: row.statePlayer,
          enrolled,
          status: due?.status || (enrolled ? 'NOT_GENERATED' : 'NOT_ENROLLED'),
          amount: due?.amount ?? estimatedAmount,
          pricingMode:
            due?.pricingMode ||
            (config.testPricing.enabled && config.testPricing.memberIds.includes(String(row._id))
              ? 'TEST'
              : 'STANDARD'),
        };
      }),
    };
  }

  async memberDues(email: string, id: string, throughPeriod?: string) {
    return this.memberContext(email, id, throughPeriod, true);
  }

  async memberDetails(email: string, id: string) {
    return this.memberContext(email, id);
  }

  private async memberContext(email: string, id: string, throughPeriod?: string, prepare = false) {
    const actor = await this.admin(email);
    await this.config();
    if (prepare) await this.indexesReady();
    assertMemberId(id);
    const member = await this.members.findById(id).lean().exec();
    if (!member) throw new NotFoundException('Socio no encontrado.');
    const family =
      member.partnerType === 'Titular'
        ? await this.members.find({ titularId: member._id }).sort({ namePlayer: 1 }).lean().exec()
        : [];
    const people = [member, ...family];
    for (const person of prepare ? people : []) {
      if (
        person.statePlayer &&
        person.billingStartPeriod &&
        ['Titular', 'Carga', 'Familiar'].includes(person.partnerType)
      )
        await this.core.prepareDues(String(actor._id), String(person._id), throughPeriod);
    }
    const dues = await this.dues
      .find({ beneficiaryId: { $in: people.map((person) => person._id) } })
      .sort({ period: 1, beneficiaryId: 1 })
      .lean()
      .exec();
    return {
      memberId: String(member._id),
      members: people.map((person) => ({
        id: String(person._id),
        name: person.namePlayer,
        email: person.email,
        memberType: person.partnerType,
        active: person.statePlayer,
        enrolled: Boolean(
          person.billingStartPeriod &&
          ['Titular', 'Carga', 'Familiar'].includes(person.partnerType),
        ),
      })),
      dues: dues.map((due) => ({
        id: String(due._id),
        beneficiaryId: String(due.beneficiaryId),
        period: due.period,
        dueAt: due.dueAt,
        amount: due.amount,
        status: due.status,
        pricingMode: due.pricingMode,
      })),
    };
  }

  async quote(email: string, dueIds: string[]) {
    const actor = await this.admin(email);
    await this.indexesReady();
    return this.core.quote(String(actor._id), dueIds);
  }

  async registerBankPayment(email: string, input: RegisterBankPaymentDto, idempotencyKey: string) {
    this.key(idempotencyKey);
    const actor = await this.admin(email);
    if (input.verified !== true || !['BANK_TRANSFER', 'BANK_DEPOSIT'].includes(input.method))
      throw new BadRequestException('Debes verificar un ingreso bancario completo.');
    assertAmount(input.amount);
    const payerName = input.payerName?.trim();
    const reference = input.reference?.trim();
    if (!payerName || !reference)
      throw new BadRequestException('Indica pagador y referencia bancaria.');
    const now = this.clock();
    const paid = DateTime.fromISO(input.receivedDate, { zone: BILLING_TIMEZONE });
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(input.receivedDate) ||
      !paid.isValid ||
      paid.toISODate() !== input.receivedDate ||
      paid.toISODate() > DateTime.fromJSDate(now, { zone: BILLING_TIMEZONE }).toISODate()
    )
      throw new BadRequestException(
        'La fecha del ingreso bancario no es valida o esta en el futuro.',
      );
    if (!Array.isArray(input.dueIds))
      throw new BadRequestException('Seleccion de cuotas invalida.');
    const canonical = {
      dueIds: [...input.dueIds].sort(),
      method: input.method,
      amount: input.amount,
      payerName,
      payerMemberId: input.payerMemberId || null,
      receivedDate: input.receivedDate,
      reference,
      notes: input.notes?.trim() || '',
      matchingReferenceVerified: input.matchingReferenceVerified === true,
    };
    const hash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    await this.indexesReady();
    return this.payments.db.transaction(async (session) => {
      const currentAdmin = await this.admin(email, session);
      const existing = await this.payments
        .findOne({ 'idempotency.actorId': currentAdmin._id, 'idempotency.key': idempotencyKey })
        .session(session)
        .exec();
      if (existing) {
        if (existing.idempotency.hash !== hash)
          throw new ConflictException('La clave de reintento pertenece a otro contenido.');
        return {
          id: String(existing._id),
          publicReference: existing.publicReference,
          status: existing.status,
          duplicate: true,
        };
      }
      const quote = await this.core.quoteInSession(String(actor._id), input.dueIds, session, now);
      if (quote.amount !== input.amount)
        throw new BadRequestException(
          'El monto debe coincidir exactamente con las cuotas completas seleccionadas.',
        );
      const matchingPayment = await this.payments
        .findOne({
          status: 'CONFIRMED',
          method: { $in: ['BANK_TRANSFER', 'BANK_DEPOSIT'] },
          amount: quote.amount,
          'bank.reference': reference,
          'bank.receivedAt': paid.toJSDate(),
        })
        .session(session)
        .lean()
        .exec();
      if (matchingPayment && input.matchingReferenceVerified !== true)
        throw new ConflictException({
          code: 'BANK_REFERENCE_REVIEW',
          message:
            'Existe otro pago con igual referencia, fecha y monto. ' +
            'Verifica un ingreso distinto antes de continuar.',
        });
      let payer: { memberId?: Types.ObjectId; name: string; email?: string } = { name: payerName };
      if (input.payerMemberId) {
        assertMemberId(input.payerMemberId);
        const person = await this.members
          .findById(input.payerMemberId)
          .session(session)
          .lean()
          .exec();
        if (!person) throw new BadRequestException('El pagador seleccionado no existe.');
        payer = { memberId: person._id, name: person.namePlayer, email: person.email };
      }
      const beneficiaries = await this.members
        .find({ _id: { $in: quote.allocations.map((row) => row.beneficiaryId) } })
        .session(session)
        .lean()
        .exec();
      const publicReference = `membership_${randomUUID()}`;
      const [payment] = await this.payments.create(
        [
          {
            publicReference,
            payer,
            method: input.method,
            status: 'CONFIRMED',
            amount: quote.amount,
            currency: 'CLP',
            pricingMode: quote.pricingMode,
            allocations: quote.allocations.map((row) => ({
              ...row,
              beneficiaryName: beneficiaries.find(
                (person) => String(person._id) === row.beneficiaryId,
              )?.namePlayer,
            })),
            registeredBy: currentAdmin._id,
            bank: { reference, receivedAt: paid.toJSDate() },
            paidAt: paid.toJSDate(),
            confirmedAt: now,
            notes: canonical.notes,
            idempotency: { actorId: currentAdmin._id, key: idempotencyKey, hash },
            notifications: payer.email
              ? [
                  {
                    recipient: payer.email,
                    eventKey: `${publicReference}:confirmed`,
                    kind: 'CONFIRMED',
                    status: 'PENDING',
                    attempts: 0,
                    nextAttemptAt: now,
                  },
                ]
              : [],
          },
        ],
        { session },
      );
      for (const allocation of quote.allocations) {
        const result = await this.dues
          .updateOne(
            { _id: allocation.dueId, status: 'OPEN', amount: allocation.amount },
            { $set: { status: 'PAID', settlementPaymentId: payment._id, paidAt: paid.toJSDate() } },
            { session },
          )
          .exec();
        if (result.modifiedCount !== 1)
          throw new ConflictException(
            'Una cuota cambio durante el registro. Recarga antes de continuar.',
          );
      }
      await this.audit.create(
        [
          {
            eventId: `${publicReference}:registered`,
            entityType: 'MEMBERSHIP_PAYMENT',
            entityId: String(payment._id),
            action: 'ADMIN_CREATE',
            performedBy: 'ADMIN',
            performedByUser: currentAdmin.namePlayer,
            performedByEmail: currentAdmin.email,
            afterData: {
              matchingReferencePaymentId: matchingPayment ? String(matchingPayment._id) : null,
              publicReference,
              method: input.method,
              amount: quote.amount,
              payerId: payer.memberId,
              allocations: quote.allocations,
            },
            description:
              'Pago bancario de mensualidades verificado y registrado por administracion.',
            timestamp: now,
          },
        ],
        { session },
      );
      return { id: String(payment._id), publicReference, status: payment.status, duplicate: false };
    });
  }

  async reverseBankPayment(email: string, id: string, reason: string, key: string) {
    this.key(key);
    assertMemberId(id);
    if (typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 1000)
      throw new BadRequestException('Indica el motivo de la anulacion.');
    await this.admin(email);
    await this.indexesReady();
    const now = this.clock();
    return this.payments.db.transaction(async (session) => {
      const actor = await this.admin(email, session);
      await this.members.updateOne({ _id: actor._id }, { $inc: { __v: 1 } }, { session }).exec();
      const payment = await this.payments.findById(id).session(session).exec();
      if (!payment) throw new NotFoundException('Pago no encontrado.');
      if (payment.method === 'MERCADO_PAGO')
        throw new BadRequestException(
          'Esta accion solo corrige registros bancarios; no realiza reembolsos.',
        );
      if (payment.status === 'REVERSED') {
        if (
          payment.reversal?.idempotencyKey === key &&
          String(payment.reversal.actorId) === String(actor._id) &&
          payment.reversal.reason === reason.trim()
        )
          return { id, status: 'REVERSED', duplicate: true };
        throw new ConflictException('El registro ya esta anulado.');
      }
      if (payment.status !== 'CONFIRMED')
        throw new ConflictException('Solo puedes anular un registro confirmado.');
      for (const allocation of payment.allocations) {
        const result = await this.dues
          .updateOne(
            { _id: allocation.dueId, status: 'PAID', settlementPaymentId: payment._id },
            { $set: { status: 'OPEN' }, $unset: { settlementPaymentId: '', paidAt: '' } },
            { session },
          )
          .exec();
        if (result.modifiedCount !== 1)
          throw new ConflictException(
            'Una cuota ya no corresponde a este pago. Se requiere revision.',
          );
      }
      payment.status = 'REVERSED';
      payment.reversal = {
        actorId: actor._id,
        reason: reason.trim(),
        reversedAt: now,
        idempotencyKey: key,
      };
      for (const notification of payment.notifications)
        if (['PENDING', 'FAILED'].includes(notification.status)) notification.status = 'CANCELLED';
      if (payment.payer.email)
        payment.notifications.push({
          recipient: payment.payer.email,
          eventKey: `${payment.publicReference}:reversed`,
          kind: 'REVERSED',
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: now,
        });
      await payment.save({ session });
      await this.audit.create(
        [
          {
            eventId: `${payment.publicReference}:reversed`,
            entityType: 'MEMBERSHIP_PAYMENT',
            entityId: id,
            action: 'UPDATE',
            performedBy: 'ADMIN',
            performedByUser: actor.namePlayer,
            performedByEmail: actor.email,
            beforeData: { status: 'CONFIRMED' },
            afterData: { status: 'REVERSED', reason: reason.trim() },
            description:
              'Anulacion auditada de registro bancario; no implica devolucion de dinero.',
            timestamp: now,
          },
        ],
        { session },
      );
      return { id, status: 'REVERSED', duplicate: false };
    });
  }

  async history(email: string, query: BillingAdminQueryDto) {
    await this.admin(email);
    await this.config();
    const filter: Record<string, unknown> = {};
    const allocation: Record<string, unknown> = {};
    if (query.period) allocation.period = query.period;
    if (query.beneficiaryId) {
      assertMemberId(query.beneficiaryId);
      allocation.beneficiaryId = new Types.ObjectId(query.beneficiaryId);
    }
    if (Object.keys(allocation).length) filter.allocations = { $elemMatch: allocation };
    if (query.method) filter.method = query.method;
    if (query.status) filter.status = query.status;
    const page = query.page || 1;
    const [items, total] = await Promise.all([
      this.payments
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * 20)
        .limit(20)
        .lean()
        .exec(),
      this.payments.countDocuments(filter).exec(),
    ]);
    const names = await this.members
      .find({
        _id: {
          $in: items.flatMap((item) =>
            [
              ...item.allocations.map((row) => row.beneficiaryId),
              item.registeredBy,
              item.reversal?.actorId,
            ].filter(Boolean),
          ),
        },
      })
      .select('namePlayer')
      .lean()
      .exec();
    const name = (id: unknown) =>
      names.find((person) => String(person._id) === String(id))?.namePlayer || 'Socio';
    return {
      page,
      pageSize: 20,
      total,
      items: items.map((item) => ({
        id: String(item._id),
        publicReference: item.publicReference,
        method: item.method,
        status: item.status,
        amount: item.amount,
        currency: item.currency,
        paidAt: item.paidAt,
        createdAt: (item as any).createdAt,
        confirmedAt: item.confirmedAt,
        payer: {
          name: item.payer.name,
          memberId: item.payer.memberId ? String(item.payer.memberId) : null,
        },
        bank: item.bank,
        notes: item.notes,
        registeredBy: name(item.registeredBy),
        pricingMode: item.pricingMode,
        provider: item.provider
          ? {
              paymentId: item.provider.paymentId,
              status: item.provider.status,
              receivedAmount: item.provider.receivedAmount,
              currency: item.provider.currency,
            }
          : null,
        reviewReasons: item.reviewReasons,
        reversal: item.reversal
          ? {
              reason: item.reversal.reason,
              reversedAt: item.reversal.reversedAt,
              actor: name(item.reversal.actorId),
            }
          : null,
        allocations: item.allocations.map((row) => ({
          beneficiaryId: String(row.beneficiaryId),
          name: row.beneficiaryName || name(row.beneficiaryId),
          period: row.period,
          amount: row.amount,
        })),
        notificationStatus: item.notifications.at(-1)?.status || null,
      })),
    };
  }
}
