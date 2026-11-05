import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { DateTime, Settings } from 'luxon';
import { CourtReserveController } from './court-reserve.controller';
import { CourtReserveService } from './court-reserve.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

describe('Reservation cancellation authorization', () => {
  const clock = Settings.now;
  beforeEach(() => {
    const fixed = DateTime.fromISO('2030-11-05T10:00:00-03:00').toMillis();
    Settings.now = () => fixed;
  });
  afterEach(() => {
    Settings.now = clock;
  });

  function fixture(overrides: Record<string, unknown> = {}) {
    const reserve = {
      idCourtReserve: 'reserve-owned',
      court: 'Cancha 1',
      dateToPlay: '2030-11-05',
      turn: '10:15-12:00',
      state: true,
      ownerEmail: 'owner@example.invalid',
      player1: 'Different Player',
      player2: 'Owner Name',
      isBlockedByAdmin: false,
      ...overrides,
    };
    const model: any = {
      findOne: jest
        .fn()
        .mockReturnValue({ select: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(reserve) }),
      findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ ...reserve, state: false }) }),
    };
    const register = {
      findOneByEmail: jest.fn().mockResolvedValue({
        email: 'owner@example.invalid',
        namePlayer: 'Owner Name',
        role: 'user',
        statePlayer: true,
        updatePayment: false,
      }),
    };
    const audit = { logReserveCancellation: jest.fn().mockResolvedValue(undefined) };
    const slots = { releaseConfirmed: jest.fn().mockResolvedValue(undefined) };
    const service = new CourtReserveService(model, register as any, {} as any, audit as any, {} as any, slots as any);
    const mail = jest.spyOn(service, 'sendEmailRemove').mockResolvedValue(undefined);
    const effects = () => {
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
      expect(slots.releaseConfirmed).not.toHaveBeenCalled();
      expect(audit.logReserveCancellation).not.toHaveBeenCalled();
      expect(mail).not.toHaveBeenCalled();
    };
    return { service, model, register, reserve, audit, slots, mail, effects };
  }

  it('requires JWT on cancellation and normal creation and forwards identity from the request only', async () => {
    for (const name of ['remove', 'create']) {
      expect(Reflect.getMetadata(GUARDS_METADATA, CourtReserveController.prototype[name])).toContain(JwtAuthGuard);
    }
    const service: any = { remove: jest.fn(), createAuthenticated: jest.fn() };
    const controller = new CourtReserveController(service);
    controller.remove('reserve-owned', { user: { email: 'session@example.invalid' } });
    controller.create(
      { court: 'Cancha 1', turn: '10:15-12:00', dateToPlay: '2030-11-05', ownerEmail: 'forged' } as any,
      { user: { email: 'session@example.invalid' } },
    );
    expect(service.remove).toHaveBeenCalledWith('reserve-owned', 'session@example.invalid');
    expect(service.createAuthenticated).toHaveBeenCalledWith(expect.any(Object), 'session@example.invalid');
  });

  it.each([undefined, '', '  '])(
    'rejects missing session identity before reading or mutating a reserve: %s',
    async (email) => {
      const f = fixture();
      await expect(f.service.remove('reserve-owned', email)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(f.model.findOne).not.toHaveBeenCalled();
      f.effects();
    },
  );

  it.each([null, { role: 'admin', statePlayer: false, email: 'owner@example.invalid' }])(
    'rejects missing or inactive accounts despite their token role',
    async (actor) => {
      const f = fixture();
      f.register.findOneByEmail.mockResolvedValue(actor as any);
      await expect(f.service.remove('reserve-owned', 'owner@example.invalid')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      f.effects();
    },
  );

  it('permits the persisted creator before the turn, even when not Player 1 or restricted financially', async () => {
    const f = fixture();
    await expect(f.service.remove('reserve-owned', ' OWNER@example.invalid ')).resolves.toMatchObject({ state: false });
    expect(f.register.findOneByEmail).toHaveBeenCalledWith('owner@example.invalid');
    expect(f.model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ state: true, ownerEmail: 'owner@example.invalid', turn: '10:15-12:00' }),
      { state: false },
      { new: true },
    );
    expect(f.audit.logReserveCancellation).toHaveBeenCalledWith(
      'reserve-owned',
      f.reserve,
      'USER',
      'Owner Name',
      undefined,
    );
    expect(f.mail).toHaveBeenCalledTimes(1);
    expect(f.slots.releaseConfirmed).toHaveBeenCalledWith('reserve-owned');
  });

  it.each([undefined, '', 'another@example.invalid'])('does not treat Player 1 as creator: %s', async (ownerEmail) => {
    const f = fixture({ ownerEmail, player1: 'Owner Name' });
    await expect(f.service.remove('reserve-owned', 'owner@example.invalid')).rejects.toBeInstanceOf(ForbiddenException);
    f.effects();
  });

  it.each(['09:15-10:00', '10:00-12:00'])('rejects at or after the start of the turn: %s', async (turn) => {
    const f = fixture({ turn });
    await expect(f.service.remove('reserve-owned', 'owner@example.invalid')).rejects.toBeInstanceOf(ForbiddenException);
    f.effects();
  });

  it('permits a future day and handles the late turn using the Chilean date', async () => {
    const f = fixture({ dateToPlay: '2030-11-06', turn: '22:15-00:00' });
    await expect(f.service.remove('reserve-owned', 'owner@example.invalid')).resolves.toMatchObject({ state: false });
  });

  it('rejects an invalid stored date rather than bypassing the deadline', async () => {
    const f = fixture({ dateToPlay: 'not-a-date' });
    await expect(f.service.remove('reserve-owned', 'owner@example.invalid')).rejects.toBeInstanceOf(ForbiddenException);
    f.effects();
  });

  it.each([undefined, 'someone@example.invalid'])(
    'allows an active stored administrator regardless of creator or time',
    async (ownerEmail) => {
      const f = fixture({ ownerEmail, dateToPlay: '2020-01-01' });
      f.register.findOneByEmail.mockResolvedValue({
        email: 'admin@example.invalid',
        namePlayer: 'Administrator',
        role: 'admin',
        statePlayer: true,
      } as any);
      await expect(f.service.remove('reserve-owned', 'admin@example.invalid')).resolves.toMatchObject({ state: false });
      expect(f.audit.logReserveCancellation).toHaveBeenCalledWith(
        'reserve-owned',
        f.reserve,
        'ADMIN',
        'Administrator',
        undefined,
      );
      expect(f.model.findOneAndUpdate.mock.calls[0][0]).toEqual({ idCourtReserve: 'reserve-owned', state: true });
    },
  );

  it('returns 404 for an unknown reservation without side effects', async () => {
    const f = fixture();
    f.model.findOne.mockReturnValue({ select: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(null) });
    await expect(f.service.remove('unknown', 'owner@example.invalid')).rejects.toBeInstanceOf(NotFoundException);
    f.effects();
  });

  it('does not repeat effects when another request already cancelled or modified the reservation', async () => {
    const f = fixture();
    f.model.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(f.service.remove('reserve-owned', 'owner@example.invalid')).rejects.toBeInstanceOf(ConflictException);
    expect(f.audit.logReserveCancellation).not.toHaveBeenCalled();
    expect(f.mail).not.toHaveBeenCalled();
    expect(f.slots.releaseConfirmed).not.toHaveBeenCalled();
  });

  it('keeps administrative blocks silent and uses the actual actor for audit', async () => {
    const f = fixture({ isBlockedByAdmin: true, ownerEmail: undefined });
    f.register.findOneByEmail.mockResolvedValue({
      email: 'admin@example.invalid',
      namePlayer: 'Administrator',
      role: 'admin',
      statePlayer: true,
    } as any);
    await f.service.remove('reserve-owned', 'admin@example.invalid');
    expect(f.mail).not.toHaveBeenCalled();
    expect(f.audit.logReserveCancellation.mock.calls[0][2]).toBe('ADMIN');
  });

  it('persists authenticated ownership separately from untrusted body fields', async () => {
    const f = fixture();
    const create = jest.spyOn(f.service, 'create').mockResolvedValue({} as any);
    const dto = {
      court: 'Cancha 1',
      dateToPlay: '2030-11-06',
      turn: '08:15-10:00',
      ownerEmail: 'forged@example.invalid',
    } as any;
    await f.service.createAuthenticated(dto, 'OWNER@example.invalid');
    expect(create).toHaveBeenCalledWith(dto, { ownerEmail: 'owner@example.invalid' });
  });
});
