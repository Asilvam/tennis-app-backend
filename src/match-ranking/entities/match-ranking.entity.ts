import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MatchResultDocument = MatchRanking & Document;

// Sub-esquema para cada categoría del jugador en el partido
const playerCategorySchema = {
  category: { type: String, required: true },
  points: { type: Number, required: true },
  isActive: { type: Boolean, required: true },
};

// Sub-esquema para cada jugador dentro del partido
const playerMatchSchema = {
  email: { type: String, required: true },
  name: { type: String, required: true },
  cellular: { type: String, required: true },
  categories: { type: [playerCategorySchema], required: true },
};

@Schema({ collection: 'match_result', timestamps: true })
export class MatchRanking {
  @Prop({ required: true })
  matchId: string; // ID del partido para relacionarlo con otra colección de partidos

  @Prop({ required: true })
  result: string; // Ejemplo: "6:4, 3:6, 7:5"

  @Prop({ type: [playerMatchSchema], required: true })
  winner: { email: string; name: string; cellular: string; categories: { category: string; points: number; isActive: boolean }[] }[];

  @Prop({ type: [playerMatchSchema], required: true })
  looser: { email: string; name: string; cellular: string; categories: { category: string; points: number; isActive: boolean }[] }[];
}

export const MatchResultSchema = SchemaFactory.createForClass(MatchRanking);
