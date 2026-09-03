import axios from 'axios';
import { NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { MonthPayCtqService } from './month-pay-ctq.service';

jest.mock('axios');
jest.mock('uuid', () => ({ v4: jest.fn() }));

describe('MonthPayCtqService', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;
  const mockedUuid = uuidv4 as jest.Mock;

  function queryResult<T>(value: T) {
    return { exec: jest.fn().mockResolvedValue(value) };
  }

  function createService() {
    const documentSave = jest.fn().mockImplementation(function (this: unknown) {
      return Promise.resolve(this);
    });
    const model: any = jest.fn().mockImplementation((data) => ({ ...data, save: documentSave }));
    model.findOne = jest.fn();
    model.find = jest.fn();

    const registerService = {
      findOneByEmail: jest.fn(),
      enablePlayerPayment: jest.fn().mockResolvedValue(undefined),
    };
    const configService = {
      get: jest.fn((key: string) => (key === 'MP_API_URL' ? 'https://mp.internal' : undefined)),
    };
    const emailService = { sendEmail: jest.fn().mockResolvedValue(undefined) };

    const service = new MonthPayCtqService(model, registerService as any, configService as any, emailService as any);
    return { service, model, documentSave, registerService, configService, emailService };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUuid.mockReturnValue('1234567890abcdef-uuid');
  });

  it('finds a payment by its public id', async () => {
    const { service, model } = createService();
    const payment = { idPayment: 'payment-1' };
    model.findOne.mockReturnValue(queryResult(payment));

    await expect(service.findByPaymentId('payment-1')).resolves.toBe(payment);
    expect(model.findOne).toHaveBeenCalledWith({ idPayment: 'payment-1' });
  });

  it('rejects initiation when the payer does not exist', async () => {
    const { service, model, registerService } = createService();
    registerService.findOneByEmail.mockResolvedValue(null);

    await expect(service.initiatePayment({ email: 'missing@example.com' } as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(model).not.toHaveBeenCalled();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('persists a pending titular payment before requesting the preference', async () => {
    const { service, model, documentSave, registerService } = createService();
    registerService.findOneByEmail.mockResolvedValue({ namePlayer: 'Ana' });
    mockedAxios.post.mockResolvedValue({ data: { preferenceId: 'pref-1', initPoint: 'https://pay' } });

    const result = await service.initiatePayment({
      email: 'ana@example.com',
      paymentType: 'Titular',
      amount: 18_000,
      monthToPay: '09-2026',
    });

    expect(model).toHaveBeenCalledWith({
      idPayment: '1234567890abcde',
      namePlayer: 'Ana',
      email: 'ana@example.com',
      paymentType: 'Titular',
      amount: 18_000,
      monthToPay: '09-2026',
      emailCarga: undefined,
      status: 'pending',
    });
    expect(documentSave).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).toHaveBeenCalledWith('https://mp.internal/create-preference-monthly', {
      email: 'ana@example.com',
      paymentType: 'Titular',
      amount: 18_000,
      monthToPay: '09-2026',
      idPayment: '1234567890abcde',
      emailCarga: undefined,
    });
    expect(result).toEqual({ preferenceId: 'pref-1', initPoint: 'https://pay' });
  });

  it('includes the beneficiary when initiating a familiar payment', async () => {
    const { service, registerService } = createService();
    registerService.findOneByEmail.mockResolvedValue({ namePlayer: 'Ana' });
    mockedAxios.post.mockResolvedValue({ data: { preferenceId: 'pref-2' } });

    await service.initiatePayment({
      email: 'ana@example.com',
      paymentType: 'Familiar',
      amount: 5_000,
      monthToPay: '09-2026',
      emailCarga: 'child@example.com',
    });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ emailCarga: 'child@example.com' }),
    );
  });

  it('propagates Mercado Pago preference failures after persisting', async () => {
    const { service, documentSave, registerService } = createService();
    registerService.findOneByEmail.mockResolvedValue({ namePlayer: 'Ana' });
    mockedAxios.post.mockRejectedValue(new Error('MP unavailable'));

    await expect(
      service.initiatePayment({
        email: 'ana@example.com',
        paymentType: 'Titular',
        amount: 18_000,
        monthToPay: '09-2026',
      }),
    ).rejects.toThrow('MP unavailable');
    expect(documentSave).toHaveBeenCalledTimes(1);
  });

  it('returns null when approval references an unknown payment', async () => {
    const { service, model, registerService } = createService();
    model.findOne.mockReturnValue(queryResult(null));

    await expect(service.approvePayment('missing')).resolves.toBeNull();
    expect(registerService.enablePlayerPayment).not.toHaveBeenCalled();
  });

  it('returns an already approved payment without repeating effects', async () => {
    const { service, model, registerService } = createService();
    const payment = { idPayment: 'payment-1', status: 'approved' };
    model.findOne.mockReturnValue(queryResult(payment));

    await expect(service.approvePayment('payment-1')).resolves.toBe(payment);
    expect(registerService.enablePlayerPayment).not.toHaveBeenCalled();
  });

  it.each([
    ['Titular', undefined, 'payer@example.com'],
    ['Familiar', 'child@example.com', 'child@example.com'],
    ['Familiar', undefined, 'payer@example.com'],
  ])('approves %s payments and enables the expected account', async (paymentType, emailCarga, expectedEmail) => {
    const { service, model, registerService } = createService();
    const payment: any = {
      idPayment: 'payment-1',
      status: 'pending',
      paymentType,
      email: 'payer@example.com',
      emailCarga,
      save: jest.fn(),
    };
    payment.save.mockResolvedValue(payment);
    model.findOne.mockReturnValue(queryResult(payment));

    await expect(service.approvePayment('payment-1')).resolves.toBe(payment);
    expect(payment.status).toBe('approved');
    expect(registerService.enablePlayerPayment).toHaveBeenCalledWith(expectedEmail);
  });

  it('returns payment history sorted newest first', async () => {
    const { service, model } = createService();
    const history = [{ idPayment: 'newest' }];
    const query = { sort: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(history) };
    model.find.mockReturnValue(query);

    await expect(service.getPaymentHistory('payer@example.com')).resolves.toBe(history);
    expect(model.find).toHaveBeenCalledWith({ email: 'payer@example.com' });
    expect(query.sort).toHaveBeenCalledWith({ createdAt: -1 });
  });

  it('does not email when the monthly payment does not exist', async () => {
    const { service, model, emailService } = createService();
    model.findOne.mockReturnValue(queryResult(null));

    await expect(service.sendMonthlyPaymentEmail('missing', 'approved')).resolves.toBeUndefined();
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });

  it('sends an approved titular payment email using the payer name', async () => {
    const { service, model, registerService, emailService } = createService();
    model.findOne.mockReturnValue(
      queryResult({
        idPayment: 'payment-1',
        email: 'payer@example.com',
        namePlayer: 'Stored Name',
        paymentType: 'Titular',
        monthToPay: '09-2026',
        amount: 18_000,
      }),
    );
    registerService.findOneByEmail.mockResolvedValue({ namePlayer: 'Current Name' });

    await service.sendMonthlyPaymentEmail('payment-1', 'approved');

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'payer@example.com',
        subject: expect.stringContaining('Pago Confirmado'),
        html: expect.stringContaining('Current Name'),
      }),
    );
  });

  it.each([
    [{ namePlayer: 'Child Name' }, 'Child Name'],
    [null, 'child@example.com'],
  ])('describes the family beneficiary in an approved email', async (beneficiary, expectedName) => {
    const { service, model, registerService, emailService } = createService();
    model.findOne.mockReturnValue(
      queryResult({
        idPayment: 'payment-1',
        email: 'payer@example.com',
        namePlayer: 'Stored Name',
        paymentType: 'Familiar',
        emailCarga: 'child@example.com',
        monthToPay: '09-2026',
        amount: 5_000,
      }),
    );
    registerService.findOneByEmail.mockResolvedValueOnce({ namePlayer: 'Payer' }).mockResolvedValueOnce(beneficiary);

    await service.sendMonthlyPaymentEmail('payment-1', 'approved');

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ html: expect.stringContaining(expectedName) }),
    );
  });

  it.each([
    ['Titular', undefined, null, 'Stored Name'],
    ['Familiar', 'child@example.com', { namePlayer: 'Child Name' }, 'Child Name'],
    ['Familiar', 'child@example.com', null, 'child@example.com'],
  ])('sends a rejected %s payment email', async (paymentType, emailCarga, beneficiary, expectedName) => {
    const { service, model, registerService, emailService } = createService();
    model.findOne.mockReturnValue(
      queryResult({
        idPayment: 'payment-1',
        email: 'payer@example.com',
        namePlayer: 'Stored Name',
        paymentType,
        emailCarga,
        monthToPay: '09-2026',
        amount: 5_000,
      }),
    );
    registerService.findOneByEmail.mockResolvedValueOnce(null).mockResolvedValueOnce(beneficiary);

    await service.sendMonthlyPaymentEmail('payment-1', 'rejected');

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Pago Rechazado'),
        html: expect.stringContaining(expectedName),
      }),
    );
  });
});
