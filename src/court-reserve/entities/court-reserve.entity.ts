import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type CourtReserveDocument = CourtReserve & Document;

@Schema({ collection: 'court_reserve', timestamps: true })
export class CourtReserve {
  @Prop({
    required: true,
    default: () => uuidv4().replace(/-/g, '').substring(0, 6),
    unique: true,
  })
  idCourtReserve: string;

  @Prop({
    required: true,
    default: () => uuidv4().replace(/-/g, '').substring(0, 4),
  })
  passCourtReserve: string;

  @Prop({ required: true })
  court: string;

  @Prop({ required: false })
  player1?: string;

  @Prop({ required: false })
  player2?: string;

  @Prop({ required: false })
  player3?: string;

  @Prop({ required: false })
  player4?: string;

  @Prop({ required: true })
  dateToPlay: string;

  @Prop({ required: true })
  turn: string;

  @Prop({ default: true })
  state: boolean;

  @Prop({ default: false })
  resultMatchUpdated: boolean;

  @Prop({ enum: ['PENDING', 'RECORDED', 'EXPIRED'] })
  rankingResultStatus?: 'PENDING' | 'RECORDED' | 'EXPIRED';

  @Prop()
  rankingResultExpiredAt?: Date;

  @Prop({ default: false })
  isPaidNight: boolean;

  @Prop({ default: false })
  wasPaid: boolean;

  @Prop({ required: false })
  paymentStatus?: string;

  @Prop({ required: false })
  paymentIdempotencyKey?: string;

  @Prop({ required: false })
  paidAt?: Date;

  @Prop({ required: false })
  reservationStatus?: string;

  @Prop({ required: false })
  holdExpiresAt?: Date;

  @Prop({ required: false })
  ownerEmail?: string;

  @Prop({ required: false })
  checkoutReady?: boolean;

  @Prop({ default: false })
  isDouble: boolean;

  @Prop({ default: false })
  isVisit: boolean;

  @Prop({ required: false })
  visitName?: string;

  @Prop({ default: false })
  isForRanking: boolean;

  @Prop({ default: false })
  isBlockedByAdmin: boolean;

  @Prop({ default: '' })
  blockedMotive: string;
}

export const CourtReserveSchema = SchemaFactory.createForClass(CourtReserve);

CourtReserveSchema.pre('save', function (next) {
  if (this.isPaidNight || this.isVisit) {
    this.state = Boolean(this.wasPaid);
  } else {
    this.state = true;
  }
  next();
});
