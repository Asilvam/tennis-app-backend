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
      (method === 'POST' &&
        /^(?:\/court-reserve(?:\/holds|\/admincreate|\/adminreserve)?|\/booking\/multiple|\/mp\/init-point)$/.test(
          path,
        )) ||
      (method === 'PATCH' && /^\/court-reserve\/holds\/[^/]+$/.test(path));
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
    const access = bookingWrite ? await this.portal.permissions(payload.email) : null;
    if (!bookingWrite) await this.portal.activeAccount(payload.email);
    if (access && (access.canReserve === false || access.financiallyRestricted))
      throw new ForbiddenException({
        code: 'RESERVATION_BLOCKED',
        message: 'No puedes crear reservas hasta regularizar tu habilitacion de pago.',
        reason: access.reason,
      });
    if (
      bookingWrite &&
      /^\/court-reserve\/(admincreate|adminreserve)$/.test(path) &&
      access?.role !== 'admin'
    )
      throw new ForbiddenException('Se requiere un administrador.');
    return true;
  }
}
