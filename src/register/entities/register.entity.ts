import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { TipoSocio } from '../enums/tipo-socio.enum';
import { EstadoPago } from '../enums/estado-pago.enum';

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

  @Prop({ default: false })
  emailVerified: boolean;

  @Prop({ default: () => uuidv4().replace(/-/g, '').substring(0, 10) })
  verificationToken: string;

  @Prop({ type: String, enum: ['admin', 'user'], default: 'user' })
  role: string;

  @Prop({ required: true, enum: Object.values(EstadoPago), default: EstadoPago.PAGADO })
  estadoPago: EstadoPago;

  @Prop({ required: true, enum: Object.values(TipoSocio), default: TipoSocio.TITULAR })
  partnerType: TipoSocio;

  @Prop({ type: String, required: false })
  socioPrincipal?: string;

  @Prop({ required: false, enum: Object.values(TipoSocio), default: TipoSocio.TITULAR })
  montoPagar: TipoSocio;

  @Prop({
    type: String,
    enum: [
      '1',
      '2',
      '3',
      '4',
      'Damas',
      'Menores',
      'Menores - Cancha Amarilla',
      'Menores - Cancha Verde',
      'Menores - Cancha Naranja',
      'Menores - Cancha Roja',
    ],
    default: '4',
  })
  category: string;

  @Prop({ required: true, default: '0' })
  points: string;

  @Prop({ default: false })
  statePlayer: boolean;

  @Prop({ default: true })
  updatePayment: boolean;

  @Prop({ default: false })
  hasVoted: boolean;
}

export const RegisterSchema = SchemaFactory.createForClass(Register);
