import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configuredKey = this.configService.get<string>('INTERNAL_API_KEY');
    if (!configuredKey) {
      throw new ServiceUnavailableException('Internal API authentication is not configured');
    }

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const received = request.headers['x-api-key'];
    const receivedKey = Array.isArray(received) ? received[0] : received;

    if (!receivedKey || !this.matches(receivedKey, configuredKey)) {
      throw new UnauthorizedException('Invalid internal API key');
    }

    return true;
  }

  private matches(received: string, configured: string): boolean {
    const receivedBuffer = Buffer.from(received);
    const configuredBuffer = Buffer.from(configured);
    return receivedBuffer.length === configuredBuffer.length && timingSafeEqual(receivedBuffer, configuredBuffer);
  }
}
