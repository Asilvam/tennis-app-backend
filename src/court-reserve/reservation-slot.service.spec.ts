import { ConflictException, ForbiddenException } from '@nestjs/common';
import axios from 'axios';
import { ReservationSlotService } from './reservation-slot.service';
import { ReservationSlot, ReservationSlotSchema } from './entities/reservation-slot.entity';

jest.mock('axios');

// Models the database's unique _id and compare-and-set operations; no user DB is used.
function matches(record: any, filter: any): boolean {
  return Object.entries(filter).every(([key, value]: [string, any]) => {
    if (key === '$or') return value.some((part: any) => matches(record, part));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('$in' in value) return value.$in.includes(record[key]);
      if ('$lte' in value) return record[key] <= value.$lte;
      if ('$gt' in value) return record[key] > value.$gt;
      if ('$ne' in value) return record[key] !== value.$ne;
      if ('$exists' in value) return (record[key] !== undefined) === value.$exists;
    }
    return record[key] === value;
  });
}

function query<T>(read: () => T) {
  const result = { select: () => result, lean: () => result, limit: () => result, exec: async () => read() };
  return result;
}

function fixture() {
  const rows = new Map<string, ReservationSlot>();
  const reservations: any[] = [];
  const slots = {
    create: jest.fn(async (row: ReservationSlot) => {
      if (rows.has(row._id)) throw { code: 11000 };
      rows.set(row._id, { ...row });
      return { ...row };
    }),
    findOne: jest.fn((filter) => query(() => [...rows.values()].find(row => matches(row, filter)) || null)),
    find: jest.fn((filter) => query(() => [...rows.values()].filter(row => matches(row, filter)))),
    findOneAndUpdate: jest.fn((filter, update) => query(() => {
      const row = [...rows.values()].find(value => matches(value, filter));
      if (!row) return null;
      Object.assign(row, update.$set);
      for (const key of Object.keys(update.$unset || {})) delete row[key];
      return { ...row };
    })),
    updateOne: jest.fn((filter, update) => query(() => {
      const row = [...rows.values()].find(value => matches(value, filter));
      if (row) Object.assign(row, update.$set);
      return { modifiedCount: row ? 1 : 0 };
    })),
  };
  const reserves = {
    findOne: jest.fn(filter => query(() => reservations.find(row => matches(row, filter)) || null)),
    updateOne: jest.fn(() => query(() => ({ modifiedCount: 1 }))),
  };
  const config = { get: (key: string) => ({ MP_API_URL: 'https://mp.test/mercadopago', INTERNAL_API_KEY: 'test-key' })[key] };
  const service = new ReservationSlotService(slots as any, reserves as any, config as any);
  return { service, rows, slots, reserves, reservations };
}

const reserve = { idCourtReserve: 'r-1', court: 'Cancha 1', dateToPlay: '2030-10-12', turn: '20:15-22:00' };

describe('Reservation slot holds', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses a string _id as the unique slot key and preserves expired records', () => {
    expect(ReservationSlotSchema.path('_id').instance).toBe('String');
    expect(ReservationSlotSchema.indexes().some(([, options]) => options.expireAfterSeconds !== undefined)).toBe(false);
  });

  it('grants only one hold when two users compete for the same slot', async () => {
    const { service, rows } = fixture();
    const results = await Promise.allSettled([
      service.acquire(reserve, 'one@test.cl'),
      service.acquire({ ...reserve, idCourtReserve: 'r-2' }, 'two@test.cl'),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(rows.size).toBe(1);
    expect(service.holdDurationMs).toBe(120_000);
    expect([...rows.values()][0].expiresAt.getTime() - Date.now()).toBeGreaterThan(119_000);
    expect([...rows.values()][0].expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(120_000);
  });

  it('expires an unstarted hold at two minutes, not before, without resetting its deadline', async () => {
    jest.useFakeTimers();
    try {
      const { service, rows } = fixture();
      const startedAt = Date.now();
      const held = await service.acquire(reserve);
      expect(held.expiresAt.getTime()).toBe(startedAt + 120_000);
      jest.advanceTimersByTime(119_999);
      await service.expireDue();
      expect([...rows.values()][0].status).toBe('HELD');
      jest.advanceTimersByTime(1);
      await service.expireDue();
      expect([...rows.values()][0].status).toBe('EXPIRED');
      expect([...rows.values()][0].expiresAt.getTime()).toBe(startedAt + 120_000);
      expect(rows.size).toBe(1);
      expect(axios.post).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects a hold over an existing legacy reservation', async () => {
    const { service, reservations } = fixture();
    reservations.push({ ...reserve, idCourtReserve: 'legacy', state: true });
    await expect(service.acquire(reserve)).rejects.toBeInstanceOf(ConflictException);
  });

  it('releases immediately on cancellation and allows another user to acquire', async () => {
    const { service } = fixture();
    await service.acquire(reserve, 'owner@test.cl');
    await expect(service.cancel('r-1', 'owner@test.cl')).resolves.toEqual({ released: true });
    await expect(service.acquire({ ...reserve, idCourtReserve: 'r-2' })).resolves.toMatchObject({ reservationId: 'r-2' });
  });

  it('does not allow another user to cancel or edit the hold', async () => {
    const { service } = fixture();
    await service.acquire(reserve, 'owner@test.cl');
    await expect(service.cancel('r-1', 'other@test.cl')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.assertEditable('r-1', 'other@test.cl')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not reset the deadline on checkout or repeated checkout requests', async () => {
    const { service } = fixture();
    const hold = await service.acquire(reserve, 'owner@test.cl');
    await service.beginCheckout(reserve, 'owner@test.cl');
    await service.storeCheckout('r-1', { preferenceId: 'p-1', initPoint: 'https://mp.test/p-1' });
    const repeat = await service.beginCheckout(reserve, 'owner@test.cl');
    expect(repeat.expiresAt).toEqual(hold.expiresAt);
    expect(repeat.preferenceId).toBe('p-1');
  });

  it('does not directly cancel an in-flight checkout', async () => {
    const { service } = fixture();
    await service.acquire(reserve, 'owner@test.cl');
    await service.beginCheckout(reserve, 'owner@test.cl');
    await expect(service.cancel('r-1', 'owner@test.cl')).resolves.toEqual({ released: false, status: 'CHECKOUT' });
  });

  it('expires an abandoned hold while preserving history', async () => {
    const { service, rows, reserves } = fixture();
    await service.acquire(reserve);
    [...rows.values()][0].expiresAt = new Date(Date.now() - 1);
    await service.expireDue();
    expect([...rows.values()][0].status).toBe('EXPIRED');
    expect(reserves.updateOne).toHaveBeenCalled();
    expect(rows.size).toBe(1);
  });

  it.each(['processing', 'approved'])('does not release a checkout reported as %s', async (status) => {
    const { service, rows } = fixture();
    await service.acquire(reserve);
    await service.beginCheckout(reserve);
    Object.assign([...rows.values()][0], { expiresAt: new Date(Date.now() - 1), nextReconcileAt: new Date(Date.now() - 1) });
    (axios.post as jest.Mock).mockResolvedValue({ data: { status } });
    await service.expireDue();
    expect([...rows.values()][0].status).toBe('CHECKOUT');
  });

  it('keeps the slot blocked if Mercado Pago is unavailable', async () => {
    const { service, rows } = fixture();
    await service.acquire(reserve);
    await service.beginCheckout(reserve);
    Object.assign([...rows.values()][0], { expiresAt: new Date(Date.now() - 1), nextReconcileAt: new Date(Date.now() - 1) });
    (axios.post as jest.Mock).mockRejectedValue(new Error('Network failure'));
    await service.expireDue();
    expect([...rows.values()][0].status).toBe('CHECKOUT');
  });

  it('releases a checkout only after reconciliation verifies no payment', async () => {
    const { service, rows } = fixture();
    await service.acquire(reserve);
    await service.beginCheckout(reserve);
    Object.assign([...rows.values()][0], { expiresAt: new Date(Date.now() - 1), nextReconcileAt: new Date(Date.now() - 1) });
    (axios.post as jest.Mock).mockResolvedValue({ data: { status: 'unpaid' } });
    await service.expireDue();
    expect([...rows.values()][0].status).toBe('EXPIRED');
  });

  it('does not let a late payment take a slot already held by another user', async () => {
    const { service } = fixture();
    await service.acquire(reserve, 'owner@test.cl');
    await service.cancel('r-1', 'owner@test.cl');
    await service.acquire({ ...reserve, idCourtReserve: 'r-2' }, 'other@test.cl');
    await expect(service.confirm(reserve)).resolves.toBe(false);
  });

  it('allows a late payment only if the slot is still free', async () => {
    const { service, rows } = fixture();
    await service.acquire(reserve, 'owner@test.cl');
    await service.cancel('r-1', 'owner@test.cl');
    await expect(service.confirm(reserve)).resolves.toBe(true);
    expect([...rows.values()][0].status).toBe('CONFIRMED');
  });

  it('does not let an admin replace a pending payment', async () => {
    const { service } = fixture();
    await service.acquire(reserve);
    await expect(service.acquire({ ...reserve, idCourtReserve: 'admin' }, undefined, true)).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not let an expiration race release a payment already confirmed', async () => {
    const { service, rows } = fixture();
    await service.acquire(reserve);
    await service.beginCheckout(reserve);
    Object.assign([...rows.values()][0], { expiresAt: new Date(Date.now() - 1), nextReconcileAt: new Date(Date.now() - 1) });
    (axios.post as jest.Mock).mockImplementation(async () => {
      await service.confirm(reserve);
      return { data: { status: 'unpaid' } };
    });
    await service.expireDue();
    expect([...rows.values()][0].status).toBe('CONFIRMED');
  });

  it('does not activate an approval for a turn which already ended', async () => {
    const { service, rows } = fixture();
    const past = { ...reserve, dateToPlay: '2020-01-01' };
    await service.acquire(past);
    await service.beginCheckout(past);
    await expect(service.confirm(past)).resolves.toBe(false);
    expect([...rows.values()][0].status).toBe('REVIEW');
  });
});
