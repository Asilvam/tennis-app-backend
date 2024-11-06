import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ collection: 'info_item', timestamps: true })
export class InfoItem extends Document {
  @Prop({ required: true, default: true })
  state: boolean;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  content: string;

  @Prop({ required: true })
  imageUrl: string;
}

export const InfoItemSchema = SchemaFactory.createForClass(InfoItem);
