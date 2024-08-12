import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Role } from '../../common/enums/rol.enum';

export type RegisterDocument = Register & Document;

@Schema({ collection: 'register', timestamps: true })
export class Register {
  @Prop({ required: true })
  namePlayer: string;

  @Prop({ unique: true, required: true })
  email: string;

  @Prop({ required: true })
  cellular: string;

  @Prop({ required: true, select: false })
  pwd: string;

  @Prop({ default: true })
  statePlayer: boolean;

  @Prop({ type: String, enum: Role, default: Role.USER })
  role: Role;
}

export const RegisterSchema = SchemaFactory.createForClass(Register);
