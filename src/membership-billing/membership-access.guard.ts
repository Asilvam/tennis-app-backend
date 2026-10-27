import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BillingPortalService } from './billing-portal.service';

@Injectable()
export class MembershipAccessGuard implements CanActivate {
  constructor(
    private readonly portal: BillingPortalService,
    private readonly config: ConfigService,
  ) {}
  async canActivate(context: ExecutionContext) {
    if (!this.portal.enabled()) return true;
    const request = context.switchToHttp().getRequest();
    const path = String(request.path || request.url?.split('?')[0] || '').replace(/\/$/, '');
    const method = request.method;
    if (
      method === 'OPTIONS' ||
      /^\/auth\/(login|verify-email|validateToken|checkBlocked)$/.test(path) ||
      path === '/membership-billing/internal/mercado-pago' ||
      /^\/court-reserve\/(UpdateStateReserve\/[^/]+|emailconfirmation)$/.test(path)
    )
      return true;
    const bookingWrite =
      method !== 'GET' &&
      /^(\/court-reserve(?:\/|$)|\/booking(?:\/|$)|\/mp\/init-point$|\/match-ranking(?:\/|$))/.test(
        path,
      );
    const bearer = /^Bearer (.+)$/.exec(request.headers.authorization || '')?.[1];
    if (!bearer) {
      if (bookingWrite) throw new UnauthorizedException('Inicia sesion para continuar.');
      return true;
    }
    let payload: { email?: string };
    try {
      payload = await new JwtService({ secret: this.config.get<string>('SECRET_KEY') }).verifyAsync(
        bearer,
      );
    } catch {
      throw new UnauthorizedException('La sesion no es valida.');
    }
    if (!payload.email) throw new UnauthorizedException('La sesion no es valida.');
    const access = await this.portal.permissions(payload.email);
    const allowed =
      /^\/membership-billing\/me(?:\/|$)/.test(path) ||
      path === '/membership-billing/checkout' ||
      /^\/membership-billing\/payments\/membership-[a-f\d-]{36}(?:\/reconcile)?$/i.test(path);
    if (access.financiallyRestricted && !allowed)
      throw new ForbiddenException({
        code: 'PAYMENTS_ONLY',
        message: 'Tu acceso esta restringido a mensualidades.',
        reason: access.reason,
      });
    if (/^\/court-reserve\/(admincreate|adminreserve)$/.test(path) && access.role !== 'admin')
      throw new ForbiddenException('Se requiere un administrador.');
    return true;
  }
}
