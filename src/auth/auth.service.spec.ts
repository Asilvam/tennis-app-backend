import { UnauthorizedException } from '@nestjs/common';
import * as bcryptjs from 'bcryptjs';
import { AuthService } from './auth.service';

jest.mock('bcryptjs', () => ({ compare: jest.fn() }));

describe('AuthService login', () => {
  const registerService = {
    validatePlayerEmail: jest.fn(),
  };
  const jwtService = {
    signAsync: jest.fn(),
  };
  let service: AuthService;

  const activeUser = {
    email: 'user@example.com',
    namePlayer: 'Player',
    role: 'user',
    pwd: 'hash',
    statePlayer: true,
    updatePayment: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(registerService as any, jwtService as any, {} as any);
  });

  it('rejects an unknown email without attempting password validation', async () => {
    registerService.validatePlayerEmail.mockResolvedValue(undefined);

    await expect(service.login({ username: 'missing@example.com', password: 'secret' })).rejects.toThrow(
      new UnauthorizedException('email is wrong'),
    );
    expect(bcryptjs.compare).not.toHaveBeenCalled();
  });

  it('rejects an invalid password', async () => {
    registerService.validatePlayerEmail.mockResolvedValue(activeUser);
    (bcryptjs.compare as jest.Mock).mockResolvedValue(false);

    await expect(service.login({ username: activeUser.email, password: 'wrong' })).rejects.toThrow(
      new UnauthorizedException('password is wrong'),
    );
  });

  it.each([
    [{ ...activeUser, statePlayer: false }, 'user blocked'],
    [{ ...activeUser, updatePayment: false }, 'user blocked for no payment'],
  ])('rejects a blocked user', async (user, message) => {
    registerService.validatePlayerEmail.mockResolvedValue(user);
    (bcryptjs.compare as jest.Mock).mockResolvedValue(true);

    await expect(service.login({ username: user.email, password: 'secret' })).rejects.toThrow(
      new UnauthorizedException(message),
    );
  });

  it('returns the token and public user data for an active user', async () => {
    registerService.validatePlayerEmail.mockResolvedValue(activeUser);
    (bcryptjs.compare as jest.Mock).mockResolvedValue(true);
    jwtService.signAsync.mockResolvedValue('access-token');

    await expect(service.login({ username: activeUser.email, password: 'secret' })).resolves.toEqual({
      accessToken: 'access-token',
      username: activeUser.email,
      namePlayer: activeUser.namePlayer,
      role: activeUser.role,
    });
    expect(jwtService.signAsync).toHaveBeenCalledWith({ email: activeUser.email, role: activeUser.role });
  });
});
