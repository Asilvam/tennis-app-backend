import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';
import { DueStatus, PricingMode, BillingMemberType } from '../billing.types';

const positiveInteger = {
  validator: (value: number) => Number.isSafeInteger(value) && value > 0,
  message: 'Expected a positive CLP integer.',
};

@Schema({ collection: 'membership_dues', timestamps: true, autoCreate: false, autoIndex: false })
export class MembershipDue {
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'Register', required: true })
  beneficiaryId: Types.ObjectId;
  @Prop({ required: true, match: /^[2-9]\d{3}-(0[1-9]|1[0-2])$/ }) period: string;
  @Prop({ required: true }) dueAt: Date;
  @Prop({ type: String, required: true, enum: ['TITULAR', 'CARGA'], immutable: true })
  memberTypeSnapshot: BillingMemberType;
  @Prop({ required: true, immutable: true }) tariffVersionId: string;
  @Prop({ required: true, immutable: true, validate: positiveInteger }) amount: number;
  @Prop({ required: true, enum: ['CLP'], immutable: true }) currency: string;
  @Prop({ type: String, required: true, enum: ['OPEN', 'PAID'], default: 'OPEN' })
  status: DueStatus;
  @Prop({ type: MongoSchema.Types.ObjectId, ref: 'MembershipPayment' })
  settlementPaymentId?: Types.ObjectId;
  @Prop() paidAt?: Date;
  @Prop({ type: String, required: true, enum: ['STANDARD', 'TEST'], immutable: true })
  pricingMode: PricingMode;
  @Prop({ type: { migrationId: String, sourceId: String }, _id: false }) migration?: {
    migrationId: string;
    sourceId?: string;
  };
}

export const MembershipDueSchema = SchemaFactory.createForClass(MembershipDue);
MembershipDueSchema.index({ beneficiaryId: 1, period: 1 }, { unique: true });
MembershipDueSchema.index({ beneficiaryId: 1, status: 1, dueAt: 1 });
MembershipDueSchema.index({ period: 1, status: 1, beneficiaryId: 1 });
MembershipDueSchema.pre('validate', function () {
  // eslint-disable-next-line max-len
  if (this.status === 'PAID' && (!this.settlementPaymentId || !this.paidAt))
    this.invalidate('status', 'A settled due requires its payment and effective date.');
  // eslint-disable-next-line max-len
  if (this.status === 'OPEN' && (this.settlementPaymentId || this.paidAt))
    this.invalidate('status', 'An open due cannot retain a settlement.');
});
