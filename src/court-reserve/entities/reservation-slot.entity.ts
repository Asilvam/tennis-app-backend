import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export type SlotStatus = 'HELD' | 'CHECKOUT' | 'CONFIRMED' | 'RELEASED' | 'EXPIRED' | 'REVIEW';

@Schema({ collection: 'reservation_slots', timestamps: true })
export class ReservationSlot {
  @Prop({ type: String })
  _id: string;

  @Prop({ required: true })
  reservationId: string;

  @Prop({ required: true })
  court: string;

  @Prop({ required: true })
  dateToPlay: string;

  @Prop({ required: true })
  turn: string;

  @Prop({ required: false })
  ownerEmail?: string;

  @Prop({ required: true, enum: ['HELD', 'CHECKOUT', 'CONFIRMED', 'RELEASED', 'EXPIRED', 'REVIEW'] })
  status: SlotStatus;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop({ required: false })
  preferenceId?: string;

  @Prop({ required: false })
  initPoint?: string;

  @Prop({ required: false })
  nextReconcileAt?: Date;

  @Prop({ required: false })
  reconcileUntil?: Date;

  @Prop({ required: false })
  reconciliationToken?: string;
}

export const ReservationSlotSchema = SchemaFactory.createForClass(ReservationSlot);
ReservationSlotSchema.index({ status: 1, expiresAt: 1, nextReconcileAt: 1 });
ReservationSlotSchema.index({ reservationId: 1 });
// No TTL: expiration releases the slot but preserves payment/audit history.
