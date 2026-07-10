import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type NewsCTQDocument = HydratedDocument<NewsCTQ>;

@Schema({
  collection: 'news_ctq', // Nombre físico de la colección en MongoDB
  timestamps: true,
  versionKey: false,
})
export class NewsCTQ {
  @Prop({ required: true })
  titulo: string;

  @Prop()
  url: string;

  @Prop()
  resumen: string;

  @Prop({ required: true, default: false })
  es_local: boolean;

  @Prop({ required: true })
  fecha: Date;

  @Prop({ required: true })
  fuente: string;
}

export const NewsCTQSchema = SchemaFactory.createForClass(NewsCTQ);
