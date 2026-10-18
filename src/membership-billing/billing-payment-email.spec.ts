import { buildMembershipPaymentEmail } from './billing-payment-email';

describe('Monthly receipt emails', () => {
  const payment = (method: string) =>
    ({
      method,
      amount: 180,
      payer: { name: '<script>payer</script>' },
      publicReference: 'monthly-fixture',
      provider: { paymentId: '123' },
      bank: { reference: 'bank-fixture' },
      allocations: [{ beneficiaryName: '<img src=x>', period: '2026-10', amount: 180 }],
    }) as any;
  it('distinguishes provider-confirmed monthly income from a manually verified bank record', () => {
    const mp = buildMembershipPaymentEmail(payment('MERCADO_PAGO'), false);
    expect(mp.html).toContain('Mercado Pago confirmo');
    expect(mp.html).toContain('Operacion Mercado Pago: 123');
    expect(mp.html).not.toContain('Referencia bancaria:');
    const bank = buildMembershipPaymentEmail(payment('BANK_TRANSFER'), false);
    expect(bank.html).toContain('Transferencia bancaria');
    expect(bank.html).toContain('Referencia bancaria: bank-fixture');
  });
  it('escapes names and never equates a banking reversal with a money refund', () => {
    const result = buildMembershipPaymentEmail(payment('BANK_DEPOSIT'), true);
    expect(result.html).toContain('&lt;script&gt;');
    expect(result.html).not.toContain('<img src=x>');
    expect(result.html).toContain('no representa una devolucion');
  });
});
