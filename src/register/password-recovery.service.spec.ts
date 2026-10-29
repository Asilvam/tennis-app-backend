import { BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { RegisterSchema } from './entities/register.entity';
import { PASSWORD_RESET_ADMIN_MESSAGE, PASSWORD_RESET_ADMIN_TTL_MS, PASSWORD_RESET_COOLDOWN_MS, PASSWORD_RESET_REQUEST_MESSAGE, PASSWORD_RESET_TTL_MS, PasswordRecoveryService } from './password-recovery.service';

jest.mock('crypto', () => ({ ...jest.requireActual('crypto'), randomBytes: jest.fn(() => Buffer.alloc(32, 7)) }));
jest.mock('bcryptjs', () => ({ hash: jest.fn() }));
const token = Buffer.alloc(32, 7).toString('hex');
const tokenHash = createHash('sha256').update(token).digest('hex');
const now = new Date('2030-10-12T12:00:00.000Z');
const user = { _id: 'member-id', email: 'member@test.cl' };
const dto = { token, password: 'new-secret123', passwordConfirmation: 'new-secret123' };
const query = (value: any) => { const result = { select: jest.fn(() => result), exec: jest.fn().mockResolvedValue(value) }; return result; };

describe('PasswordRecoveryService', () => {
  let service: PasswordRecoveryService;
  const model = { findOneAndUpdate: jest.fn(), findOne: jest.fn(), updateOne: jest.fn() };
  const email = { sendResetPasswordEmail: jest.fn(), sendPasswordChangedEmail: jest.fn() };
  const config = { get: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
    (randomBytes as jest.Mock).mockReturnValue(Buffer.alloc(32, 7));
    jest.useFakeTimers();
    jest.setSystemTime(now);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    model.findOneAndUpdate.mockReturnValue(query(user));
    model.findOne.mockReturnValue(query(user));
    model.updateOne.mockReturnValue(query({ modifiedCount: 1 }));
    email.sendResetPasswordEmail.mockResolvedValue(undefined);
    email.sendPasswordChangedEmail.mockResolvedValue(undefined);
    config.get.mockReturnValue('http://localhost:5173/restablecer-contrasena');
    (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');
    service = new PasswordRecoveryService(model as any, email as any, config as any);
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
  async function request(emailAddress = user.email) {
    const outcome = service.requestReset(emailAddress).then(value => ({ value }), error => ({ error }));
    await jest.advanceTimersByTimeAsync(300);
    const result = await outcome;
    if ('error' in result) throw result.error;
    return result.value;
  }

  it('persists only the token hash before delivery and leaves the current password unchanged', async () => {
    const response = await request(' MEMBER@TEST.CL ');
    expect(response).toEqual({ success: true, message: PASSWORD_RESET_REQUEST_MESSAGE });
    expect(response).not.toHaveProperty('newPassword');
    expect(JSON.stringify(response)).not.toContain(token);
    const [filter, update] = model.findOneAndUpdate.mock.calls[0];
    expect(filter.email).toBe(user.email);
    expect(update.$set.passwordResetTokenHash).toBe(tokenHash);
    expect(update.$set.passwordResetExpiresAt).toEqual(new Date(now.getTime() + PASSWORD_RESET_TTL_MS));
    expect(PASSWORD_RESET_TTL_MS).toBe(86_400_000);
    expect(update.$set).not.toHaveProperty('pwd');
    expect(email.sendResetPasswordEmail).toHaveBeenCalledWith(user.email, `http://localhost:5173/restablecer-contrasena#token=${token}`, '24 horas');
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  it('atomically requires an active account and a full 24 hours since the last accepted request', async () => {
    await request();
    const filter = model.findOneAndUpdate.mock.calls[0][0];
    expect(filter.statePlayer).toBe(true);
    expect(PASSWORD_RESET_COOLDOWN_MS).toBe(86_400_000);
    expect(filter.$or[0].passwordResetRequestedAt.$lte).toEqual(new Date(now.getTime() - 86_400_000));
    expect(model.findOne).not.toHaveBeenCalled();
  });

  it.each([false, true])('uses the CTQ domain and preserves the token fragment for admin=%s', async (admin) => {
    config.get.mockReturnValue('https://ctq.serviciosasm.cl/restablecer-contrasena');
    const pending = service.requestReset(user.email, admin);
    await jest.advanceTimersByTimeAsync(300);
    await expect(pending).resolves.toMatchObject({ success: true });
    expect(email.sendResetPasswordEmail).toHaveBeenCalledWith(
      user.email,
      `https://ctq.serviciosasm.cl/restablecer-contrasena#token=${token}`,
      '24 horas',
    );
    const link = new URL(email.sendResetPasswordEmail.mock.calls[0][1]);
    expect(link.search).toBe('');
    expect(link.hash).toBe(`#token=${token}`);
    expect(model.findOneAndUpdate.mock.calls[0][1].$set.passwordResetExpiresAt)
      .toEqual(new Date(now.getTime() + PASSWORD_RESET_TTL_MS));
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  it.each(['missing account', 'inactive account', '24-hour request limit'])('returns the same generic message for %s and sends no email', async () => {
    model.findOneAndUpdate.mockReturnValue(query(null));
    await expect(request()).resolves.toEqual({ success: true, message: PASSWORD_RESET_REQUEST_MESSAGE });
    expect(email.sendResetPasswordEmail).not.toHaveBeenCalled();
  });

  it('allows the server-authorized admin to bypass time limits but never the active-account requirement', async () => {
    const pending = service.requestReset(user.email, true);
    await jest.advanceTimersByTimeAsync(300);
    await expect(pending).resolves.toEqual({ success: true, message: PASSWORD_RESET_ADMIN_MESSAGE });
    expect(model.findOneAndUpdate.mock.calls[0][0]).toEqual({ email: user.email, statePlayer: true });
    expect(model.findOneAndUpdate.mock.calls[0][1].$set.passwordResetExpiresAt).toEqual(new Date(now.getTime() + PASSWORD_RESET_ADMIN_TTL_MS));
    expect(PASSWORD_RESET_ADMIN_TTL_MS).toBe(86_400_000);
    expect(email.sendResetPasswordEmail).toHaveBeenCalledWith(user.email, `http://localhost:5173/restablecer-contrasena#token=${token}`, '24 horas');
    expect(email.sendResetPasswordEmail).toHaveBeenCalledTimes(1);
  });

  it('does not send an admin link when the requested account is inactive or missing', async () => {
    model.findOneAndUpdate.mockReturnValue(query(null));
    const pending = service.requestReset(user.email, true);
    await jest.advanceTimersByTimeAsync(300);
    await expect(pending).resolves.toEqual({ success: true, message: PASSWORD_RESET_ADMIN_MESSAGE });
    expect(email.sendResetPasswordEmail).not.toHaveBeenCalled();
  });

  it('returns without waiting for slow mail delivery', async () => {
    email.sendResetPasswordEmail.mockReturnValue(new Promise(() => {}));
    await expect(request()).resolves.toMatchObject({ success: true });
  });

  it('does not alter the password on mail failure and invalidates only that failed link', async () => {
    email.sendResetPasswordEmail.mockRejectedValue(new Error('mailer failure'));
    await expect(request()).resolves.toEqual({ success: true, message: PASSWORD_RESET_REQUEST_MESSAGE });
    expect(model.updateOne).toHaveBeenCalledWith({ email: user.email, passwordResetTokenHash: tokenHash }, { $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 } });
    expect(model.updateOne.mock.calls[0][1].$unset).not.toHaveProperty('passwordResetRequestedAt');
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  it('handles cleanup failure without leaking tokens or leaving an unhandled rejection', async () => {
    email.sendResetPasswordEmail.mockRejectedValue(new Error(token));
    model.updateOne.mockReturnValue({ exec: jest.fn().mockRejectedValue(new Error(token)) });
    await expect(request()).resolves.toMatchObject({ success: true });
    expect(JSON.stringify((Logger.prototype.error as jest.Mock).mock.calls)).not.toContain(token);
  });

  it('reports database unavailability without exposing query details', async () => {
    model.findOneAndUpdate.mockReturnValue({ select() { return this; }, exec: jest.fn().mockRejectedValue(new Error('private-database-detail')) });
    await expect(request()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(email.sendResetPasswordEmail).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'invalid', 'http://front.example/reset', 'https://user:password@front.example/reset', 'https://front.example/reset?redirect=evil', 'https://front.example/reset#token=evil'])('rejects an unconfigured or unsafe link base: %s', async value => {
    config.get.mockReturnValue(value);
    await expect(request()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('accepts a fixed HTTPS production front URL', async () => {
    config.get.mockReturnValue('https://front.example/restablecer-contrasena');
    await request();
    expect(email.sendResetPasswordEmail.mock.calls[0][1]).toBe(`https://front.example/restablecer-contrasena#token=${token}`);
  });

  it('hashes the chosen password and atomically consumes the unexpired token without changing roles or access/payment flags', async () => {
    await expect(service.confirmReset(dto)).resolves.toMatchObject({ success: true });
    expect(bcrypt.hash).toHaveBeenCalledWith(dto.password, 10);
    expect(model.findOneAndUpdate).toHaveBeenCalledWith({ _id: user._id, passwordResetTokenHash: tokenHash, passwordResetExpiresAt: { $gt: now } }, {
      $set: { pwd: 'new-hash' }, $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 },
    }, { new: true, runValidators: true });
    expect(email.sendPasswordChangedEmail).toHaveBeenCalledWith(user.email);
  });

  it.each(['expired', 'used', 'replaced', 'missing'])('rejects an %s token before hashing a password', async () => {
    model.findOne.mockReturnValue(query(null));
    await expect(service.confirmReset(dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('allows only one of two concurrent confirmations to succeed', async () => {
    model.findOneAndUpdate.mockReturnValueOnce(query(user)).mockReturnValueOnce(query(null));
    const results = await Promise.allSettled([service.confirmReset(dto), service.confirmReset(dto)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(email.sendPasswordChangedEmail).toHaveBeenCalledTimes(1);
  });

  it('rechecks expiry after slow password hashing', async () => {
    (bcrypt.hash as jest.Mock).mockImplementation(async () => { jest.setSystemTime(new Date(now.getTime() + PASSWORD_RESET_TTL_MS)); return 'new-hash'; });
    model.findOneAndUpdate.mockReturnValue(query(null));
    await expect(service.confirmReset(dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(model.findOneAndUpdate.mock.calls[0][0].passwordResetExpiresAt.$gt).toEqual(new Date(now.getTime() + PASSWORD_RESET_TTL_MS));
  });

  it.each([16 * 60_000, 86_400_000 - 1])('accepts a newly issued link after %i milliseconds, before 24 hours', async elapsed => {
    await request();
    const expiresAt = model.findOneAndUpdate.mock.calls[0][1].$set.passwordResetExpiresAt;
    model.findOne.mockImplementation(filter => query(expiresAt > filter.passwordResetExpiresAt.$gt ? user : null));
    model.findOneAndUpdate.mockImplementation(filter => query(expiresAt > filter.passwordResetExpiresAt.$gt ? user : null));
    jest.setSystemTime(new Date(now.getTime() + elapsed));
    await expect(service.confirmReset(dto)).resolves.toMatchObject({ success: true });
    expect(bcrypt.hash).toHaveBeenCalledTimes(1);
  });

  it.each([86_400_000, 86_400_000 + 1])('rejects a newly issued link at or after 24 hours: %i milliseconds', async elapsed => {
    await request();
    const expiresAt = model.findOneAndUpdate.mock.calls[0][1].$set.passwordResetExpiresAt;
    model.findOne.mockImplementation(filter => query(expiresAt > filter.passwordResetExpiresAt.$gt ? user : null));
    model.findOneAndUpdate.mockClear();
    jest.setSystemTime(new Date(now.getTime() + elapsed));
    await expect(service.confirmReset(dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each([
    { token: 'invalid' }, { password: 'short', passwordConfirmation: 'short' }, { passwordConfirmation: 'different' },
    { password: 'x'.repeat(73), passwordConfirmation: 'x'.repeat(73) }, { password: 'á'.repeat(40), passwordConfirmation: 'á'.repeat(40) },
  ])('rejects invalid confirmation data before accessing Mongo: %j', async changes => {
    await expect(service.confirmReset({ ...dto, ...changes })).rejects.toBeInstanceOf(BadRequestException);
    expect(model.findOne).not.toHaveBeenCalled();
  });

  it('does not turn a successful password change into failure if its notification fails', async () => {
    email.sendPasswordChangedEmail.mockRejectedValue(new Error('mailer failure'));
    await expect(service.confirmReset(dto)).resolves.toMatchObject({ success: true });
  });

  it('excludes all recovery metadata from default member/profile reads and defines no TTL on member records', () => {
    for (const field of ['passwordResetTokenHash', 'passwordResetExpiresAt', 'passwordResetRequestedAt', 'passwordResetRequests']) {
      expect(RegisterSchema.path(field).options.select).toBe(false);
    }
    expect(RegisterSchema.indexes().every(([, options]) => options.expireAfterSeconds === undefined)).toBe(true);
  });
});
