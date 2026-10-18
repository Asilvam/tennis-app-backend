import { CanActivate, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class BillingAdminEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(): boolean {
    if (this.config.get<string>('MEMBERSHIP_BILLING_ADMIN_ENABLED') !== 'true') {
      throw new ServiceUnavailableException(
        'La administracion de mensualidades no esta habilitada en este servidor.',
      );
    }
    return true;
  }
}
