import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { BillingAdminEnabledGuard } from './billing-admin.guard';
import { BillingLifecycleService } from './billing-lifecycle.service';
import { UpdateBillingAutomationDto } from './dto/billing-automation.dto';

@Controller('membership-billing/admin/automation')
@UseGuards(JwtAuthGuard, AdminGuard, BillingAdminEnabledGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class BillingLifecycleController {
  constructor(private readonly lifecycle: BillingLifecycleService) {}

  @Get('settings')
  settings(@Req() request: { user: { email: string } }) {
    return this.lifecycle.automationSettings(request.user.email);
  }

  @Post('settings')
  updateSettings(
    @Req() request: { user: { email: string } },
    @Body() body: UpdateBillingAutomationDto,
  ) {
    return this.lifecycle.updateAutomationSettings(request.user.email, body);
  }

  @Get('preview')
  preview(@Req() request: { user: { email: string } }) {
    return this.lifecycle.preview(request.user.email);
  }
}
