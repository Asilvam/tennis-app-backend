import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { InternalApiKeyGuard } from './internal-api-key.guard';

describe('InternalApiKeyGuard', () => {
  function context(apiKey?: string | string[]) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { 'x-api-key': apiKey } }),
      }),
    } as any;
  }

  it('accepts the configured API key', () => {
    const guard = new InternalApiKeyGuard({ get: () => 'secret' } as any);
    expect(guard.canActivate(context('secret'))).toBe(true);
  });

  it('rejects an invalid API key', () => {
    const guard = new InternalApiKeyGuard({ get: () => 'secret' } as any);
    expect(() => guard.canActivate(context('invalid'))).toThrow(UnauthorizedException);
  });

  it('accepts the first API key when the header is an array', () => {
    const guard = new InternalApiKeyGuard({ get: () => 'secret' } as any);
    expect(guard.canActivate(context(['secret', 'ignored']))).toBe(true);
  });

  it('rejects a missing API key', () => {
    const guard = new InternalApiKeyGuard({ get: () => 'secret' } as any);
    expect(() => guard.canActivate(context())).toThrow(UnauthorizedException);
  });

  it('rejects a key with a different byte length', () => {
    const guard = new InternalApiKeyGuard({ get: () => 'secret' } as any);
    expect(() => guard.canActivate(context('short'))).toThrow(UnauthorizedException);
  });

  it('fails closed when the server key is missing', () => {
    const guard = new InternalApiKeyGuard({ get: () => undefined } as any);
    expect(() => guard.canActivate(context('secret'))).toThrow(ServiceUnavailableException);
  });
});
