import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CourtReserveService } from './court-reserve.service';
import { CourtReserveController } from './court-reserve.controller';
import { CourtReserve, CourtReserveSchema } from './entities/court-reserve.entity';
import { RegisterModule } from '../register/register.module';
// import { EmailModule } from '../email/email.module';
import { EmailService } from '../email/email.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { PaymentCallbackEffect, PaymentCallbackEffectSchema } from './entities/payment-callback-effect.entity';
import { PaymentCallbackEffectService } from './payment-callback-effect.service';
import { InternalApiKeyGuard } from '../auth/guards/internal-api-key.guard';
import { ReservationSlot, ReservationSlotSchema } from './entities/reservation-slot.entity';
import { ReservationSlotService } from './reservation-slot.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CourtReserve.name, schema: CourtReserveSchema },
      { name: PaymentCallbackEffect.name, schema: PaymentCallbackEffectSchema },
      { name: ReservationSlot.name, schema: ReservationSlotSchema },
    ]),
    RegisterModule,
    AuditLogModule,
    // EmailModule,
  ],
  providers: [CourtReserveService, EmailService, PaymentCallbackEffectService, InternalApiKeyGuard, ReservationSlotService],
  controllers: [CourtReserveController],
  exports: [CourtReserveService, MongooseModule, ReservationSlotService],
})
export class CourtReserveModule {}
