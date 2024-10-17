import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ collection: 'subscription', timestamps: true })
export class Subscription extends Document {
  @Prop({ required: true })
  endpoint: string;

  @Prop({
    type: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
  })
  keys: {
    p256dh: string;
    auth: string;
  };
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
