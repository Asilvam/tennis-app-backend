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

  @Prop({ required: false })
  socioPrincipal?: boolean;

  @Prop({ required: false, enum: Object.values(TipoSocio), default: TipoSocio.TITULAR })
  montoPagar: TipoSocio;

  // ❌ ELIMINADOS: category, points, pointsDoubles
  // Ahora las categorías y puntos están en la tabla player_category_points

  @Prop({ default: false })
  isLigthNigth: boolean;

  @Prop({ default: false })
  statePlayer: boolean;

  @Prop({ default: true })
  updatePayment: boolean;

  @Prop({ default: false })
  hasVoted: boolean;

  @Prop({
    type: String,
    required: false, // No es requerido, ya que tendrá un valor por defecto
    default: '/images/avatar-fantasma.png',
  })
  imageUrlProfile: string;
}

export const RegisterSchema = SchemaFactory.createForClass(Register);
