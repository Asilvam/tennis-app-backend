import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MatchResultDocument = MatchRanking & Document;

@Schema({ collection: 'match_result', timestamps: true })
export class MatchRanking {
  @Prop({ required: true })
  matchId: string; // ID del partido para relacionarlo con otra colección de partidos

  @Prop({ required: true })
  player1: string; // Nombre del jugador 1 o del equipo 1 (si es dobles)

  @Prop({ required: true })
  player2: string; // Nombre del jugador 2 o del equipo 2 (si es dobles)

  @Prop()
  player3?: string; // Opcional, para partidos de dobles

  @Prop()
  player4?: string; // Opcional, para partidos de dobles

  @Prop({ required: true, default: false })
  isDoubles: boolean; // Indica si es un partido de dobles

  @Prop({ required: true })
  result: string; // Ejemplo: "6-4, 3-6, 7-5"

  @Prop({ required: true })
  winner: string; // Nombre del ganador o equipo ganador

  @Prop()
  matchDate?: Date; // Fecha del partido
}

export const MatchResultSchema = SchemaFactory.createForClass(MatchRanking);
