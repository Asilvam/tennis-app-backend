import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request, response } from "express";
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
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
            const newPayload = { email: payload.email, role: payload.role };
            const accessToken = await this.jwtService.signAsync(newPayload, {
              secret: process.env.SECRET_KEY,
              expiresIn: '15m',
            });
            const refreshToken = await this.jwtService.signAsync(newPayload, {
              secret: process.env.REFRESH_SECRET_KEY,
              expiresIn: '7d',
            });
            await this.authService.generateRefreshToken2DB(refreshToken, newPayload.email);
            // response.setHeader('Authorization', `Bearer ${accessToken}`);
            request.user = await this.jwtService.verifyAsync(accessToken, {
              secret: process.env.SECRET_KEY,
            });
            return true; // Allow access if token is refreshed
          } else {
            throw new UnauthorizedException('Failed to refresh token');
          }
        } else {
          throw new UnauthorizedException('Invalid or expired token');
        }
      }
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
