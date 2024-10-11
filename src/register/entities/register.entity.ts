import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type RegisterDocument = Register & Document;

@Schema({ collection: 'register', timestamps: true })
export class Register {
  @Prop({ required: true })
  namePlayer: string;

  @Prop({ unique: true, required: true })
  email: string;

  @Prop({ unique: true, required: true })
  cellular: string;

  @Prop({ required: true, select: false })
  pwd: string;

  @Prop({ default: true })
  statePlayer: boolean;

  @Prop({ default: false })
  emailVerified: boolean;

  @Prop({ default: () => uuidv4().replace(/-/g, '').substring(0, 10) })
  verificationToken: string;

  @Prop({ type: String, enum: ['admin', 'user'], default: 'user' })
  role: string;
}

export const RegisterSchema = SchemaFactory.createForClass(Register);
