import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ collection: 'court', timestamps: true })
export class Court extends Document {
  @Prop({ required: true })
  courtNumber: number;

  @Prop({ required: true, default: true })
  state: boolean;

  @Prop({ required: true })
  courtName: string;

  @Prop()
  courtScheduleTurn?: string[];
}

export const CourtSchema = SchemaFactory.createForClass(Court);
