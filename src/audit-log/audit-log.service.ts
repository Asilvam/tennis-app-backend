import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditLog } from './entities/audit-log.entity';

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectModel('AuditLog')
    private readonly auditLogModel: Model<AuditLog>,
  ) {}

  /**
   * Registra la creación de una reserva
   */
  async logReserveCreation(reserveData: any, performedBy: 'USER' | 'ADMIN' | 'SYSTEM', userName?: string, email?: string) {
    try {
      const players = [reserveData.player1, reserveData.player2, reserveData.player3, reserveData.player4].filter(Boolean);

      const audit = new this.auditLogModel({
        entityType: 'COURT_RESERVE',
        entityId: reserveData.idCourtReserve,
        action: 'CREATE',
        performedBy,
        performedByUser: userName,
        performedByEmail: email,
        afterData: reserveData,
        metadata: {
          court: reserveData.court,
          dateToPlay: reserveData.dateToPlay,
          turn: reserveData.turn,
          players,
          isDouble: reserveData.isDouble || false,
          isVisit: reserveData.isVisit || false,
          isPaidNight: reserveData.isPaidNight || false,
          visitName: reserveData.visitName,
        },
        description: `Reserva creada por ${performedBy}: ${reserveData.court} - ${reserveData.dateToPlay} ${reserveData.turn} - Jugadores: ${players.join(', ')}`,
        timestamp: new Date(),
      });

      await audit.save();
      this.logger.log(`[AUDIT] Reserve created logged: ${reserveData.idCourtReserve} by ${performedBy}`);
    } catch (error) {
      this.logger.error('[AUDIT] Error logging creation', error?.stack || error);
    }
  }

  /**
   * Registra la creación masiva de reservas por admin
   */
  async logBulkAdminReserves(reservesCount: number, performedBy: string = 'ADMIN') {
    try {
      const audit = new this.auditLogModel({
        entityType: 'COURT_RESERVE',
        entityId: 'BULK_OPERATION',
        action: 'ADMIN_BULK_CREATE',
        performedBy,
        metadata: {
          reservesCount,
        },
        description: `Creación masiva de ${reservesCount} reservas por ${performedBy}`,
        timestamp: new Date(),
      });

      await audit.save();
      this.logger.log(`[AUDIT] Bulk creation logged: ${reservesCount} reserves by ${performedBy}`);
    } catch (error) {
      this.logger.error('[AUDIT] Error logging bulk creation', error?.stack || error);
    }
  }

  /**
   * Registra la cancelación de una reserva
   */
  async logReserveCancellation(reserveId: string, reserveData: any, performedBy: 'USER' | 'ADMIN' | 'SYSTEM', userName?: string, reason?: string) {
    try {
      const players = [reserveData.player1, reserveData.player2, reserveData.player3, reserveData.player4].filter(Boolean);

      const audit = new this.auditLogModel({
        entityType: 'COURT_RESERVE',
        entityId: reserveId,
        action: 'DELETE',
        performedBy,
        performedByUser: userName,
        beforeData: reserveData,
        metadata: {
          court: reserveData.court,
          dateToPlay: reserveData.dateToPlay,
          turn: reserveData.turn,
          players,
          reason: reason || (reserveData.blockedMotive ? `Bloqueado por admin: ${reserveData.blockedMotive}` : undefined),
          isDouble: reserveData.isDouble || false,
          isVisit: reserveData.isVisit || false,
          isPaidNight: reserveData.isPaidNight || false,
          blockedMotive: reserveData.blockedMotive,
        },
        description: `Reserva cancelada por ${performedBy}: ${reserveData.court} - ${reserveData.dateToPlay} ${reserveData.turn}${reason ? ` - Motivo: ${reason}` : ''}`,
        timestamp: new Date(),
      });

      await audit.save();
      this.logger.log(`[AUDIT] Reserve cancellation logged: ${reserveId} by ${performedBy}`);
    } catch (error) {
      this.logger.error('[AUDIT] Error logging cancellation', error?.stack || error);
    }
  }

  /**
   * Registra cambio de estado de una reserva
   */
  async logStateChange(reserveId: string, oldState: boolean, newState: boolean, wasPaid: boolean, performedBy: 'USER' | 'ADMIN' | 'SYSTEM' = 'SYSTEM') {
    try {
      const audit = new this.auditLogModel({
        entityType: 'COURT_RESERVE',
        entityId: reserveId,
        action: 'STATE_CHANGE',
        performedBy,
        beforeData: { state: oldState },
        afterData: { state: newState, wasPaid },
        description: `Estado de reserva actualizado de ${oldState} a ${newState}, pagada: ${wasPaid}`,
        timestamp: new Date(),
      });

      await audit.save();
      this.logger.log(`[AUDIT] State change logged: ${reserveId}`);
    } catch (error) {
      this.logger.error('[AUDIT] Error logging state change', error?.stack || error);
    }
  }

  /**
   * Registra confirmación de pago
   */
  async logPaymentConfirmation(reserveId: string, paymentStatus: string, performedBy: 'SYSTEM' = 'SYSTEM') {
    try {
      const audit = new this.auditLogModel({
        entityType: 'COURT_RESERVE',
        entityId: reserveId,
        action: 'PAYMENT_CONFIRMATION',
        performedBy,
        metadata: { paymentStatus },
        description: `Confirmación de pago recibida: ${paymentStatus} para reserva ${reserveId}`,
        timestamp: new Date(),
      });

      await audit.save();
      this.logger.log(`[AUDIT] Payment confirmation logged: ${reserveId} - ${paymentStatus}`);
    } catch (error) {
      this.logger.error('[AUDIT] Error logging payment', error?.stack || error);
    }
  }

  /**
   * Registra actualización de resultado de partido
   */
  async logMatchResultUpdate(reserveId: string, performedBy: string = 'USER') {
    try {
      const audit = new this.auditLogModel({
        entityType: 'COURT_RESERVE',
        entityId: reserveId,
        action: 'UPDATE',
        performedBy: 'USER',
        performedByUser: performedBy,
        afterData: { resultMatchUpdated: true },
        description: `Resultado de partido actualizado por ${performedBy}`,
        timestamp: new Date(),
      });

      await audit.save();
      this.logger.log(`[AUDIT] Match result update logged: ${reserveId}`);
    } catch (error) {
      this.logger.error('[AUDIT] Error logging match result', error?.stack || error);
    }
  }

  // ==================== CONSULTAS DE AUDITORÍA ====================

  /**
   * Obtiene todos los logs de una reserva específica
   */
  async getAuditsByReserve(reserveId: string) {
    return this.auditLogModel.find({ entityId: reserveId }).sort({ timestamp: -1 }).exec();
  }

  /**
   * Obtiene logs por rango de fechas
   */
  async getAuditsByDateRange(startDate: Date, endDate: Date) {
    return this.auditLogModel
      .find({
        timestamp: { $gte: startDate, $lte: endDate },
      })
      .sort({ timestamp: -1 })
      .exec();
  }

  /**
   * Obtiene logs por tipo de acción
   */
  async getAuditsByAction(action: string) {
    return this.auditLogModel.find({ action }).sort({ timestamp: -1 }).limit(100).exec();
  }

  /**
   * Obtiene logs por usuario
   */
  async getAuditsByUser(userName: string) {
    return this.auditLogModel.find({ performedByUser: userName }).sort({ timestamp: -1 }).exec();
  }

  /**
   * Reporte de cancelaciones
   */
  async getCancellationReport(startDate?: Date, endDate?: Date) {
    const query: any = { action: 'DELETE' };

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = startDate;
      if (endDate) query.timestamp.$lte = endDate;
    }

    const logs = await this.auditLogModel.find(query).sort({ timestamp: -1 }).exec();

    return {
      total: logs.length,
      byAdmin: logs.filter((l) => l.performedBy === 'ADMIN').length,
      byUser: logs.filter((l) => l.performedBy === 'USER').length,
      bySystem: logs.filter((l) => l.performedBy === 'SYSTEM').length,
      withReason: logs.filter((l) => l.metadata?.reason).length,
      logs,
    };
  }

  /**
   * Reporte de creaciones
   */
  async getCreationReport(startDate?: Date, endDate?: Date) {
    const query: any = { action: { $in: ['CREATE', 'ADMIN_CREATE', 'ADMIN_BULK_CREATE'] } };

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = startDate;
      if (endDate) query.timestamp.$lte = endDate;
    }

    const logs = await this.auditLogModel.find(query).sort({ timestamp: -1 }).exec();

    return {
      total: logs.length,
      byAdmin: logs.filter((l) => l.performedBy === 'ADMIN').length,
      byUser: logs.filter((l) => l.performedBy === 'USER').length,
      paidNight: logs.filter((l) => l.metadata?.isPaidNight).length,
      withVisit: logs.filter((l) => l.metadata?.isVisit).length,
      doubles: logs.filter((l) => l.metadata?.isDouble).length,
      logs,
    };
  }

  /**
   * Estadísticas generales
   */
  async getGeneralStats(days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const logs = await this.auditLogModel
      .find({
        timestamp: { $gte: startDate },
      })
      .exec();

    return {
      period: `Last ${days} days`,
      total: logs.length,
      creates: logs.filter((l) => l.action === 'CREATE' || l.action === 'ADMIN_CREATE').length,
      deletes: logs.filter((l) => l.action === 'DELETE').length,
      stateChanges: logs.filter((l) => l.action === 'STATE_CHANGE').length,
      paymentConfirmations: logs.filter((l) => l.action === 'PAYMENT_CONFIRMATION').length,
      byPerformer: {
        user: logs.filter((l) => l.performedBy === 'USER').length,
        admin: logs.filter((l) => l.performedBy === 'ADMIN').length,
        system: logs.filter((l) => l.performedBy === 'SYSTEM').length,
      },
    };
  }
}
