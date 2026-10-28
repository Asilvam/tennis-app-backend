import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Register, RegisterSchema } from '../register/entities/register.entity';
import { MembershipDue, MembershipDueSchema } from './entities/membership-due.entity';
import { MembershipPayment, MembershipPaymentSchema } from './entities/membership-payment.entity';
import {
  MembershipBillingConfig,
  MembershipBillingConfigSchema,
} from './entities/membership-billing-config.entity';
import { BILLING_CLOCK, MembershipBillingService } from './membership-billing.service';
import { AuditLog, AuditLogSchema } from '../audit-log/entities/audit-log.entity';
import { EmailModule } from '../email/email.module';
import { BillingAdminController } from './billing-admin.controller';
import { BillingAdminService } from './billing-admin.service';
import { BillingAdminEnabledGuard } from './billing-admin.guard';
import { BillingNotificationsService } from './billing-notifications.service';
import { MembershipMpService } from './billing-mp.service';
import { MembershipMpController } from './billing-mp.controller';
import { InternalApiKeyGuard } from '../auth/guards/internal-api-key.guard';
import { BillingPortalService } from './billing-portal.service';
import { BillingPortalController, MembershipPortalEnabledGuard } from './billing-portal.controller';
import { MembershipAccessGuard } from './membership-access.guard';
import { BillingDueAdjustmentService } from './billing-due-adjustment.service';
import { BillingLifecycleService } from './billing-lifecycle.service';
import { BillingLifecycleController } from './billing-lifecycle.controller';
import { BillingEnrollmentService } from './billing-enrollment.service';
import { BillingEnrollmentController } from './billing-enrollment.controller';

// Routes and notifications remain disabled without explicit configuration; there is no seeding.
@Module({
  imports: [
    EmailModule,
    MongooseModule.forFeature([
      { name: MembershipDue.name, schema: MembershipDueSchema },
      { name: MembershipPayment.name, schema: MembershipPaymentSchema },
      { name: MembershipBillingConfig.name, schema: MembershipBillingConfigSchema },
      {
        name: AuditLog.name,
        schema: AuditLogSchema.clone().set('autoCreate', false).set('autoIndex', false),
      },
      {
        name: Register.name,
        schema: RegisterSchema.clone().set('autoCreate', false).set('autoIndex', false),
      },
    ]),
  ],
  controllers: [
    BillingAdminController,
    MembershipMpController,
    BillingPortalController,
    BillingLifecycleController,
    BillingEnrollmentController,
  ],
  providers: [
    MembershipBillingService,
    BillingAdminService,
    BillingAdminEnabledGuard,
    BillingNotificationsService,
    MembershipMpService,
    InternalApiKeyGuard,
    BillingPortalService,
    MembershipPortalEnabledGuard,
    MembershipAccessGuard,
    BillingDueAdjustmentService,
    BillingLifecycleService,
    BillingEnrollmentService,
    { provide: BILLING_CLOCK, useValue: () => new Date() },
  ],
  exports: [
    MembershipBillingService,
    BillingPortalService,
    MembershipAccessGuard,
    BillingDueAdjustmentService,
  ],
})
export class MembershipBillingModule {}
