import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Register } from '../register/entities/register.entity';
import { MembershipDue } from './entities/membership-due.entity';
import { MembershipPayment } from './entities/membership-payment.entity';
import { MembershipBillingConfig } from './entities/membership-billing-config.entity';
import {
  BillingConfiguration,
  BillingDue,
  BillingMember,
  BILLING_CONFIG_KEY,
} from './billing.types';
import {
  addMonths,
  assertBillingStart,
  assertCanManage,
  assertConfiguration,
  assertMemberId,
  assertPaymentPeriod,
  assertPaymentSelection,
  assertPeriod,
  dueAt,
  financialAccess,
  monthAt,
  periodsBetween,
  priceFor,
} from './billing.policy';

export const BILLING_CLOCK = 'MEMBERSHIP_BILLING_CLOCK';

@Injectable()
export class MembershipBillingService {
  constructor(
    @InjectModel(MembershipDue.name) private readonly dues: Model<MembershipDue>,
    @InjectModel(MembershipPayment.name) private readonly payments: Model<MembershipPayment>,
    @InjectModel(MembershipBillingConfig.name)
    private readonly configs: Model<MembershipBillingConfig>,
    @InjectModel(Register.name) private readonly members: Model<Register>,
    @Inject(BILLING_CLOCK) private readonly clock: () => Date,
  ) {}

  private async configuration(session?: ClientSession): Promise<BillingConfiguration> {
    const config = await this.configs
      .findOne({ key: BILLING_CONFIG_KEY })
      .session(session || null)
      .lean()
      .exec();
    if (!config) throw new ServiceUnavailableException('Mensualidades aun no configuradas.');
    assertConfiguration(config);
    return config;
  }

  private async member(id: string, session?: ClientSession): Promise<BillingMember> {
    assertMemberId(id);
    const member = await this.members
      .findById(id)
      .session(session || null)
      .lean()
      .exec();
    if (!member) throw new NotFoundException('Socio no encontrado.');
    return member;
  }

  private async ensureMemberDues(
    member: BillingMember,
    through: string,
    config: BillingConfiguration,
    session: ClientSession,
  ) {
    const start = assertBillingStart(member, config);
    if (!member.statePlayer)
      throw new ConflictException(
        'La facturacion de socios inactivos requiere revision administrativa.',
      );
    // Serialize against changes of type/titular and concurrent generation, using the existing member version.
    const lock = await this.members
      .updateOne({ _id: member._id }, { $inc: { __v: 1 } }, { session })
      .exec();
    if (lock.matchedCount !== 1)
      throw new ConflictException('El socio cambio durante la operacion.');
    for (const period of periodsBetween(start, through)) {
      const exists = await this.dues.exists({ beneficiaryId: member._id, period }).session(session);
      if (exists) continue;
      const price = priceFor(member, period, config);
      await this.dues
        .updateOne(
          { beneficiaryId: member._id, period },
          {
            $setOnInsert: {
              beneficiaryId: member._id,
              period,
              dueAt: dueAt(period),
              status: 'OPEN',
              ...price,
            },
          },
          { upsert: true, runValidators: true, session },
        )
        .exec();
    }
  }

  async prepareDues(actorId: string, beneficiaryId: string, throughPeriod?: string) {
    assertMemberId(actorId);
    assertMemberId(beneficiaryId);
    const now = this.clock();
    const through = throughPeriod || monthAt(now);
    assertPeriod(through);
    if (through > addMonths(monthAt(now), 3))
      throw new BadRequestException('Solo puedes adelantar tres meses ademas del actual.');
    return this.dues.db.transaction(async (session) => {
      const actor = await this.member(actorId, session);
      const beneficiary = await this.member(beneficiaryId, session);
      assertCanManage(actor, beneficiary);
      assertPaymentPeriod(through, now, actor.role);
      const config = await this.configuration(session);
      if (through < assertBillingStart(beneficiary, config))
        throw new BadRequestException('Periodo anterior al inicio de facturacion del socio.');
      if (actorId !== beneficiaryId)
        await this.members.updateOne({ _id: actor._id }, { $inc: { __v: 1 } }, { session }).exec();
      await this.ensureMemberDues(beneficiary, through, config, session);
      return this.dues
        .find({ beneficiaryId: beneficiary._id, period: { $lte: through } })
        .session(session)
        .sort({ period: 1 })
        .lean()
        .exec();
    });
  }

  async quote(actorId: string, dueIds: string[]) {
    assertMemberId(actorId);
    if (
      !Array.isArray(dueIds) ||
      !dueIds.length ||
      dueIds.length > 100 ||
      new Set(dueIds).size !== dueIds.length
    )
      throw new BadRequestException('Seleccion de cuotas invalida.');
    dueIds.forEach(assertMemberId);
    const now = this.clock();
    return this.dues.db.transaction((session) =>
      this.quoteInSession(actorId, dueIds, session, now),
    );
  }

  async quoteInSession(actorId: string, dueIds: string[], session: ClientSession, now: Date) {
    assertMemberId(actorId);
    if (
      !Array.isArray(dueIds) ||
      !dueIds.length ||
      dueIds.length > 100 ||
      new Set(dueIds).size !== dueIds.length
    )
      throw new BadRequestException('Seleccion de cuotas invalida.');
    dueIds.forEach(assertMemberId);
    const actor = await this.member(actorId, session);
    const selected = await this.dues
      .find({ _id: { $in: dueIds } })
      .session(session)
      .lean()
      .exec();
    if (selected.length !== dueIds.length)
      throw new BadRequestException('Una cuota no esta disponible.');
    const config = await this.configuration(session);
    const beneficiaryIds = [...new Set(selected.map((row) => String(row.beneficiaryId)))];
    await this.members.updateOne({ _id: actor._id }, { $inc: { __v: 1 } }, { session }).exec();
    for (const id of beneficiaryIds.sort()) {
      const beneficiary = await this.member(id, session);
      assertCanManage(actor, beneficiary);
      const through = selected
        .filter((row) => String(row.beneficiaryId) === id)
        .map((row) => row.period)
        .concat(monthAt(now))
        .sort()
        .at(-1);
      assertPaymentPeriod(through, now, actor.role);
      await this.ensureMemberDues(beneficiary, through, config, session);
      if (
        selected.some((row) => String(row.beneficiaryId) === id && row.pricingMode === 'TEST') &&
        (!config.testPricing.enabled || !config.testPricing.memberIds.includes(id))
      )
        throw new ConflictException('La cuota de prueba requiere revisar su autorizacion.');
    }
    const all = await this.dues
      .find({ beneficiaryId: { $in: beneficiaryIds } })
      .session(session)
      .lean()
      .exec();
    const amount = assertPaymentSelection(selected as BillingDue[], all as BillingDue[], now);
    return {
      amount,
      currency: 'CLP',
      pricingMode: selected[0].pricingMode,
      allocations: selected.map((row) => ({
        dueId: String(row._id),
        beneficiaryId: String(row.beneficiaryId),
        period: row.period,
        amount: row.amount,
      })),
    };
  }

  async assessFinancialAccess(memberId: string) {
    const now = this.clock();
    const config = await this.configuration();
    const member = await this.member(memberId);
    if (member.statePlayer && member.role !== 'admin' && config.autoBlockEnabled)
      await this.prepareDues(memberId, memberId);
    const rows = await this.dues.find({ beneficiaryId: member._id }).lean().exec();
    return financialAccess(member, rows as BillingDue[], config, now);
  }

  async paymentHistory(actorId: string, beneficiaryId: string = actorId, page = 1, pageSize = 20) {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      !Number.isSafeInteger((page - 1) * pageSize)
    )
      throw new BadRequestException('Paginacion invalida.');
    const actor = await this.member(actorId);
    const beneficiary = await this.member(beneficiaryId);
    assertCanManage(actor, beneficiary);
    const beneficiaryKey = String(beneficiary._id);
    const id = new Types.ObjectId(beneficiaryKey);
    const filter =
      actor.role === 'admin' || String(actor._id) === String(beneficiary._id)
        ? { $or: [{ 'payer.memberId': id }, { 'allocations.beneficiaryId': id }] }
        : { 'allocations.beneficiaryId': id };
    const [rows, total] = await Promise.all([
      this.payments
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean()
        .exec(),
      this.payments.countDocuments(filter).exec(),
    ]);
    return {
      page,
      pageSize,
      total,
      items: rows.map((row) => {
        const complete = actor.role === 'admin' || String(row.payer.memberId) === String(actor._id);
        const allocations = row.allocations.filter(
          (item) => complete || String(item.beneficiaryId) === beneficiaryKey,
        );
        return {
          id: String(row._id),
          publicReference: row.publicReference,
          method: row.method,
          status: row.status,
          amount: complete ? row.amount : allocations.reduce((sum, item) => sum + item.amount, 0),
          currency: row.currency,
          paidAt: row.paidAt,
          pricingMode: row.pricingMode,
          payer: complete ? row.payer : { name: row.payer.name },
          allocations: allocations.map((item) => ({
            beneficiaryId: String(item.beneficiaryId),
            period: item.period,
            amount: item.amount,
          })),
        };
      }),
    };
  }
}
