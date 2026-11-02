import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BillingLifecycleController } from './billing-lifecycle.controller';
import { BillingLifecycleService } from './billing-lifecycle.service';
import { UpdateBillingAutomationDto } from './dto/billing-automation.dto';

describe('Billing automation control contract', () => {
  const input = { setting: 'generation', enabled: false, revision: 'a'.repeat(64) };
  const errors = (body: unknown) =>
    validate(plainToInstance(UpdateBillingAutomationDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it.each(['generation', 'autoBlock'])('accepts only explicit booleans for %s', async (setting) => {
    expect(await errors({ ...input, setting })).toHaveLength(0);
    expect(await errors({ ...input, setting, enabled: true })).toHaveLength(0);
  });
  it.each([undefined, null, 'false', 'true', 0, 1])(
    'rejects coerced enabled=%s',
    async (enabled) => {
      expect((await errors({ ...input, enabled })).length).toBeGreaterThan(0);
    },
  );
  it('forbids tariff, review and termination changes from this endpoint', async () => {
    for (const body of [
      { ...input, setting: 'termination' },
      { ...input, migrationReviewed: true },
      { ...input, automation: { terminationEnabled: false } },
      { ...input, revision: 'stale' },
    ])
      expect((await errors(body)).length).toBeGreaterThan(0);
  });
  it('delegates using the authenticated email, never a client-supplied identity', async () => {
    const lifecycle = { automationSettings: jest.fn(), updateAutomationSettings: jest.fn() };
    const controller = new BillingLifecycleController(
      lifecycle as unknown as BillingLifecycleService,
    );
    const request = { user: { email: 'admin@example.invalid' } };
    controller.settings(request);
    controller.updateSettings(request, input as UpdateBillingAutomationDto);
    expect(lifecycle.automationSettings).toHaveBeenCalledWith(request.user.email);
    expect(lifecycle.updateAutomationSettings).toHaveBeenCalledWith(request.user.email, input);
  });
});
