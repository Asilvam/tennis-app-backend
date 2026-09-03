import { MonthPayCtqController } from './month-pay-ctq.controller';

describe('MonthPayCtqController', () => {
  const service = {
    initiatePayment: jest.fn(),
    getPaymentHistory: jest.fn(),
    approvePayment: jest.fn(),
    sendMonthlyPaymentEmail: jest.fn(),
  };
  const controller = new MonthPayCtqController(service as any);

  beforeEach(() => jest.clearAllMocks());

  it('delegates payment initiation', async () => {
    const dto = { email: 'payer@example.com' } as any;
    service.initiatePayment.mockResolvedValue({ preferenceId: 'pref-1' });
    await expect(controller.initiatePayment(dto)).resolves.toEqual({ preferenceId: 'pref-1' });
    expect(service.initiatePayment).toHaveBeenCalledWith(dto);
  });

  it('delegates payment history', async () => {
    service.getPaymentHistory.mockResolvedValue([]);
    await expect(controller.getPaymentHistory('payer@example.com')).resolves.toEqual([]);
    expect(service.getPaymentHistory).toHaveBeenCalledWith('payer@example.com');
  });

  it('delegates payment approval', async () => {
    service.approvePayment.mockResolvedValue({ status: 'approved' });
    await expect(controller.approvePayment('payment-1')).resolves.toEqual({ status: 'approved' });
    expect(service.approvePayment).toHaveBeenCalledWith('payment-1');
  });

  it('maps reservationId to the monthly payment email identifier', async () => {
    service.sendMonthlyPaymentEmail.mockResolvedValue(undefined);
    const body = { reservationId: 'payment-1', paymentStatus: 'approved' };
    await expect(controller.sendEmailConfirmation(body)).resolves.toBeUndefined();
    expect(service.sendMonthlyPaymentEmail).toHaveBeenCalledWith('payment-1', 'approved');
  });
});
