import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CourtReserveDocument = CourtReserve & Document;

@Schema({ collection: 'court_reserve', timestamps: true })
export class CourtReserve {
  @Prop({ required: true })
  court: string;

  @Prop({ required: true })
  player1: string;

  @Prop({ required: true })
  player2: string;

  @Prop({ required: true })
  dateToPlay: string;

  @Prop({ required: true })
  turn: string;

  @Prop({ default: true })
  state: boolean;
}

export const CourtReserveSchema = SchemaFactory.createForClass(CourtReserve);
