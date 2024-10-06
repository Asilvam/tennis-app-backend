import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), // Extract token from Authorization header
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('SECRET_KEY'), // The secret key for JWT
    });
  }

  async validate(payload: any) {
    console.log(payload.role);
    return { role: payload.role, email: payload.email }; // Add validated payload to request
  }
}
