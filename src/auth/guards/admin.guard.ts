import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.switchToHttp().getRequest().user?.role !== 'admin') {
      throw new ForbiddenException('Solo un administrador puede modificar permisos y estado de pago.');
    }
    return true;
  }
}
