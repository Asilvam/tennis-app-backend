import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  it('uses the configured secret and returns the allowed payload fields', async () => {
    const configService = { get: jest.fn().mockReturnValue('jwt-secret') };
    const strategy = new JwtStrategy(configService as any);
    const payload = { email: 'user@example.com', role: 'admin', ignored: 'value' };

    await expect(strategy.validate(payload)).resolves.toEqual({
      email: payload.email,
      role: payload.role,
    });
    expect(configService.get).toHaveBeenCalledWith('SECRET_KEY');
  });
});
