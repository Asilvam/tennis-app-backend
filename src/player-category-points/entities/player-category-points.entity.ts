import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PlayerCategoryPointsDocument = PlayerCategoryPoints & Document;

@Schema({ collection: 'player_category_points', timestamps: true })
export class PlayerCategoryPoints {
  @Prop({ required: true })
  playerEmail: string; // Referencia al jugador

  @Prop({ required: true })
  category: string; // '1', '2', '3', '4', 'Damas', '+55', etc.

  @Prop({ required: true, default: 0 })
  points: number;

  @Prop({ default: true })
  isActive: boolean; // Por si el jugador deja de participar en esa categoría
}

export const PlayerCategoryPointsSchema = SchemaFactory.createForClass(PlayerCategoryPoints);

// Índice único compuesto para evitar duplicados por jugador + categoría
PlayerCategoryPointsSchema.index({ playerEmail: 1, category: 1 }, { unique: true });
