import { BadRequestException } from '@nestjs/common';
import { AuthController } from './auth.controller';

describe('AuthController routes', () => {
  const authService = {
    login: jest.fn(),
    validateToken: jest.fn().mockResolvedValue({ email: 'user@example.com' }),
    checkIfUserIsBlocked: jest.fn(),
    verifyEmailToken: jest.fn(),
  };
  let controller: AuthController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuthController(authService as any);
  });

  it('does not expose a refresh-token handler', () => {
    expect((AuthController.prototype as any).refreshToken).toBeUndefined();
  });

  it('keeps token validation available', async () => {
    await controller.validateToken({ token: 'access-token' });
    expect(authService.validateToken).toHaveBeenCalledWith({ token: 'access-token' });
  });

  it('delegates login', () => {
    const dto = { username: 'user@example.com', password: 'secret' };
    authService.login.mockReturnValue('result');
    expect(controller.login(dto)).toBe('result');
    expect(authService.login).toHaveBeenCalledWith(dto);
  });

  it('delegates the blocked user check', async () => {
    authService.checkIfUserIsBlocked.mockResolvedValue(false);
    await expect(controller.checkBlocked({ email: 'user@example.com' })).resolves.toBe(false);
  });

  it('returns the email verification page', async () => {
    authService.verifyEmailToken.mockResolvedValue({ message: 'verified' });
    const response = { setHeader: jest.fn(), send: jest.fn().mockReturnValue('sent') };

    await expect(controller.verifyEmail('token', response as any)).resolves.toBe('sent');
    expect(authService.verifyEmailToken).toHaveBeenCalledWith('token');
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html');
    expect(response.send.mock.calls[0][0]).toContain('Email Verified Successfully!');
  });

  it('rejects an empty verification result', async () => {
    authService.verifyEmailToken.mockResolvedValue(undefined);
    await expect(controller.verifyEmail('token', {} as any)).rejects.toThrow(BadRequestException);
  });
});
