import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogService } from './audit-log.service';
import { AuditLogController } from './audit-log.controller';
import { AuditLogSchema } from './entities/audit-log.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'AuditLog', schema: AuditLogSchema },
    ]),
  ],
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService], // Exportar para usar en otros módulos
})
export class AuditLogModule {}

