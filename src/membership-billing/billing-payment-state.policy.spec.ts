import {
  uncertainMembershipPayment,
  verifiedMembershipConfirmation,
} from './billing-payment-state.policy';
const now = new Date('2026-10-27T15:00:00Z');
const confirmed = () => ({
  method: 'MERCADO_PAGO',
  status: 'CONFIRMED',
  paidAt: now,
  confirmedAt: now,
  provider: { name: 'MERCADO_PAGO', paymentId: '123', status: 'approved', verifiedAt: now },
  checkout: { creationStatus: 'UNKNOWN' },
});
describe('Payment evidence takes precedence over checkout creation metadata', () => {
  it('recognizes verified confirmation without rewriting historical UNKNOWN metadata', () => {
    const payment = confirmed(),
      before = JSON.stringify(payment);
    expect(verifiedMembershipConfirmation(payment)).toBe(true);
    expect(uncertainMembershipPayment(payment, now)).toBe(false);
    expect(JSON.stringify(payment)).toBe(before);
  });
  it.each(['PENDING', 'REVIEW_REQUIRED', 'CANCELLED', 'REJECTED'])(
    'does not ignore %s merely because provider data exists',
    (status) => {
      expect(uncertainMembershipPayment({ ...confirmed(), status }, now)).toBe(true);
    },
  );
  it.each(['paidAt', 'confirmedAt', 'provider'])('requires evidence %s', (key) => {
    const row = confirmed();
    delete row[key];
    expect(uncertainMembershipPayment(row, now)).toBe(true);
  });
  it('retains refund or invalid evidence for review', () => {
    const row = confirmed();
    row.provider.status = 'refunded';
    expect(uncertainMembershipPayment(row, now)).toBe(true);
    row.provider.status = 'approved';
    row.provider.paymentId = 'invalid';
    expect(uncertainMembershipPayment(row, now)).toBe(true);
  });
  it('closed, expired attempts without uncertain creation no longer block', () => {
    expect(
      uncertainMembershipPayment(
        {
          method: 'MERCADO_PAGO',
          status: 'CANCELLED',
          checkout: { creationStatus: 'FAILED', expiresAt: new Date(now.getTime() - 1) },
        },
        now,
      ),
    ).toBe(false);
  });
});
