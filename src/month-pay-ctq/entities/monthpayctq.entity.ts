import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MonthPayCtqDocument = HydratedDocument<MonthPayCtq>;

@Schema({
  collection: 'monthpayctq', // Exact physical name of the MongoDB collection
  timestamps: true,
  versionKey: false,
})
export class MonthPayCtq {
  @Prop({ required: true })
  namePlayer: string;

  @Prop({ required: true })
  email: string;

  @Prop({ required: true })
  paymentType: string; // 'Titular' or 'Familiar'

  @Prop({ required: true })
  amount: number; // 18000 or 5000

  @Prop({ required: true })
  monthToPay: string; // MM-YYYY format

  @Prop({ required: false })
  emailCarga?: string; // Optional beneficiary/dependent's email

  @Prop({ required: true, unique: true })
  idPayment: string; // Compact unique 15-character UUID

  @Prop({ required: true, default: 'pending' })
  status: string; // 'pending', 'approved', 'rejected'
}

export const MonthPayCtqSchema = SchemaFactory.createForClass(MonthPayCtq);
