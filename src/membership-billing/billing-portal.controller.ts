import {
  Body,
  CanActivate,
  Controller,
  Get,
  Injectable,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BillingPortalService } from './billing-portal.service';
import { PrepareAdminDuesDto, BillingAdminQueryDto } from './dto/billing-admin-query.dto';

@Injectable()
export class MembershipPortalEnabledGuard implements CanActivate {
  constructor(private readonly portal: BillingPortalService) {}
  canActivate() {
    if (!this.portal.enabled())
      throw new ServiceUnavailableException('El portal de mensualidades aun no esta habilitado.');
    return true;
  }
}

@Controller('membership-billing/me')
@UseGuards(JwtAuthGuard, MembershipPortalEnabledGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class BillingPortalController {
  constructor(private readonly portal: BillingPortalService) {}
  @Get('access')
  access(@Req() request: { user: { email: string } }) {
    return this.portal.access(request.user.email);
  }
  @Post('dues')
  dues(@Req() request: { user: { email: string } }, @Body() body: PrepareAdminDuesDto) {
    return this.portal.home(request.user.email, body.throughPeriod);
  }
  @Get('payments')
  history(@Req() request: { user: { email: string } }, @Query() query: BillingAdminQueryDto) {
    return this.portal.history(request.user.email, query.beneficiaryId, query.page);
  }
}
