import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { BillingAdminEnabledGuard } from './billing-admin.guard';
import { BillingAdminService } from './billing-admin.service';
import {
  BillingAdminQueryDto,
  PrepareAdminDuesDto,
  PreviewAdminDuesDto,
} from './dto/billing-admin-query.dto';
import { RegisterBankPaymentDto, ReverseBankPaymentDto } from './dto/register-bank-payment.dto';
import { SelectMembershipDuesDto } from './dto/select-membership-dues.dto';
import {
  EnrollMembershipDto,
  PreviewMembershipEnrollmentDto,
  PreviewMembershipReenrollmentDto,
  ReenrollMembershipDto,
} from './dto/enroll-membership.dto';

type AdminRequest = { user: { email: string; role: string } };

@Controller('membership-billing/admin')
@UseGuards(JwtAuthGuard, AdminGuard, BillingAdminEnabledGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class BillingAdminController {
  constructor(private readonly billing: BillingAdminService) {}

  @Get('members')
  members(@Req() request: AdminRequest, @Query() query: BillingAdminQueryDto) {
    return this.billing.searchMembers(request.user.email, query);
  }

  @Post('members/:id/dues')
  dues(
    @Req() request: AdminRequest,
    @Param('id') id: string,
    @Body() body: PrepareAdminDuesDto,
    @Headers('idempotency-key') key: string,
  ) {
    if (body.approvalHash !== undefined)
      return this.billing.generateDues(request.user.email, id, body, key);
    return this.billing.memberDues(request.user.email, id, body.throughPeriod);
  }

  @Post('members/:id/dues/preview')
  previewDues(
    @Req() request: AdminRequest,
    @Param('id') id: string,
    @Body() body: PreviewAdminDuesDto,
  ) {
    return this.billing.previewDues(request.user.email, id, body.throughPeriod);
  }

  @Get('members/:id')
  member(@Req() request: AdminRequest, @Param('id') id: string) {
    return this.billing.memberDetails(request.user.email, id);
  }

  @Post('quote')
  quote(@Req() request: AdminRequest, @Body() body: SelectMembershipDuesDto) {
    return this.billing.quote(request.user.email, body.dueIds);
  }

  @Post('members/:id/enrollment/preview')
  previewEnrollment(
    @Req() request: AdminRequest,
    @Param('id') id: string,
    @Body() body: PreviewMembershipEnrollmentDto,
  ) {
    return this.billing.previewEnrollment(
      request.user.email,
      id,
      body.startPeriod,
      false,
      body.throughPeriod,
    );
  }

  @Post('members/:id/enrollment')
  enroll(
    @Req() request: AdminRequest,
    @Param('id') id: string,
    @Body() body: EnrollMembershipDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.billing.enroll(request.user.email, id, body, key);
  }

  @Get('payments')
  history(@Req() request: AdminRequest, @Query() query: BillingAdminQueryDto) {
    return this.billing.history(request.user.email, query);
  }

  @Post('members/:id/reenrollment/preview')
  previewReenrollment(
    @Req() request: AdminRequest,
    @Param('id') id: string,
    @Body() body: PreviewMembershipReenrollmentDto,
  ) {
    return this.billing.previewEnrollment(request.user.email, id, body.startPeriod, true);
  }

  @Post('members/:id/reenrollment')
  reenroll(
    @Req() request: AdminRequest,
    @Param('id') id: string,
    @Body() body: ReenrollMembershipDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.billing.enroll(request.user.email, id, body, key, true);
  }

  @Post('payments')
  register(
    @Req() request: AdminRequest,
    @Body() body: RegisterBankPaymentDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.billing.registerBankPayment(request.user.email, body, key);
  }

  @Post('payments/:id/reversal')
  reverse(
    @Req() request: AdminRequest,
    @Param('id') id: string,
    @Body() body: ReverseBankPaymentDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.billing.reverseBankPayment(request.user.email, id, body.reason, key);
  }
}
