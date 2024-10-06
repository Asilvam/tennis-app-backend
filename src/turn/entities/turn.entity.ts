import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ collection: 'turn', timestamps: true })
export class Turn extends Document {
  @Prop({ required: true, unique: true })
  turnNumber: number;

  @Prop({ required: true, default: true })
  state: boolean;

  @Prop({ required: true })
  schedule: string;

  @Prop({ required: true, default: false })
  isPayed: boolean;
}

export const TurnSchema = SchemaFactory.createForClass(Turn);
