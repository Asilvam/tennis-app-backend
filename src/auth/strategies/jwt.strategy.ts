import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), // Extract token from Authorization header
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('SECRET_KEY'), // The secret key for JWT
    });
  }

  async validate(payload: any) {
    this.logger.debug(`JWT validated — role: ${payload.role}, email: ${payload.email}`);
    return { role: payload.role, email: payload.email }; // Add validated payload to request
  }
}
