import { ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Register } from '../register/entities/register.entity';
import { CourtReserve } from '../court-reserve/entities/court-reserve.entity';
import { MembershipDue } from '../membership-billing/entities/membership-due.entity';
import { MembershipBillingConfig } from '../membership-billing/entities/membership-billing-config.entity';
import { BILLING_CONFIG_KEY } from '../membership-billing/billing.types';
import { assertConfiguration, financialAccess, reservationPermissions } from '../membership-billing/billing.policy';
import { BillingDue } from '../membership-billing/billing.types';
import { MembersDirectoryQueryDto, ReservesDirectoryQueryDto } from './admin-directory.dto';
import { directoryPage, directorySearch, reserveDirectoryFilter } from './admin-directory.policy';

const memberFields = [
  'namePlayer email cellular role statePlayer updatePayment',
  'partnerType titularId emailVerified +billingPeriods billingStartPeriod',
].join(' ');
const titularType = {
  $or: [{ partnerType: 'Titular' }, { partnerType: { $exists: false } }, { partnerType: null }, { partnerType: '' }],
};

@Injectable()
export class AdminDirectoryService {
  constructor(
    @InjectModel(Register.name) private readonly members: Model<Register>,
    @InjectModel(CourtReserve.name) private readonly reserves: Model<CourtReserve>,
    @InjectModel(MembershipDue.name) private readonly dues: Model<MembershipDue>,
    @InjectModel(MembershipBillingConfig.name) private readonly configs: Model<MembershipBillingConfig>,
    private readonly config: ConfigService,
  ) {}

  private async admin(email: string) {
    if (typeof email !== 'string' || !email.trim())
      throw new ForbiddenException('Se requiere un administrador activo.');
    const actor = await this.members
      .findOne({ email: email?.trim().toLowerCase() })
      .select('role statePlayer')
      .lean()
      .exec();
    if (!actor?.statePlayer || actor.role !== 'admin')
      throw new ForbiddenException('Se requiere un administrador activo.');
  }

  private async permissions(rows: Awaited<ReturnType<AdminDirectoryService['memberRows']>>) {
    const now = new Date();
    const enabled = this.config.get<string>('MEMBERSHIP_PORTAL_ENABLED') === 'true';
    const config = enabled ? await this.configs.findOne({ key: BILLING_CONFIG_KEY }).lean().exec() : null;
    if (enabled && !config) throw new ServiceUnavailableException('Mensualidades pendientes de configuracion.');
    if (config) assertConfiguration(config);
    const enrolled = rows.filter((row) => row.billingStartPeriod);
    const dues =
      config && enrolled.length
        ? await this.dues
            .find({ beneficiaryId: { $in: enrolled.map((row) => row._id) } })
            .lean()
            .exec()
        : [];
    const grouped = new Map<string, typeof dues>();
    for (const due of dues) {
      const id = String(due.beneficiaryId);
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id).push(due);
    }
    return rows.map((row) => ({
      row,
      access: reservationPermissions(
        row,
        config && row.billingStartPeriod
          ? financialAccess(row, (grouped.get(String(row._id)) || []) as BillingDue[], config, now)
          : undefined,
        Boolean(config?.autoBlockEnabled && !row.billingStartPeriod && row.role !== 'admin'),
      ),
    }));
  }

  private memberRows(filter: Record<string, unknown>, skip = 0, limit = 0) {
    return this.members
      .find(filter)
      .select(memberFields)
      .collation({ locale: 'es', strength: 1 })
      .sort({ namePlayer: 1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();
  }

  async listMembers(email: string, query: MembersDirectoryQueryDto) {
    await this.admin(email);
    const filter: Record<string, unknown> = {};
    const search = directorySearch(query.search);
    if (search) filter.$or = ['namePlayer', 'email'].map((field) => ({ [field]: { $regex: search, $options: 'i' } }));
    if (query.state) filter.statePlayer = query.state === 'active';
    if (query.memberType === 'Carga') filter.partnerType = { $in: ['Carga', 'Familiar'] };
    if (query.memberType === 'Titular') filter.$and = [titularType];
    let page: ReturnType<typeof directoryPage>;
    let rows: Awaited<ReturnType<AdminDirectoryService['permissions']>>;
    if (query.access) {
      // Effective access uses the existing financial policy, so filter before taking a page.
      const candidates = (await this.permissions(await this.memberRows(filter))).filter(
        (item) => item.access.canReserve === (query.access === 'allowed'),
      );
      page = directoryPage(candidates.length, query.page, query.pageSize);
      rows = candidates.slice(page.offset, page.offset + page.pageSize);
    } else {
      page = directoryPage(await this.members.countDocuments(filter).exec(), query.page, query.pageSize);
      rows = await this.permissions(await this.memberRows(filter, page.offset, page.pageSize));
    }
    return {
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
      pages: page.pages,
      items: rows.map(({ row, access }) => ({
        _id: String(row._id),
        namePlayer: row.namePlayer,
        email: row.email,
        cellular: row.cellular,
        role: row.role,
        statePlayer: row.statePlayer,
        updatePayment: row.updatePayment,
        partnerType: row.partnerType,
        titularId: row.titularId ? String(row.titularId) : null,
        emailVerified: row.emailVerified,
        canReserve: access.canReserve,
        reservationBlockReason: access.reason,
      })),
    };
  }

  async titulares(email: string, excludeId?: string, currentId?: string) {
    await this.admin(email);
    const eligible = { $and: [titularType], statePlayer: true };
    const filter = {
      ...(currentId ? { $or: [eligible, { _id: currentId }] } : eligible),
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    };
    return this.members
      .find(filter)
      .select('namePlayer email partnerType statePlayer')
      .collation({ locale: 'es', strength: 1 })
      .sort({ namePlayer: 1, _id: 1 })
      .lean()
      .exec();
  }

  async listReserves(email: string, query: ReservesDirectoryQueryDto) {
    await this.admin(email);
    const filter = reserveDirectoryFilter(query, new Date());
    const page = directoryPage(await this.reserves.countDocuments(filter).exec(), query.page, query.pageSize);
    const items = await this.reserves
      .find(filter)
      .select('idCourtReserve court player1 player2 player3 player4 visitName blockedMotive dateToPlay turn state')
      .sort({ dateToPlay: 1, turn: 1, court: 1, _id: 1 })
      .skip(page.offset)
      .limit(page.pageSize)
      .lean()
      .exec();
    return { total: page.total, page: page.page, pageSize: page.pageSize, pages: page.pages, items };
  }
}
