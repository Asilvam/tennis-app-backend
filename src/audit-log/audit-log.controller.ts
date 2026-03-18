import { Controller, Get, Param, Query, UseGuards, Logger } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('audit-logs')
@UseGuards(JwtAuthGuard) // Proteger todos los endpoints
export class AuditLogController {
  private readonly logger = new Logger(AuditLogController.name);

  constructor(private readonly auditLogService: AuditLogService) {}

  /**
   * GET /audit-logs/reserve/:reserveId
   * Obtiene todos los logs de una reserva específica
   */
  @Get('reserve/:reserveId')
  async getAuditsByReserve(@Param('reserveId') reserveId: string) {
    this.logger.log(`[getAuditsByReserve] Fetching audits for reserve: ${reserveId}`);
    return this.auditLogService.getAuditsByReserve(reserveId);
  }

  /**
   * GET /audit-logs/date-range?start=2024-01-01&end=2024-12-31
   * Obtiene logs por rango de fechas
   */
  @Get('date-range')
  async getAuditsByDateRange(
    @Query('start') start: string,
    @Query('end') end: string,
  ) {
    this.logger.log(`[getAuditsByDateRange] Fetching audits from ${start} to ${end}`);
    return this.auditLogService.getAuditsByDateRange(
      new Date(start),
      new Date(end),
    );
  }

  /**
   * GET /audit-logs/action/:action
   * Obtiene logs por tipo de acción (CREATE, DELETE, etc.)
   */
  @Get('action/:action')
  async getAuditsByAction(@Param('action') action: string) {
    this.logger.log(`[getAuditsByAction] Fetching audits for action: ${action}`);
    return this.auditLogService.getAuditsByAction(action);
  }

  /**
   * GET /audit-logs/user/:userName
   * Obtiene logs de un usuario específico
   */
  @Get('user/:userName')
  async getAuditsByUser(@Param('userName') userName: string) {
    this.logger.log(`[getAuditsByUser] Fetching audits for user: ${userName}`);
    return this.auditLogService.getAuditsByUser(userName);
  }

  /**
   * GET /audit-logs/report/cancellations?start=2024-01-01&end=2024-12-31
   * Reporte de cancelaciones
   */
  @Get('report/cancellations')
  async getCancellationReport(
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    this.logger.log('[getCancellationReport] Generating cancellation report');
    const startDate = start ? new Date(start) : undefined;
    const endDate = end ? new Date(end) : undefined;
    return this.auditLogService.getCancellationReport(startDate, endDate);
  }

  /**
   * GET /audit-logs/report/creations?start=2024-01-01&end=2024-12-31
   * Reporte de creaciones
   */
  @Get('report/creations')
  async getCreationReport(
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    this.logger.log('[getCreationReport] Generating creation report');
    const startDate = start ? new Date(start) : undefined;
    const endDate = end ? new Date(end) : undefined;
    return this.auditLogService.getCreationReport(startDate, endDate);
  }

  /**
   * GET /audit-logs/stats?days=30
   * Estadísticas generales
   */
  @Get('stats')
  async getGeneralStats(@Query('days') days: string = '30') {
    this.logger.log(`[getGeneralStats] Generating stats for last ${days} days`);
    return this.auditLogService.getGeneralStats(parseInt(days, 10));
  }
}

