import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
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

  @Prop({ type: String, select: false, index: true, sparse: true })
  passwordResetTokenHash?: string;

  @Prop({ type: Date, select: false })
  passwordResetExpiresAt?: Date;

  @Prop({ type: Date, select: false })
  passwordResetRequestedAt?: Date;

  // Keep historical recovery metadata hidden; the 24-hour policy no longer writes this array.
  @Prop({ type: [Date], select: false })
  passwordResetRequests?: Date[];

  @Prop({ default: false })
  emailVerified: boolean;

  @Prop({ default: () => uuidv4().replace(/-/g, '').substring(0, 10) })
  verificationToken: string;

  @Prop({ type: String, enum: ['admin', 'user', 'profesor'], default: 'user' })
  role: string;

  @Prop({ required: true, enum: Object.values(EstadoPago), default: EstadoPago.PAGADO })
  estadoPago: EstadoPago;

  @Prop({ required: true, enum: Object.values(TipoSocio), default: TipoSocio.TITULAR })
  partnerType: TipoSocio;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Register.name, required: false, index: true })
  titularId?: Types.ObjectId;

  @Prop({ required: false, match: /^[2-9]\d{3}-(0[1-9]|1[0-2])$/ })
  billingStartPeriod?: string;

  @Prop({ type: { throughPeriod: String, migrationId: String, establishedAt: Date, establishedBy: String }, required: false, _id: false })
  billingBaseline?: { throughPeriod: string; migrationId: string; establishedAt: Date; establishedBy: string };

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
