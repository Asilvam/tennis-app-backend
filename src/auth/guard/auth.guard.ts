import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  logger = new Logger(AuthGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse<Response>();
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException();
    }
    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.SECRET_KEY,
      });
      request.user = payload;
      return true;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        const payload = await this.jwtService.decode(token);
        const refreshToken = await this.authService.takeRefreshTokenFromDB(payload.email);
        if (refreshToken) {
          const refreshed = await this.jwtService.verifyAsync(refreshToken, {
            secret: process.env.REFRESH_SECRET_KEY,
          });
          if (refreshed) {
            try {
              const newPayload = { email: payload.email, role: payload.role };
              const accessToken = await this.jwtService.signAsync(newPayload, {
                secret: process.env.SECRET_KEY,
                expiresIn: process.env.TOKEN_EXPIRE_TIME,
              });
              const refreshToken = await this.jwtService.signAsync(newPayload, {
                secret: process.env.REFRESH_SECRET_KEY,
                expiresIn: process.env.REFRESH_TOKEN_EXPIRE_TIME,
              });
              await this.authService.generateRefreshToken2DB(refreshToken, newPayload.email);
              request.user = await this.jwtService.verifyAsync(accessToken, {
                secret: process.env.SECRET_KEY,
              });
              response.setHeader('Authorization', `Bearer ${accessToken}`);
              return true; // Allow access if token is refreshed
            } catch (error) {
              this.logger.error(error);
              throw new UnauthorizedException('Failed to refresh token');
            }
          }
        } else {
          throw new UnauthorizedException('Invalid or expired token');
        }
      } else {
        console.log('Token:', token); // Muestra el token completo
        console.log('Decoded Token:', this.jwtService.decode(token)); // Muestra el payload sin verificar
        console.error('Verification Error:', error.message);
        this.logger.error(error.message);
      }
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
