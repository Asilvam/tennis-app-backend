import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Register } from '../register/entities/register.entity';
import { MembershipBillingConfig } from './entities/membership-billing-config.entity';
import { MembershipDue } from './entities/membership-due.entity';
import { BILLING_CLOCK, MembershipBillingService } from './membership-billing.service';
import {
  assertCanManage,
  assertConfiguration,
  assertMemberId,
  assertPaymentPeriod,
  monthAt,
} from './billing.policy';
import { BILLING_CONFIG_KEY } from './billing.types';
import { MembershipMpService } from './billing-mp.service';

@Injectable()
export class BillingPortalService {
  constructor(
    private readonly core: MembershipBillingService,
    private readonly config: ConfigService,
    @InjectModel(Register.name) private readonly members: Model<Register>,
    @InjectModel(MembershipDue.name) private readonly dues: Model<MembershipDue>,
    @InjectModel(MembershipBillingConfig.name)
    private readonly configs: Model<MembershipBillingConfig>,
    @Inject(BILLING_CLOCK) private readonly clock: () => Date,
    private readonly mp?: MembershipMpService,
  ) {}

  enabled() {
    return this.config.get<string>('MEMBERSHIP_PORTAL_ENABLED') === 'true';
  }

  private async actor(email: string) {
    if (typeof email !== 'string' || !email.trim())
      throw new ForbiddenException('Se requiere una sesion valida.');
    const actor = await this.members.findOne({ email: email?.trim().toLowerCase() }).lean();
    if (!actor?.statePlayer) throw new ForbiddenException('La cuenta no esta activa.');
    return actor;
  }

  async access(email: string) {
    const actor = await this.actor(email);
    const config = await this.configs.findOne({ key: BILLING_CONFIG_KEY }).lean();
    if (!config)
      throw new ServiceUnavailableException('Mensualidades pendientes de configuracion.');
    assertConfiguration(config);
    const exempt = actor.role === 'admin';
    const review = !actor.billingStartPeriod && config.autoBlockEnabled && !exempt;
    const financial = actor.billingStartPeriod
      ? await this.core.assessFinancialAccess(String(actor._id))
      : null;
    const legacy = actor.updatePayment === false && !exempt;
    return {
      accountActive: true,
      financiallyRestricted: Boolean(legacy || review || financial?.financiallyRestricted),
      reason: legacy
        ? 'LEGACY_ACCESS_REVIEW'
        : review
          ? 'BILLING_START_REVIEW'
          : financial?.financiallyRestricted
            ? 'OVERDUE_DUES'
            : null,
      autoBlockEnabled: config.autoBlockEnabled,
      overduePeriods: financial?.overduePeriods || [],
      name: actor.namePlayer,
      role: actor.role,
      memberId: String(actor._id),
      mpEnabled: this.mp ? await this.mp.available() : false,
    };
  }

  async home(email: string, throughPeriod?: string) {
    const actor = await this.actor(email);
    const now = this.clock();
    const currentPeriod = monthAt(now);
    assertPaymentPeriod(throughPeriod || currentPeriod, now, actor.role);
    const indexes = await this.dues.collection.indexes();
    if (
      !indexes.some(
        (index) => index.unique && Object.keys(index.key).join(',') === 'beneficiaryId,period',
      )
    )
      throw new ServiceUnavailableException('Faltan indices financieros verificados.');
    const family =
      actor.partnerType === 'Titular'
        ? await this.members.find({ titularId: actor._id }).sort({ namePlayer: 1 }).lean()
        : [];
    const people = [actor, ...family];
    for (const person of people) {
      if (
        person.statePlayer &&
        person.billingStartPeriod &&
        ['Titular', 'Carga', 'Familiar'].includes(person.partnerType)
      )
        await this.core.prepareDues(
          String(actor._id),
          String(person._id),
          throughPeriod || currentPeriod,
        );
    }
    const dues = await this.dues
      .find({
        beneficiaryId: { $in: people.map((person) => person._id) },
        period: { $lte: currentPeriod },
      })
      .sort({ period: 1, beneficiaryId: 1 })
      .lean();
    return {
      memberId: String(actor._id),
      currentPeriod,
      access: await this.access(email),
      members: people.map((person) => ({
        id: String(person._id),
        name: person.namePlayer,
        email: person.email,
        memberType: person.partnerType,
        active: person.statePlayer,
        enrolled: Boolean(person.billingStartPeriod),
      })),
      dues: dues.map((row) => ({
        id: String(row._id),
        beneficiaryId: String(row.beneficiaryId),
        period: row.period,
        dueAt: row.dueAt,
        amount: row.amount,
        status: row.status,
        pricingMode: row.pricingMode,
      })),
    };
  }

  async history(email: string, beneficiaryId?: string, page = 1) {
    const actor = await this.actor(email);
    const id = beneficiaryId || String(actor._id);
    assertMemberId(id);
    const person = await this.members.findById(id).lean();
    if (!person) throw new ForbiddenException('No puedes consultar este socio.');
    assertCanManage({ ...actor, role: 'user' }, person);
    return this.core.paymentHistory(String(actor._id), id, page);
  }
}
