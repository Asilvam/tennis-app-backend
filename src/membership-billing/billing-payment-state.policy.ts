type PaymentState = {
  method?: string;
  status?: string;
  paidAt?: unknown;
  confirmedAt?: unknown;
  provider?: { name?: string; paymentId?: string; status?: string; verifiedAt?: unknown };
  checkout?: { creationStatus?: string; expiresAt?: Date };
};

const validDate = (value: unknown) => value instanceof Date && Number.isFinite(value.getTime());

export function verifiedMembershipConfirmation(payment: PaymentState): boolean {
  return (
    payment.method === 'MERCADO_PAGO' &&
    payment.status === 'CONFIRMED' &&
    payment.provider?.name === 'MERCADO_PAGO' &&
    /^\d{1,30}$/.test(payment.provider.paymentId || '') &&
    payment.provider.status === 'approved' &&
    validDate(payment.provider.verifiedAt) &&
    validDate(payment.paidAt) &&
    validDate(payment.confirmedAt)
  );
}

export function uncertainMembershipPayment(payment: PaymentState, now: Date): boolean {
  if (payment.method !== 'MERCADO_PAGO') return false;
  return (
    ['PENDING', 'REVIEW_REQUIRED'].includes(payment.status) ||
    (['CREATING', 'UNKNOWN'].includes(payment.checkout?.creationStatus) &&
      !verifiedMembershipConfirmation(payment)) ||
    (['REJECTED', 'CANCELLED'].includes(payment.status) && payment.checkout?.expiresAt > now)
  );
}

export function uncertainMembershipPaymentFilter(now: Date) {
  return {
    method: 'MERCADO_PAGO',
    $or: [
      { status: { $in: ['PENDING', 'REVIEW_REQUIRED'] } },
      {
        'checkout.creationStatus': { $in: ['CREATING', 'UNKNOWN'] },
        $nor: [
          {
            status: 'CONFIRMED',
            'provider.name': 'MERCADO_PAGO',
            'provider.paymentId': { $regex: '^\\d{1,30}$' },
            'provider.status': 'approved',
            'provider.verifiedAt': { $type: 'date' },
            paidAt: { $type: 'date' },
            confirmedAt: { $type: 'date' },
          },
        ],
      },
      { status: { $in: ['REJECTED', 'CANCELLED'] }, 'checkout.expiresAt': { $gt: now } },
    ],
  };
}
