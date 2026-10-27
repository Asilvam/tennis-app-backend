import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { BillingAdminEnabledGuard } from './billing-admin.guard';
import { BillingLifecycleService } from './billing-lifecycle.service';

@Controller('membership-billing/admin/automation')
@UseGuards(JwtAuthGuard, AdminGuard, BillingAdminEnabledGuard)
export class BillingLifecycleController {
  constructor(private readonly lifecycle: BillingLifecycleService) {}

  @Get('preview')
  preview(@Req() request: { user: { email: string } }) {
    return this.lifecycle.preview(request.user.email);
  }
}
