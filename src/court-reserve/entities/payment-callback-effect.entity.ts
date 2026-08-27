import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export enum PaymentCallbackEffectStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  PROCESSED = 'PROCESSED',
  FAILED = 'FAILED',
}

export type PaymentCallbackEffectDocument = HydratedDocument<PaymentCallbackEffect>;

@Schema({ collection: 'payment_callback_effects', timestamps: true })
export class PaymentCallbackEffect {
  @Prop({ required: true, unique: true, index: true })
  idempotencyKey: string;

  @Prop({ required: true, enum: ['RESERVATION_UPDATE', 'EMAIL_CONFIRMATION'] })
  effectType: 'RESERVATION_UPDATE' | 'EMAIL_CONFIRMATION';

  @Prop({ required: true, index: true })
  reservationId: string;

  @Prop({ required: false })
  paymentStatus?: string;

  @Prop({ required: true, enum: PaymentCallbackEffectStatus, default: PaymentCallbackEffectStatus.PENDING, index: true })
  status: PaymentCallbackEffectStatus;

  @Prop({ default: 0 })
  attempts: number;

  @Prop({ required: false })
  lockedAt?: Date;

  @Prop({ required: false })
  processedAt?: Date;

  @Prop({ required: false })
  lastError?: string;
}

export const PaymentCallbackEffectSchema = SchemaFactory.createForClass(PaymentCallbackEffect);
