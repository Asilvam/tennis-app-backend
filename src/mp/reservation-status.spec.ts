import { NotFoundException } from '@nestjs/common';
import { MpService } from './mp.service';

describe('Reservation payment return: authoritative read', () => {
  const owner = 'owner@example.invalid';
  const id = 'abc123';
  const confirmed = {
    idCourtReserve: id,
    wasPaid: true,
    paymentStatus: 'approved',
    state: true,
    reservationStatus: 'CONFIRMED',
  };
  const fixture = (reserve: any) => {
    const query = {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(reserve),
    };
    const model = { findOne: jest.fn().mockReturnValue(query) };
    const service = new MpService({} as any, model as any, {} as any);
    return { service, model, query };
  };

  it('filters by signed owner, normalizes email and returns no participant/payment secrets', async () => {
    const { service, model } = fixture({ ...confirmed, ownerEmail: owner, passCourtReserve: 'secret' });
    await expect(service.reservationStatus(id, ' OWNER@example.invalid ')).resolves.toEqual({
      reservationId: id,
      status: 'CONFIRMED',
    });
    expect(model.findOne).toHaveBeenCalledWith({ idCourtReserve: id, ownerEmail: owner });
  });
  it.each([
    { wasPaid: false },
    { paymentStatus: 'pending' },
    { paymentStatus: undefined },
    {
      state: false,
      reservationStatus: 'PAYMENT_REVIEW_REQUIRED',
    },
    { state: false, reservationStatus: 'CANCELLED' },
    { reservationStatus: undefined },
  ])('never confirms incomplete/conflicting persisted evidence: %j', async (override) => {
    const { service } = fixture({ ...confirmed, ...override });
    const result = await service.reservationStatus(id, owner);
    expect(result.status).not.toBe('CONFIRMED');
    expect(result.status).toBe(override.wasPaid === false || 'paymentStatus' in override ? 'WAITING' : 'REVIEW');
  });
  it.each(['PENDING_PAYMENT', 'EXPIRED', 'CANCELLED'])('does not infer rejection: %s', async (reservationStatus) => {
    const { service } = fixture({ idCourtReserve: id, wasPaid: false, reservationStatus });
    await expect(service.reservationStatus(id, owner)).resolves.toEqual({ reservationId: id, status: 'WAITING' });
  });
  it('does not reveal whether an inaccessible ID exists', async () => {
    const { service } = fixture(null);
    await expect(service.reservationStatus(id, owner)).rejects.toBeInstanceOf(NotFoundException);
  });
  it.each(['', '../admin', '$ne', 'x'.repeat(81)])('rejects malformed IDs before Mongo: %s', async (invalid) => {
    const { service, model } = fixture(confirmed);
    await expect(service.reservationStatus(invalid, owner)).rejects.toBeInstanceOf(NotFoundException);
    expect(model.findOne).not.toHaveBeenCalled();
  });
  it('propagates database failure rather than inventing success', async () => {
    const { service, query } = fixture(confirmed);
    query.exec.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.reservationStatus(id, owner)).rejects.toThrow('database unavailable');
  });
});
