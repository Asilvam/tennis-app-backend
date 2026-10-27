import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import axios from 'axios';
import { createHash, randomUUID } from 'crypto';
import { Register } from '../register/entities/register.entity';
import { AuditLog } from '../audit-log/entities/audit-log.entity';
import { MembershipPayment } from './entities/membership-payment.entity';
import { MembershipDue } from './entities/membership-due.entity';
import { MembershipBillingService, BILLING_CLOCK } from './membership-billing.service';
import { assertCanManage, assertMemberId } from './billing.policy';

export interface MembershipProviderSnapshot {
  paymentId: string;
  reference: string;
  purpose: string;
  amount: number;
  currency: string;
  status: string;
  collectorId: string;
  liveMode: boolean;
  pricingMode: string;
  approvedAt?: string;
  updatedAt?: string;
  refundedAmount: number;
  preference: { id: string; collectorId: string; liveMode: boolean };
}

@Injectable()
export class MembershipMpService {
  private availabilityCache?: { expiresAt: number; value: Promise<boolean> };
  constructor(
    private readonly core: MembershipBillingService,
    private readonly config: ConfigService,
    @InjectModel(MembershipPayment.name) private readonly payments: Model<MembershipPayment>,
    @InjectModel(MembershipDue.name) private readonly dues: Model<MembershipDue>,
    @InjectModel(Register.name) private readonly members: Model<Register>,
    @InjectModel(AuditLog.name) private readonly audit: Model<AuditLog>,
    @Inject(BILLING_CLOCK) private readonly clock: () => Date,
  ) {}

  private settings() {
    const base = this.config.get<string>('MP_API_URL');
    const key = this.config.get<string>('INTERNAL_API_KEY');
    let url: URL;
    try {
      url = new URL(base);
    } catch {
      throw new ServiceUnavailableException('Falta configurar Mercado Pago mensual.');
    }
    if (
      !key ||
      url.username ||
      url.password ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    )
      throw new ServiceUnavailableException('Falta configurar la conexion interna a Mercado Pago.');
    return { base: url.toString().replace(/\/$/, ''), key };
  }

  private async configuration() {
    const settings = this.settings();
    const { data } = await axios
      .get(`${settings.base}/membership/configuration`, {
        headers: { 'x-api-key': settings.key },
        timeout: 5000,
      })
      .catch(() => {
        throw new ServiceUnavailableException(
          'No se pudo verificar la configuracion de Mercado Pago.',
        );
      });
    if (data?.ready !== true || !/^\d+$/.test(data.collectorId || '') || data.currency !== 'CLP')
      throw new ServiceUnavailableException(
        'Mercado Pago aun no esta verificado para mensualidades.',
      );
    return { collectorId: String(data.collectorId) };
  }

  async available() {
    if (!this.availabilityCache || this.availabilityCache.expiresAt <= Date.now()) {
      this.availabilityCache = {
        expiresAt: Date.now() + 15000,
        value: this.configuration().then(
          () => true,
          () => false,
        ),
      };
    }
    return this.availabilityCache.value;
  }

  private async actor(email: string, session?: ClientSession) {
    if (typeof email !== 'string' || !email.trim())
      throw new ForbiddenException('Se requiere una sesion valida.');
    const member = await this.members
      .findOne({ email: email?.trim().toLowerCase() })
      .session(session || null)
      .lean()
      .exec();
    if (!member?.statePlayer) throw new ForbiddenException('La cuenta no esta activa.');
    return member;
  }

  private async ready() {
    const [dues, payments, audit] = await Promise.all([
      this.dues.collection.indexes(),
      this.payments.collection.indexes(),
      this.audit.collection.indexes(),
    ]).catch(() => {
      throw new ServiceUnavailableException(
        'Faltan colecciones o indices financieros verificados.',
      );
    });
    for (const [rows, keys] of [
      [dues, 'beneficiaryId,period'],
      [payments, 'publicReference'],
      [payments, 'idempotency.actorId,idempotency.key'],
      [payments, 'provider.name,provider.paymentId'],
      [audit, 'eventId'],
    ] as const)
      if (!rows.some((row) => row.unique && Object.keys(row.key).join(',') === keys))
        throw new ServiceUnavailableException('Faltan indices financieros verificados.');
  }

  private reference(reference: string) {
    if (!/^membership-[a-f\d-]{36}$/i.test(reference))
      throw new BadRequestException('Referencia mensual invalida.');
  }

  async checkout(email: string, dueIds: string[], key: string) {
    const settings = this.settings();
    await this.ready();
    if (!/^[a-z\d_-]{16,100}$/i.test(key || ''))
      throw new BadRequestException('Falta una clave de idempotencia valida.');
    if (
      !Array.isArray(dueIds) ||
      !dueIds.length ||
      dueIds.length > 100 ||
      new Set(dueIds).size !== dueIds.length
    )
      throw new BadRequestException('Seleccion de cuotas invalida.');
    dueIds.forEach(assertMemberId);
    const verified = await this.configuration();
    const now = this.clock();
    const hash = createHash('sha256')
      .update(JSON.stringify({ purpose: 'MEMBERSHIP', dueIds: [...dueIds].sort() }))
      .digest('hex');
    const attempt = await this.payments.db.transaction(async (session) => {
      const actor = await this.actor(email, session);
      const old = await this.payments
        .findOne({ 'idempotency.actorId': actor._id, 'idempotency.key': key })
        .session(session)
        .lean();
      if (old) {
        if (old.method !== 'MERCADO_PAGO' || old.idempotency.hash !== hash)
          throw new ConflictException('La clave ya se uso con otra seleccion.');
        return { payment: old, created: false };
      }
      const quote = await this.core.quoteInSession(String(actor._id), dueIds, session, now);
      const people = await this.members
        .find({ _id: { $in: quote.allocations.map((row) => row.beneficiaryId) } })
        .session(session)
        .lean();
      // Being an admin is not permission to initiate a personal checkout for unrelated members.
      for (const person of people) assertCanManage({ ...actor, role: 'user' }, person);
      const overlapping = await this.payments
        .findOne({
          method: 'MERCADO_PAGO',
          'allocations.dueId': { $in: dueIds },
          $or: [
            { status: { $in: ['PENDING', 'REVIEW_REQUIRED'] } },
            { 'checkout.creationStatus': 'UNKNOWN' },
            { 'checkout.expiresAt': { $gt: now }, status: { $in: ['REJECTED', 'CANCELLED'] } },
          ],
        })
        .session(session)
        .lean();
      if (overlapping)
        throw new ConflictException({
          message:
            'Ya existe un intento para una cuota seleccionada. Consulta su estado antes de pagar otra vez.',
          ...(String(overlapping.payer.memberId) === String(actor._id)
            ? { reference: overlapping.publicReference }
            : {}),
        });
      const reference = `membership-${randomUUID()}`;
      const [payment] = await this.payments.create(
        [
          {
            publicReference: reference,
            payer: { memberId: actor._id, name: actor.namePlayer, email: actor.email },
            method: 'MERCADO_PAGO',
            status: 'PENDING',
            amount: quote.amount,
            currency: 'CLP',
            pricingMode: quote.pricingMode,
            allocations: quote.allocations.map((row) => ({
              ...row,
              beneficiaryName: people.find((person) => String(person._id) === row.beneficiaryId)
                ?.namePlayer,
            })),
            idempotency: { actorId: actor._id, key, hash },
            checkout: {
              reference,
              creationStatus: 'CREATING',
              expiresAt: new Date(now.getTime() + 30 * 60000),
              expectedCollectorId: verified.collectorId,
            },
            notifications: [],
          },
        ],
        { session },
      );
      await this.auditEvent(
        payment,
        `${reference}:checkout`,
        'CREATE',
        'USER',
        actor.namePlayer,
        { status: 'PENDING', reference, amount: quote.amount },
        session,
      );
      return { payment: payment.toObject(), created: true };
    });
    if (!attempt.created) return this.state(email, attempt.payment.publicReference);
    try {
      const response = await axios.post(
        `${settings.base}/membership/create-preference`,
        {
          purpose: 'MEMBERSHIP',
          reference: attempt.payment.publicReference,
          amount: attempt.payment.amount,
          pricingMode: attempt.payment.pricingMode,
          expiresAt: attempt.payment.checkout.expiresAt.toISOString(),
        },
        { headers: { 'x-api-key': settings.key }, timeout: 30000 },
      );
      const result = response.data;
      const url = new URL(result.initPoint);
      if (
        typeof result.preferenceId !== 'string' ||
        !result.preferenceId ||
        result.collectorId !== verified.collectorId ||
        typeof result.liveMode !== 'boolean' ||
        (!result.liveMode && attempt.payment.pricingMode !== 'TEST') ||
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        !/^(www\.|sandbox\.)?mercadopago\.(cl|com|com\.ar|com\.br)$/.test(url.hostname)
      )
        throw new Error('Invalid provider preference response.');
      await this.payments.updateOne(
        { _id: attempt.payment._id, 'checkout.creationStatus': 'CREATING' },
        {
          $set: {
            'checkout.creationStatus': 'READY',
            'checkout.url': result.initPoint,
            'provider.name': 'MERCADO_PAGO',
            'provider.preferenceId': result.preferenceId,
            'checkout.expectedLiveMode': result.liveMode,
          },
        },
      );
    } catch {
      await this.payments.updateOne(
        { _id: attempt.payment._id, 'checkout.creationStatus': 'CREATING' },
        { $set: { 'checkout.creationStatus': 'UNKNOWN' } },
      );
      throw new GatewayTimeoutException({
        code: 'CHECKOUT_UNKNOWN',
        reference: attempt.payment.publicReference,
        message:
          'No se pudo confirmar la creacion del enlace. Consulta este intento; no generes otro pago.',
      });
    }
    return this.state(email, attempt.payment.publicReference);
  }

  async state(email: string, reference: string) {
    this.reference(reference);
    const actor = await this.actor(email);
    const payment = await this.payments
      .findOne({ publicReference: reference, method: 'MERCADO_PAGO' })
      .lean();
    if (!payment) throw new NotFoundException('Intento de pago no encontrado.');
    const payer = String(payment.payer.memberId) === String(actor._id);
    const permitted = payer
      ? payment.allocations
      : payment.allocations.filter((row) => String(row.beneficiaryId) === String(actor._id));
    if (!permitted.length) throw new ForbiddenException('No puedes consultar este pago.');
    const resume =
      payer &&
      payment.checkout?.creationStatus === 'READY' &&
      payment.checkout.expiresAt > this.clock() &&
      ['PENDING', 'REJECTED'].includes(payment.status);
    return {
      reference,
      status: payment.status,
      amount: permitted.reduce((sum, row) => sum + row.amount, 0),
      currency: 'CLP',
      allocations: permitted.map((row) => ({
        beneficiaryId: String(row.beneficiaryId),
        period: row.period,
        amount: row.amount,
        name: row.beneficiaryName,
      })),
      checkoutStatus: payment.checkout?.creationStatus,
      initPoint: resume ? payment.checkout.url : null,
      providerPaymentId: payment.provider?.paymentId || null,
      providerStatus: payment.provider?.status || null,
      reviewReasons: payment.reviewReasons,
      expiresAt: payment.checkout?.expiresAt,
    };
  }

  async reconcile(email: string, reference: string) {
    await this.state(email, reference);
    const actor = await this.actor(email);
    await this.requestReconciliation(reference, actor._id);
    return this.state(email, reference);
  }

  // Internal worker only: evidence still comes from the authenticated payment service.
  async reconcileForBilling(reference: string) {
    this.reference(reference);
    await this.requestReconciliation(reference);
  }

  private async requestReconciliation(reference: string, payerId?: unknown) {
    const settings = this.settings();
    const now = this.clock();
    const payment = await this.payments
      .findOneAndUpdate(
        {
          publicReference: reference,
          method: 'MERCADO_PAGO',
          ...(payerId ? { 'payer.memberId': payerId } : {}),
          $or: [
            { 'checkout.lastReconciledAt': { $exists: false } },
            { 'checkout.lastReconciledAt': { $lt: new Date(now.getTime() - 15000) } },
          ],
        },
        { $set: { 'checkout.lastReconciledAt': now } },
        { new: true },
      )
      .lean();
    if (!payment) return;
    const response = await axios.post(
      `${settings.base}/membership/reconcile`,
      { reference },
      { headers: { 'x-api-key': settings.key }, timeout: 15000 },
    );
    // Only a complete provider search after expiry plus a safety buffer can release an empty attempt.
    if (
      response.data?.queued === 0 &&
      payment.checkout?.expiresAt < new Date(now.getTime() - 30 * 60000)
    ) {
      await this.payments.db.transaction(async (session) => {
        const expired = await this.payments
          .findOneAndUpdate(
            { _id: payment._id, status: 'PENDING', 'provider.paymentId': { $exists: false } },
            { $set: { status: 'CANCELLED', 'checkout.creationStatus': 'FAILED' } },
            { session, new: true },
          )
          .lean();
        if (expired)
          await this.auditEvent(
            expired,
            `${reference}:expired-reconciled`,
            'STATE_CHANGE',
            'SYSTEM',
            'Mercado Pago',
            { reason: 'EXPIRED_RECONCILED_WITHOUT_PAYMENT' },
            session,
          );
      });
    }
  }

  async receive(paymentId: string) {
    const settings = this.settings();
    await this.ready();
    if (!/^\d{1,30}$/.test(paymentId)) throw new BadRequestException('ID de operacion invalido.');
    // Browser/callback claims are never evidence. Read the provider again through the authenticated service.
    const response = await axios.get<MembershipProviderSnapshot>(
      `${settings.base}/membership/payments/${paymentId}`,
      {
        headers: { 'x-api-key': settings.key },
        timeout: 15000,
      },
    );
    const snapshot = response.data;
    if (
      !snapshot ||
      snapshot.paymentId !== paymentId ||
      snapshot.purpose !== 'MEMBERSHIP' ||
      typeof snapshot.status !== 'string' ||
      !Number.isSafeInteger(snapshot.amount) ||
      snapshot.amount <= 0 ||
      typeof snapshot.currency !== 'string' ||
      !/^\d+$/.test(snapshot.collectorId || '') ||
      typeof snapshot.liveMode !== 'boolean' ||
      !Number.isSafeInteger(snapshot.refundedAmount) ||
      snapshot.refundedAmount < 0 ||
      !snapshot.preference?.id ||
      !/^\d+$/.test(snapshot.preference.collectorId || '') ||
      typeof snapshot.preference.liveMode !== 'boolean'
    )
      throw new ServiceUnavailableException('Evidencia del proveedor incompleta.');
    this.reference(snapshot.reference);
    const eventId = `membership:mp:${createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')}`;
    const now = this.clock();
    return this.payments.db.transaction(async (session) => {
      const original = await this.payments
        .findOne({ publicReference: snapshot.reference, method: 'MERCADO_PAGO' })
        .session(session)
        .lean();
      if (!original)
        throw new NotFoundException('La referencia no corresponde a un checkout mensual.');
      const receipt = await this.payments
        .findOne({ 'provider.name': 'MERCADO_PAGO', 'provider.paymentId': paymentId })
        .session(session)
        .lean();
      if (
        receipt &&
        String(receipt._id) !== String(original._id) &&
        receipt.checkout?.reference !== original.publicReference
      )
        throw new ConflictException('La operacion ya esta vinculada a otra referencia.');
      if (await this.audit.exists({ eventId }).session(session))
        return { status: (receipt || original).status, duplicate: true };
      let payment = receipt || original;
      const evidence = {
        name: 'MERCADO_PAGO',
        paymentId,
        preferenceId: snapshot.preference.id,
        status: snapshot.status,
        verifiedAt: now,
        receivedAmount: snapshot.amount,
        currency: snapshot.currency,
        collectorId: snapshot.collectorId,
        liveMode: snapshot.liveMode,
        refundedAmount: snapshot.refundedAmount,
        ...(snapshot.updatedAt && Number.isFinite(Date.parse(snapshot.updatedAt))
          ? { updatedAt: new Date(snapshot.updatedAt) }
          : {}),
      };
      const reasons: string[] = [];
      if (snapshot.collectorId !== original.checkout?.expectedCollectorId)
        reasons.push('COLLECTOR_MISMATCH');
      if (snapshot.preference.collectorId !== original.checkout?.expectedCollectorId)
        reasons.push('PREFERENCE_COLLECTOR_MISMATCH');
      if (
        snapshot.liveMode !== snapshot.preference.liveMode ||
        (typeof original.checkout?.expectedLiveMode === 'boolean' &&
          snapshot.liveMode !== original.checkout.expectedLiveMode)
      )
        reasons.push('MODE_MISMATCH');
      if (
        original.provider?.preferenceId &&
        original.provider.preferenceId !== snapshot.preference.id
      )
        reasons.push('PREFERENCE_MISMATCH');
      if (snapshot.currency !== original.currency) reasons.push('CURRENCY_MISMATCH');
      if (snapshot.amount !== original.amount) reasons.push('AMOUNT_MISMATCH');
      if (snapshot.pricingMode !== original.pricingMode) reasons.push('PRICING_MODE_MISMATCH');
      if (!snapshot.liveMode && original.pricingMode !== 'TEST')
        reasons.push('SANDBOX_STANDARD_PAYMENT');
      const returned =
        ['refunded', 'charged_back'].includes(snapshot.status) || snapshot.refundedAmount > 0;
      if (returned) reasons.push('REFUND_OR_CHARGEBACK');
      const isOther = original.provider?.paymentId && original.provider.paymentId !== paymentId;
      const duplicateCaptured =
        !receipt &&
        isOther &&
        ['CONFIRMED', 'REVIEW_REQUIRED'].includes(original.status) &&
        (snapshot.status === 'approved' || returned);
      if (duplicateCaptured) {
        const [created] = await this.payments.create(
          [
            {
              publicReference: `membership-review-${paymentId}`,
              method: 'MERCADO_PAGO',
              status: 'REVIEW_REQUIRED',
              payer: original.payer,
              amount: original.amount,
              currency: original.currency,
              pricingMode: original.pricingMode,
              allocations: original.allocations,
              provider: evidence,
              checkout: { reference: original.publicReference },
              reviewReasons: [...reasons, 'DUPLICATE_PROVIDER_PAYMENT'],
              notifications: [],
            },
          ],
          { session },
        );
        payment = created.toObject();
      } else if (isOther && original.status === 'CONFIRMED' && !receipt) {
        await this.auditEvent(
          original,
          eventId,
          'UPDATE',
          'SYSTEM',
          'Mercado Pago',
          { ignored: true, evidence },
          session,
        );
        return { status: original.status, ignored: true };
      }
      let status = payment.status;
      const set: Record<string, unknown> = {};
      const wasConfirmed = payment.status === 'CONFIRMED';
      const stickyReview = payment.status === 'REVIEW_REQUIRED';
      if (reasons.length || duplicateCaptured || stickyReview) status = 'REVIEW_REQUIRED';
      else if (snapshot.status === 'approved') {
        const approvedAt = new Date(snapshot.approvedAt || 'invalid');
        if (
          !Number.isFinite(approvedAt.getTime()) ||
          approvedAt > new Date(now.getTime() + 300000)
        ) {
          reasons.push('INVALID_APPROVAL_DATE');
          status = 'REVIEW_REQUIRED';
        } else if (!wasConfirmed) {
          const rows = await this.dues
            .find({ _id: { $in: payment.allocations.map((row) => row.dueId) } })
            .session(session)
            .lean();
          const available = payment.allocations.every((row) =>
            rows.some(
              (due) =>
                String(due._id) === String(row.dueId) &&
                due.status === 'OPEN' &&
                String(due.beneficiaryId) === String(row.beneficiaryId) &&
                due.period === row.period &&
                due.amount === row.amount &&
                due.pricingMode === payment.pricingMode,
            ),
          );
          if (!available) {
            reasons.push('DUES_ALREADY_SETTLED_OR_CHANGED');
            status = 'REVIEW_REQUIRED';
          } else {
            for (const row of payment.allocations) {
              const updated = await this.dues.updateOne(
                { _id: row.dueId, status: 'OPEN', amount: row.amount },
                { $set: { status: 'PAID', settlementPaymentId: payment._id, paidAt: approvedAt } },
                { session },
              );
              if (updated.modifiedCount !== 1)
                throw new ConflictException('Una cuota cambio durante la confirmacion.');
            }
            status = 'CONFIRMED';
            set.paidAt = approvedAt;
            set.confirmedAt = now;
            if (payment.payer.email)
              set.notifications = [
                {
                  recipient: payment.payer.email,
                  eventKey: `${payment.publicReference}:confirmed`,
                  kind: 'CONFIRMED',
                  status: 'PENDING',
                  attempts: 0,
                  nextAttemptAt: now,
                },
              ];
          }
        }
      } else if (!wasConfirmed) {
        status =
          snapshot.status === 'rejected'
            ? 'REJECTED'
            : snapshot.status === 'cancelled'
              ? 'CANCELLED'
              : 'PENDING';
      }
      // A late pending/rejected event cannot degrade the confirmed evidence or cancel its mail.
      const preserve =
        wasConfirmed && !returned && snapshot.status !== 'approved' && !reasons.length;
      if (!preserve) set.provider = { ...payment.provider, ...evidence };
      set.status = status;
      if (reasons.length) set.reviewReasons = [...new Set([...payment.reviewReasons, ...reasons])];
      await this.payments.updateOne({ _id: payment._id }, { $set: set }, { session });
      await this.auditEvent(
        payment,
        eventId,
        'PAYMENT_CONFIRMATION',
        'SYSTEM',
        'Mercado Pago',
        {
          beforeStatus: payment.status,
          status,
          evidence,
          reviewReasons: set.reviewReasons || payment.reviewReasons,
        },
        session,
      );
      return { status, duplicate: false };
    });
  }

  private auditEvent(
    payment: any,
    eventId: string,
    action: string,
    performedBy: string,
    actor: string,
    afterData: object,
    session: ClientSession,
  ) {
    return this.audit.create(
      [
        {
          eventId,
          entityType: 'MEMBERSHIP_PAYMENT',
          entityId: String(payment._id),
          action,
          performedBy,
          performedByUser: actor,
          description: 'Movimiento de mensualidad Mercado Pago verificado por servidor.',
          afterData,
          timestamp: this.clock(),
        },
      ],
      { session },
    );
  }
}
