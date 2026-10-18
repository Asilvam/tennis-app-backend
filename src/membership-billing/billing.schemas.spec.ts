import { model, Types } from 'mongoose';
import { validate } from 'class-validator';
import { MembershipDueSchema } from './entities/membership-due.entity';
import { MembershipPaymentSchema } from './entities/membership-payment.entity';
import { MembershipBillingConfigSchema } from './entities/membership-billing-config.entity';
import { proposedBillingConfiguration } from './billing.types';
import { dueAt } from './billing.policy';
import { SelectMembershipDuesDto } from './dto/select-membership-dues.dto';

const Due = model('BillingSchemaDueTest', MembershipDueSchema);
const Payment = model('BillingSchemaPaymentTest', MembershipPaymentSchema);
const Config = model('BillingSchemaConfigTest', MembershipBillingConfigSchema);
const id = new Types.ObjectId();
const due = () => ({
  beneficiaryId: id,
  period: '2026-10',
  dueAt: dueAt('2026-10'),
  memberTypeSnapshot: 'TITULAR',
  tariffVersionId: 'v1',
  amount: 18000,
  currency: 'CLP',
  pricingMode: 'STANDARD',
});
const payment = () => ({
  publicReference: 'test-ref',
  payer: { memberId: id, name: 'usuario test 1' },
  method: 'MERCADO_PAGO',
  amount: 18000,
  currency: 'CLP',
  pricingMode: 'STANDARD',
  allocations: [
    { dueId: new Types.ObjectId(), beneficiaryId: id, period: '2026-10', amount: 18000 },
  ],
});

describe('Membership schemas (validation only; no connection)', () => {
  it('does not create collections or indexes automatically and never expires payment history', () => {
    for (const schema of [
      MembershipDueSchema,
      MembershipPaymentSchema,
      MembershipBillingConfigSchema,
    ]) {
      expect(schema.get('autoCreate')).toBe(false);
      expect(schema.get('autoIndex')).toBe(false);
      expect(schema.indexes().some(([, options]) => options.expireAfterSeconds !== undefined)).toBe(
        false,
      );
    }
  });
  it('enforces one due per beneficiary/month and provider IDs only when populated', () => {
    expect(MembershipDueSchema.indexes()).toContainEqual([
      { beneficiaryId: 1, period: 1 },
      expect.objectContaining({ unique: true }),
    ]);
    expect(MembershipPaymentSchema.indexes()).toContainEqual([
      { 'provider.name': 1, 'provider.paymentId': 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: { 'provider.paymentId': { $type: 'string', $gt: '' } },
      }),
    ]);
  });
  it('validates a full cuota and starts it OPEN', async () => {
    const row = new Due(due());
    await expect(row.validate()).resolves.toBeUndefined();
    expect(row.status).toBe('OPEN');
  });
  it.each([
    { amount: 1.2 },
    { amount: 0 },
    { period: '2026-13' },
    { currency: 'USD' },
    { pricingMode: 'discount' },
  ])('rejects invalid quota fields %j', async (changes) => {
    await expect(new Due({ ...due(), ...changes }).validate()).rejects.toThrow();
  });
  it('validates a complete payment without provider ID before checkout', async () => {
    await expect(new Payment(payment()).validate()).resolves.toBeUndefined();
  });
  it('requires settlement evidence for paid dues and forbids it on open dues', async () => {
    await expect(new Due({ ...due(), status: 'PAID' }).validate()).rejects.toThrow();
    await expect(
      new Due({ ...due(), status: 'OPEN', paidAt: new Date() }).validate(),
    ).rejects.toThrow();
    await expect(
      new Due({ ...due(), status: 'PAID', paidAt: new Date(), settlementPaymentId: id }).validate(),
    ).resolves.toBeUndefined();
  });
  it('requires verified evidence before confirming an electronic payment', async () => {
    await expect(
      new Payment({
        ...payment(),
        status: 'CONFIRMED',
        paidAt: new Date(),
        confirmedAt: new Date(),
      }).validate(),
    ).rejects.toThrow();
    await expect(
      new Payment({
        ...payment(),
        status: 'CONFIRMED',
        paidAt: new Date(),
        confirmedAt: new Date(),
        provider: { name: 'MERCADO_PAGO', paymentId: '123', verifiedAt: new Date() },
      }).validate(),
    ).resolves.toBeUndefined();
  });
  it('requires bank reference and responsible admin for manual confirmation', async () => {
    const data = {
      ...payment(),
      method: 'BANK_TRANSFER',
      status: 'CONFIRMED',
      paidAt: new Date(),
      confirmedAt: new Date(),
    };
    await expect(new Payment(data).validate()).rejects.toThrow();
    await expect(
      new Payment({
        ...data,
        registeredBy: id,
        bank: { reference: 'bank-123', receivedAt: new Date() },
      }).validate(),
    ).resolves.toBeUndefined();
  });
  it('requires traceable evidence for reversal instead of erasing a payment', async () => {
    await expect(new Payment({ ...payment(), status: 'REVERSED' }).validate()).rejects.toThrow();
    await expect(
      new Payment({
        ...payment(),
        status: 'REVERSED',
        reversal: { actorId: id, reason: 'Correccion de prueba', reversedAt: new Date() },
      }).validate(),
    ).resolves.toBeUndefined();
  });
  it('rejects partial totals, duplicate allocations and empty payments', async () => {
    const data = payment();
    await expect(new Payment({ ...data, amount: 100 }).validate()).rejects.toThrow();
    await expect(
      new Payment({
        ...data,
        amount: 36000,
        allocations: [data.allocations[0], data.allocations[0]],
      }).validate(),
    ).rejects.toThrow();
    await expect(new Payment({ ...data, allocations: [] }).validate()).rejects.toThrow();
  });
  it('validates proposed config without enrolling anyone or enabling blocking', async () => {
    const row = new Config(proposedBillingConfiguration());
    await expect(row.validate()).resolves.toBeUndefined();
    expect(row.autoBlockEnabled).toBe(false);
  });
  it('requires migration review before enabling automatic blocking', async () => {
    await expect(
      new Config({ ...proposedBillingConfiguration(), autoBlockEnabled: true }).validate(),
    ).rejects.toThrow();
    await expect(
      new Config({
        ...proposedBillingConfiguration(),
        autoBlockEnabled: true,
        activation: { migrationReviewed: true },
      }).validate(),
    ).resolves.toBeUndefined();
  });
  it('validates server selection DTO and rejects client amounts with strict validation', async () => {
    expect(
      await validate(Object.assign(new SelectMembershipDuesDto(), { dueIds: [String(id)] }), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).toHaveLength(0);
    expect(
      await validate(
        Object.assign(new SelectMembershipDuesDto(), { dueIds: [String(id)], amount: 1 }),
        { whitelist: true, forbidNonWhitelisted: true },
      ),
    ).not.toHaveLength(0);
    expect(
      await validate(
        Object.assign(new SelectMembershipDuesDto(), { dueIds: [String(id), String(id)] }),
      ),
    ).not.toHaveLength(0);
  });
});
