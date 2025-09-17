import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MatchResultDocument = MatchRanking & Document;

@Schema({ collection: 'match_result', timestamps: true })
export class MatchRanking {
  @Prop({ required: true })
  matchId: string; // ID del partido para relacionarlo con otra colección de partidos

  @Prop({ required: true })
  result: string; // Ejemplo: "6:4, 3:6, 7:5"

  @Prop({ required: true })
  winner: [{ email: string; points: string; category: string; cellular: string }];

  @Prop({ required: true })
  looser: [{ email: string; points: string; category: string; cellular: string }];
}

export const MatchResultSchema = SchemaFactory.createForClass(MatchRanking);
