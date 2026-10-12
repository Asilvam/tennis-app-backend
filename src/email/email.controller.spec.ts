import { EmailController } from './email.controller';

describe('EmailController', () => {
  it('sends the requested email and returns a confirmation', async () => {
    const emailService = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    const controller = new EmailController(emailService as any);
    const dto = { to: 'to@example.com', subject: 'Subject', html: 'Body' };

    await expect(controller.sendEmail(dto)).resolves.toEqual({ message: 'Email sent successfully' });
    expect(emailService.sendEmail).toHaveBeenCalledWith(dto);
  });

  it('propagates email service failures', async () => {
    const emailService = { sendEmail: jest.fn().mockRejectedValue(new Error('unavailable')) };
    const controller = new EmailController(emailService as any);

    await expect(controller.sendEmail({ to: 'to@example.com', subject: 'Subject', html: 'Body' })).rejects.toThrow(
      'unavailable',
    );
  });
});
