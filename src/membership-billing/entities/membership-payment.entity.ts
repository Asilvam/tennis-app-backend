import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';
import { PaymentMethod, PaymentStatus, PricingMode } from '../billing.types';

const money = {
  type: Number,
  required: true,
  validate: (value: number) => Number.isSafeInteger(value) && value > 0,
};
const allocation = new MongoSchema(
  {
    dueId: { type: MongoSchema.Types.ObjectId, required: true },
    beneficiaryId: { type: MongoSchema.Types.ObjectId, required: true },
    period: { type: String, required: true, match: /^[2-9]\d{3}-(0[1-9]|1[0-2])$/ },
    amount: money,
    beneficiaryName: String,
  },
  { _id: false },
);

@Schema({
  collection: 'membership_payments',
  timestamps: true,
  autoCreate: false,
  autoIndex: false,
})
export class MembershipPayment {
  @Prop({ required: true, immutable: true }) publicReference: string;
  @Prop({
    type: { memberId: MongoSchema.Types.ObjectId, name: String, email: String },
    _id: false,
    required: true,
  })
  payer: { memberId?: Types.ObjectId; name?: string; email?: string };
  @Prop({ type: String, required: true, enum: ['MERCADO_PAGO', 'BANK_TRANSFER', 'BANK_DEPOSIT'] })
  method: PaymentMethod;
  @Prop({
    type: String,
    required: true,
    enum: ['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'REVIEW_REQUIRED', 'REVERSED'],
    default: 'PENDING',
  })
  status: PaymentStatus;
  @Prop(money) amount: number;
  @Prop({ required: true, enum: ['CLP'] }) currency: string;
  @Prop({ type: [allocation], required: true, validate: (rows: unknown[]) => rows.length > 0 })
  allocations: {
    dueId: Types.ObjectId;
    beneficiaryId: Types.ObjectId;
    period: string;
    amount: number;
    beneficiaryName?: string;
  }[];
  @Prop({
    type: {
      name: { type: String, enum: ['MERCADO_PAGO'] },
      paymentId: String,
      preferenceId: String,
      status: String,
      verifiedAt: Date,
      receivedAmount: Number,
      currency: String,
      collectorId: String,
      liveMode: Boolean,
      refundedAmount: Number,
      updatedAt: Date,
    },
    _id: false,
  })
  provider?: {
    name?: string;
    paymentId?: string;
    preferenceId?: string;
    status?: string;
    verifiedAt?: Date;
    receivedAmount?: number;
    currency?: string;
    collectorId?: string;
    liveMode?: boolean;
    refundedAmount?: number;
    updatedAt?: Date;
  };
  @Prop({
    type: {
      url: String,
      reference: String,
      expiresAt: Date,
      creationStatus: { type: String, enum: ['CREATING', 'READY', 'UNKNOWN', 'FAILED'] },
      expectedCollectorId: String,
      expectedLiveMode: Boolean,
      lastReconciledAt: Date,
    },
    _id: false,
  })
  checkout?: {
    url?: string;
    reference?: string;
    expiresAt?: Date;
    creationStatus?: string;
    expectedCollectorId?: string;
    expectedLiveMode?: boolean;
    lastReconciledAt?: Date;
  };
  @Prop({ type: { reference: String, receivedAt: Date }, _id: false }) bank?: {
    reference?: string;
    receivedAt?: Date;
  };
  @Prop() evidence?: string;
  @Prop({ maxlength: 1000 }) notes?: string;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Register' }) registeredBy?: Types.ObjectId;
  @Prop() paidAt?: Date;
  @Prop() confirmedAt?: Date;
  @Prop({ type: { actorId: MongoSchema.Types.ObjectId, key: String, hash: String }, _id: false })
  idempotency?: { actorId?: Types.ObjectId; key?: string; hash?: string };
  @Prop({ type: String, required: true, enum: ['STANDARD', 'TEST'] }) pricingMode: PricingMode;
  @Prop({ type: [String], default: [] }) reviewReasons: string[];
  @Prop({
    type: [
      {
        recipient: String,
        eventKey: String,
        kind: { type: String, enum: ['CONFIRMED', 'REVERSED'] },
        status: { type: String, enum: ['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED'] },
        attempts: Number,
        nextAttemptAt: Date,
        sentAt: Date,
        lastError: String,
        lockedAt: Date,
      },
    ],
    default: [],
  })
  notifications: {
    recipient: string;
    eventKey: string;
    kind?: string;
    status: string;
    attempts: number;
    nextAttemptAt?: Date;
    sentAt?: Date;
    lastError?: string;
    lockedAt?: Date;
  }[];
  @Prop({
    type: {
      actorId: MongoSchema.Types.ObjectId,
      reason: String,
      reversedAt: Date,
      idempotencyKey: String,
    },
    _id: false,
  })
  reversal?: {
    actorId?: Types.ObjectId;
    reason?: string;
    reversedAt?: Date;
    idempotencyKey?: string;
  };
  @Prop({ type: { sourceCollection: String, id: String, verification: String }, _id: false })
  legacy?: { sourceCollection?: string; id?: string; verification?: string };
}

export const MembershipPaymentSchema = SchemaFactory.createForClass(MembershipPayment);
MembershipPaymentSchema.index({ publicReference: 1 }, { unique: true });
MembershipPaymentSchema.index(
  { 'idempotency.actorId': 1, 'idempotency.key': 1 },
  {
    unique: true,
    partialFilterExpression: {
      'idempotency.actorId': { $type: 'objectId' },
      'idempotency.key': { $type: 'string' },
    },
  },
);
MembershipPaymentSchema.index(
  { 'provider.name': 1, 'provider.paymentId': 1 },
  { unique: true, partialFilterExpression: { 'provider.paymentId': { $type: 'string', $gt: '' } } },
);
MembershipPaymentSchema.index({ 'payer.memberId': 1, createdAt: -1 });
MembershipPaymentSchema.index({ 'allocations.beneficiaryId': 1, createdAt: -1 });
MembershipPaymentSchema.index({ status: 1, createdAt: 1 });
MembershipPaymentSchema.index(
  { 'legacy.sourceCollection': 1, 'legacy.id': 1 },
  {
    unique: true,
    partialFilterExpression: {
      'legacy.sourceCollection': { $type: 'string' },
      'legacy.id': { $type: 'string' },
    },
  },
);
MembershipPaymentSchema.pre('validate', function () {
  const allocations = this.allocations || [];
  if (
    allocations.reduce((sum, row) => sum + row.amount, 0) !== this.amount ||
    new Set(allocations.map((row) => String(row.dueId))).size !== allocations.length
  ) {
    this.invalidate(
      'allocations',
      'Allocations must be distinct complete dues and match the total.',
    );
  }
  if (this.provider?.paymentId && this.provider.name !== 'MERCADO_PAGO')
    this.invalidate('provider', 'A provider transaction must identify its provider.');
  if (
    this.status === 'REVERSED' &&
    (!this.reversal?.actorId || !this.reversal.reason?.trim() || !this.reversal.reversedAt)
  )
    this.invalidate('reversal', 'Reversals require a responsible actor, reason and date.');
  if (this.status === 'CONFIRMED') {
    if (!this.paidAt || !this.confirmedAt)
      this.invalidate('paidAt', 'A confirmed payment requires effective and confirmation dates.');
    if (this.method === 'MERCADO_PAGO') {
      if (!this.provider?.paymentId || !this.provider?.verifiedAt)
        this.invalidate(
          'provider',
          'Mercado Pago confirmation requires verified transaction evidence.',
        );
    } else if (!this.registeredBy || !this.bank?.reference?.trim() || !this.bank?.receivedAt) {
      this.invalidate(
        'bank',
        'Bank confirmation requires a reference, effective date and responsible admin.',
      );
    }
  }
});
