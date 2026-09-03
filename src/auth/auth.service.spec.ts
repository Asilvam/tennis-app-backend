import { BadRequestException, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcryptjs from 'bcryptjs';
import { AuthService } from './auth.service';

jest.mock('bcryptjs', () => ({ compare: jest.fn() }));

describe('AuthService', () => {
  const registerService = {
    validatePlayerEmail: jest.fn(),
    findOneByEmail: jest.fn(),
    findByVerificationToken: jest.fn(),
  };
  const jwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  };
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(registerService as any, jwtService as any);
  });

  const activeUser = {
    email: 'user@example.com',
    namePlayer: 'Player',
    role: 'user',
    pwd: 'hash',
    statePlayer: true,
    updatePayment: true,
  };

  it('rejects an unknown email with an authorization error', async () => {
    registerService.validatePlayerEmail.mockResolvedValue(undefined);

    await expect(service.login({ username: 'missing@example.com', password: 'secret' })).rejects.toThrow(
      new UnauthorizedException('email is wrong'),
    );
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
  ])('rejects blocked users', async (user, message) => {
    registerService.validatePlayerEmail.mockResolvedValue(user);
    (bcryptjs.compare as jest.Mock).mockResolvedValue(true);

    await expect(service.login({ username: user.email, password: 'secret' })).rejects.toThrow(
      new UnauthorizedException(message),
    );
  });

  it('returns an access token and public user data', async () => {
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

  it('returns the requested profile', async () => {
    registerService.findOneByEmail.mockResolvedValue(activeUser);
    await expect(service.profile({ email: activeUser.email })).resolves.toBe(activeUser);
  });

  it('validates a valid token', async () => {
    jwtService.verifyAsync.mockResolvedValue({ email: activeUser.email });
    await expect(service.validateToken({ token: 'valid' })).resolves.toEqual({ email: activeUser.email });
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid');
  });

  it('rejects an invalid token', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('expired'));
    await expect(service.validateToken({ token: 'invalid' })).rejects.toThrow(
      new UnauthorizedException('Token is wrong'),
    );
  });

  it('requires an email verification token', async () => {
    await expect(service.verifyEmailToken('')).rejects.toThrow(
      new BadRequestException('Verification token is missing.'),
    );
  });

  it('rejects an unknown verification token', async () => {
    registerService.findByVerificationToken.mockResolvedValue(null);
    await expect(service.verifyEmailToken('missing')).rejects.toThrow(NotFoundException);
  });

  it('rejects an already verified account', async () => {
    registerService.findByVerificationToken.mockResolvedValue({ emailVerified: true });
    await expect(service.verifyEmailToken('used')).rejects.toThrow(ConflictException);
  });

  it('activates an account and invalidates its verification token', async () => {
    const user = {
      ...activeUser,
      statePlayer: false,
      emailVerified: false,
      verificationToken: 'token',
      save: jest.fn(),
    };
    registerService.findByVerificationToken.mockResolvedValue(user);

    await expect(service.verifyEmailToken('token')).resolves.toEqual({
      message: 'Your email has been successfully verified.',
    });
    expect(user).toMatchObject({ statePlayer: true, emailVerified: true, verificationToken: null });
    expect(user.save).toHaveBeenCalledTimes(1);
  });

  it.each([
    [undefined, true],
    [{ ...activeUser, statePlayer: false }, true],
    [{ ...activeUser, updatePayment: false }, true],
    [activeUser, false],
  ])('evaluates whether a user is blocked', async (user, expected) => {
    registerService.validatePlayerEmail.mockResolvedValue(user);
    await expect(service.checkIfUserIsBlocked(activeUser.email)).resolves.toBe(expected);
  });

  it('fails closed when the user lookup throws', async () => {
    registerService.validatePlayerEmail.mockRejectedValue(new Error('Mongo unavailable'));
    await expect(service.checkIfUserIsBlocked(activeUser.email)).resolves.toBe(true);
  });
});
