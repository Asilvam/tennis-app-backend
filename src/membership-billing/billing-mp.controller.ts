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
import { InternalApiKeyGuard } from '../auth/guards/internal-api-key.guard';
import { MembershipMpService } from './billing-mp.service';
import { SelectMembershipDuesDto } from './dto/select-membership-dues.dto';
import { MembershipPaymentEventDto } from './dto/membership-mp.dto';

@Controller('membership-billing')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class MembershipMpController {
  constructor(private readonly mp: MembershipMpService) {}

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  checkout(
    @Req() request: { user: { email: string } },
    @Body() body: SelectMembershipDuesDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.mp.checkout(request.user.email, body.dueIds, key);
  }

  @Get('payments/:reference')
  @UseGuards(JwtAuthGuard)
  state(@Req() request: { user: { email: string } }, @Param('reference') reference: string) {
    return this.mp.state(request.user.email, reference);
  }

  @Post('payments/:reference/reconcile')
  @UseGuards(JwtAuthGuard)
  reconcile(@Req() request: { user: { email: string } }, @Param('reference') reference: string) {
    return this.mp.reconcile(request.user.email, reference);
  }

  @Post('internal/mercado-pago')
  @UseGuards(InternalApiKeyGuard)
  event(@Body() body: MembershipPaymentEventDto) {
    return this.mp.receive(body.paymentId);
  }
}
