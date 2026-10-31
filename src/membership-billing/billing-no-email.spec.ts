import { MODULE_METADATA } from '@nestjs/common/constants';
import { MembershipBillingModule } from './membership-billing.module';
import { MembershipPaymentSchema } from './entities/membership-payment.entity';
import { Mongoose, Types } from 'mongoose';

describe('Monthly payments without automatic email', () => {
  it('does not register an email worker or import the email module', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, MembershipBillingModule);
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, MembershipBillingModule);
    expect(providers.map((provider) => provider.name)).not.toContain('BillingNotificationsService');
    expect(imports.map((module) => module.name)).not.toContain('EmailModule');
    expect(providers.map((provider) => provider.name)).toEqual(
      expect.arrayContaining([
        'BillingAdminService',
        'MembershipMpService',
        'BillingLifecycleService',
      ]),
    );
  });

  it('creates no notification for a new payment with a payer email', () => {
    const isolated = new Mongoose();
    const Payment = isolated.model('PaymentWithoutEmail', MembershipPaymentSchema);
    const payment = new Payment({ payer: { name: 'Test', email: 'test@example.invalid' } });
    expect(payment.notifications).toEqual([]);
  });

  it('retains legacy notification evidence without changing or rescheduling it', () => {
    const isolated = new Mongoose();
    const Payment = isolated.model('PaymentWithLegacyEmail', MembershipPaymentSchema);
    const notifications = [
      {
        _id: new Types.ObjectId(),
        recipient: 'test@example.invalid',
        eventKey: 'legacy:confirmed',
        status: 'FAILED',
        attempts: 6,
        lastError: 'Historical error',
      },
    ];
    const payment = Payment.hydrate({ notifications });
    expect(payment.toObject().notifications).toEqual(notifications);
    expect(payment.isModified('notifications')).toBe(false);
  });
});
