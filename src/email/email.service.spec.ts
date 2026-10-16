import axios from 'axios';
import { EmailService } from './email.service';

jest.mock('axios');

describe('EmailService', () => {
  const config = {
    EMAIL_SERVICE_API_URL: 'http://email-service.local',
    EMAIL_SERVICE_API_KEY: 'api-key',
  };
  const configService = { get: jest.fn((key: string) => config[key]) };
  let service: EmailService;

  beforeEach(() => {
    jest.clearAllMocks();
    configService.get.mockImplementation((key: string) => config[key]);
    service = new EmailService(configService as any);
  });

  it.each(['EMAIL_SERVICE_API_URL', 'EMAIL_SERVICE_API_KEY'])('requires %s', async (missingKey) => {
    configService.get.mockImplementation((key: string) => (key === missingKey ? undefined : config[key]));
    await expect(service.sendEmail({ to: 'to@example.com', subject: 'Subject', html: '<p>Body</p>' })).rejects.toThrow(
      'Email service is not configured',
    );
  });

  it('sends an email without an idempotency key', async () => {
    (axios.post as jest.Mock).mockResolvedValue({ status: 202 });
    const dto = { to: 'to@example.com', subject: 'Subject', html: '<p>Body</p>' };

    await expect(service.sendEmail(dto)).resolves.toBeUndefined();
    expect(axios.post).toHaveBeenCalledWith('http://email-service.local/send', dto, {
      headers: { 'x-api-key': 'api-key' },
    });
  });

  it('forwards an idempotency key', async () => {
    (axios.post as jest.Mock).mockResolvedValue({ status: 202 });
    await service.sendEmail({ to: 'to@example.com', subject: 'Subject', html: 'Body' }, 'request-1');
    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ headers: { 'x-api-key': 'api-key', 'Idempotency-Key': 'request-1' } }),
    );
  });

  it('wraps transport failures', async () => {
    (axios.post as jest.Mock).mockRejectedValue(new Error('connection refused'));
    await expect(service.sendEmail({ to: 'to@example.com', subject: 'Subject', html: 'Body' })).rejects.toThrow(
      'Failed to send email: connection refused',
    );
  });

  it('builds and sends a password reset email', async () => {
    jest.spyOn(service, 'sendEmail').mockResolvedValue(undefined);
    await service.sendResetPasswordEmail('to@example.com', 'https://front.example/reset#token=fixture&test=1');
    expect(service.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'to@example.com',
        subject: expect.stringContaining('Restablecer contraseña'),
        html: expect.stringContaining('token=fixture&amp;test=1'),
      }),
    );
    expect(service.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ html: expect.stringContaining('vence en 24 horas') }));
  });

  it('wraps password reset email failures', async () => {
    jest.spyOn(service, 'sendEmail').mockRejectedValue(new Error('unavailable'));
    await expect(service.sendResetPasswordEmail('to@example.com', 'https://front.example/reset')).rejects.toThrow(
      'Failed to send reset password email: unavailable',
    );
  });

  it('sends the admin link with its 24-hour validity in the email', async () => {
    jest.spyOn(service, 'sendEmail').mockResolvedValue(undefined);
    await service.sendResetPasswordEmail('to@example.com', 'https://front.example/reset#token=fixture', '24 horas');
    expect(service.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ html: expect.stringContaining('vence en 24 horas') }));
  });

  it('sends a change notification without a password', async () => {
    jest.spyOn(service, 'sendEmail').mockResolvedValue(undefined);
    await service.sendPasswordChangedEmail('to@example.com');
    expect(service.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'to@example.com', subject: expect.stringContaining('Contraseña actualizada') }));
  });

  it('builds and sends a verification email', async () => {
    jest.spyOn(service, 'sendEmail').mockResolvedValue(undefined);
    await service.sendVerificationEmail('to@example.com', 'https://example.com?a=1&b=2');
    expect(service.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'to@example.com',
        subject: expect.stringContaining('Verifica tu correo'),
        html: expect.stringContaining('a=1&amp;b=2'),
      }),
    );
  });

  it('wraps verification email failures', async () => {
    jest.spyOn(service, 'sendEmail').mockRejectedValue(new Error('unavailable'));
    await expect(service.sendVerificationEmail('to@example.com', 'link')).rejects.toThrow(
      'Failed to send verification email: unavailable',
    );
  });
});
