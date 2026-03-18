import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AuditLogDocument = AuditLog & Document;

@Schema({ collection: 'audit_logs', timestamps: true })
export class AuditLog {
  @Prop({ required: true, default: 'COURT_RESERVE' })
  entityType: string; // Tipo de entidad: 'COURT_RESERVE'

  @Prop({ required: true })
  entityId: string; // ID de la reserva (idCourtReserve)

  @Prop({ 
    required: true, 
    enum: ['CREATE', 'UPDATE', 'DELETE', 'STATE_CHANGE', 'PAYMENT_CONFIRMATION', 'ADMIN_CREATE', 'ADMIN_BULK_CREATE'] 
  })
  action: string;

  @Prop({ required: true, enum: ['USER', 'ADMIN', 'SYSTEM'] })
  performedBy: string;

  @Prop({ required: false })
  performedByUser?: string; // Nombre del usuario o admin

  @Prop({ required: false })
  performedByEmail?: string; // Email del usuario

  @Prop({ type: Object, required: false })
  beforeData?: Record<string, any>; // Estado anterior (para UPDATE/DELETE)

  @Prop({ type: Object, required: false })
  afterData?: Record<string, any>; // Estado nuevo (para CREATE/UPDATE)

  @Prop({ type: Object, required: false })
  metadata?: {
    court?: string;
    dateToPlay?: string;
    turn?: string;
    players?: string[];
    reason?: string; // Para cancelaciones
    paymentStatus?: string; // Para confirmaciones de pago
    isDouble?: boolean;
    isVisit?: boolean;
    isPaidNight?: boolean;
    visitName?: string;
    blockedMotive?: string;
    ipAddress?: string;
    userAgent?: string;
  };

  @Prop({ required: true })
  description: string; // Descripción legible del evento

  @Prop({ default: Date.now })
  timestamp: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

