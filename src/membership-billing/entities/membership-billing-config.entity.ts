import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { BILLING_CONFIG_KEY, BILLING_TIMEZONE, TariffVersion } from '../billing.types';
import { assertConfiguration } from '../billing.policy';

@Schema({
  collection: 'membership_billing_config',
  timestamps: true,
  autoCreate: false,
  autoIndex: false,
  optimisticConcurrency: true,
})
export class MembershipBillingConfig {
  @Prop({ required: true, enum: [BILLING_CONFIG_KEY] }) key: string;
  @Prop({ required: true }) billingStartsAtPeriod: string;
  @Prop({ required: true, enum: [BILLING_TIMEZONE] }) timezone: string;
  @Prop({ required: true, enum: [5] }) dueDayNextMonth: number;
  @Prop({ required: true, enum: [3] }) maxAdvanceMonths: number;
  @Prop({ required: true, default: false }) autoBlockEnabled: boolean;
  @Prop({
    type: [
      {
        id: String,
        effectiveFromPeriod: String,
        currency: { type: String, enum: ['CLP'] },
        titular: Number,
        carga: Number,
      },
    ],
    required: true,
  })
  tariffVersions: TariffVersion[];
  @Prop({
    type: { enabled: Boolean, memberIds: [String], titular: Number, carga: Number },
    required: true,
    _id: false,
  })
  testPricing: { enabled: boolean; memberIds: string[]; titular: number; carga: number };
  @Prop({
    type: {
      migrationId: String,
      establishedAt: Date,
      establishedBy: String,
      throughPeriod: String,
    },
    _id: false,
  })
  baseline?: {
    migrationId?: string;
    establishedAt?: Date;
    establishedBy?: string;
    throughPeriod?: string;
  };
  @Prop({
    type: {
      migrationReviewed: Boolean,
      reviewedAt: Date,
      reviewedBy: String,
      activatedAt: Date,
      activatedBy: String,
    },
    _id: false,
  })
  activation?: {
    migrationReviewed?: boolean;
    reviewedAt?: Date;
    reviewedBy?: string;
    activatedAt?: Date;
    activatedBy?: string;
  };
}

export const MembershipBillingConfigSchema = SchemaFactory.createForClass(MembershipBillingConfig);
MembershipBillingConfigSchema.index({ key: 1 }, { unique: true });
MembershipBillingConfigSchema.pre('validate', function () {
  try {
    assertConfiguration(this.toObject());
    if (this.autoBlockEnabled && !this.activation?.migrationReviewed)
      this.invalidate('activation', 'Review migration before enabling automatic blocking.');
  } catch (error) {
    this.invalidate('key', error.message);
  }
});
