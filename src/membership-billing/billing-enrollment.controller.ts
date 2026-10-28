import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { BillingAdminEnabledGuard } from './billing-admin.guard';
import { BillingEnrollmentService } from './billing-enrollment.service';
import {
  ApplyBatchEnrollmentDto,
  ApproveBillingHistoryDto,
  PreviewBatchEnrollmentDto,
} from './dto/batch-enrollment.dto';

@Controller('membership-billing/admin')
@UseGuards(JwtAuthGuard, AdminGuard, BillingAdminEnabledGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class BillingEnrollmentController {
  constructor(private readonly enrollment: BillingEnrollmentService) {}
  @Post('enrollment/preview')
  preview(@Req() req: { user: { email: string } }, @Body() body: PreviewBatchEnrollmentDto) {
    return this.enrollment.previewBatch(req.user.email, body);
  }
  @Post('enrollment')
  apply(
    @Req() req: { user: { email: string } },
    @Body() body: ApplyBatchEnrollmentDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.enrollment.applyBatch(req.user.email, body, key);
  }
  @Get('members/:id/billing-history/preview')
  history(@Req() req: { user: { email: string } }, @Param('id') id: string) {
    return this.enrollment.previewHistory(req.user.email, id);
  }
  @Post('members/:id/billing-history')
  approveHistory(
    @Req() req: { user: { email: string } },
    @Param('id') id: string,
    @Body() body: ApproveBillingHistoryDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.enrollment.approveHistory(req.user.email, id, body, key);
  }
}
