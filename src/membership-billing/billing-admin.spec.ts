import { validate } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { BillingAdminEnabledGuard } from './billing-admin.guard';
import { RegisterBankPaymentDto, ReverseBankPaymentDto } from './dto/register-bank-payment.dto';
import { buildMembershipPaymentEmail } from './billing-payment-email';
import { MembershipPayment } from './entities/membership-payment.entity';

describe('Bank administration contracts and monthly email', () => {
  it('disables the administrative flow unless explicitly enabled', () => {
    for (const value of [undefined, 'false', true, '1']) {
      expect(() =>
        new BillingAdminEnabledGuard({
          get: () => value,
        } as unknown as ConfigService).canActivate(),
      ).toThrow();
    }
    expect(
      new BillingAdminEnabledGuard({ get: () => 'true' } as unknown as ConfigService).canActivate(),
    ).toBe(true);
  });
  const payload = () =>
    Object.assign(new RegisterBankPaymentDto(), {
      dueIds: ['100000000000000000000001'],
      method: 'BANK_TRANSFER',
      amount: 180,
      payerName: 'usuario test 1',
      receivedDate: '2026-10-17',
      reference: 'bank-123',
      verified: true,
    });
  it('accepts only complete bank payments and no client-supplied actor/provider/status', async () => {
    expect(await validate(payload(), { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(
      0,
    );
    for (const extra of [
      { actorId: '100000000000000000000001' },
      { status: 'CONFIRMED' },
      { provider: 'MERCADO_PAGO' },
    ]) {
      expect(
        await validate(Object.assign(payload(), extra), {
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      ).not.toHaveLength(0);
    }
  });
  it.each([
    { method: 'MERCADO_PAGO' },
    { amount: 0 },
    { amount: 180.1 },
    { verified: false },
    { dueIds: [] },
    { dueIds: ['bad'] },
  ])('rejects invalid bank contract %j', async (changes) => {
    expect(await validate(Object.assign(payload(), changes))).not.toHaveLength(0);
  });
  it('requires a reason for administrative reversal', async () => {
    expect(
      await validate(Object.assign(new ReverseBankPaymentDto(), { reason: '' })),
    ).not.toHaveLength(0);
    expect(
      await validate(Object.assign(new ReverseBankPaymentDto(), { reason: 'Registro equivocado' })),
    ).toHaveLength(0);
  });
  it('escapes names/references and identifies bank method, beneficiaries and months without promising access', () => {
    const payment = {
      publicReference: 'membership-test',
      payer: { name: '<script>payer</script>' },
      bank: { reference: '<reference>' },
      method: 'BANK_TRANSFER',
      amount: 230,
      allocations: [
        { beneficiaryName: '<socio>', period: '2026-10', amount: 180 },
        { beneficiaryName: 'usuario test 2', period: '2026-10', amount: 50 },
      ],
    } as MembershipPayment;
    const email = buildMembershipPaymentEmail(payment, false);
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('&lt;reference&gt;');
    expect(email.html).toContain('2026-10');
    expect(email.html).toContain('Transferencia bancaria');
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('habilitada exitosamente');
  });
});
