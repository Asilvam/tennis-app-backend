import { BadRequestException, ConflictException } from '@nestjs/common';
import { CourtReserveService } from './court-reserve.service';

describe('Reservation hold integration', () => {
  function fixture() {
    let saved: any;
    const model: any = jest.fn().mockImplementation(values => {
      const document = {
        ...values, idCourtReserve: 'hold-1', state: false,
        save: jest.fn(async () => document),
        toObject: () => ({ ...document }),
      };
      saved = document;
      return document;
    });
    model.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(null) });
    model.findOneAndUpdate = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });
    const register = {
      findOneByEmail: jest.fn().mockResolvedValue({ namePlayer: 'Authenticated Player' }),
      findOneEmail: jest.fn().mockResolvedValue({ email: 'owner@test.cl' }),
    };
    const email = { sendEmail: jest.fn() };
    const audit = { logReserveCreation: jest.fn().mockResolvedValue(undefined) };
    const slots = {
      acquire: jest.fn().mockResolvedValue({ expiresAt: new Date(Date.now() + 120_000) }),
      assertEditable: jest.fn().mockResolvedValue({ expiresAt: new Date(Date.now() + 120_000) }),
      releaseUnstarted: jest.fn(),
    };
    const service = new CourtReserveService(model, register as any, email as any, audit as any, {} as any, slots as any);
    jest.spyOn(service, 'validateDateTurn').mockResolvedValue(true);
    jest.spyOn(service, 'getAllCourtReserves').mockResolvedValue([]);
    return { service, model, register, email, slots, saved: () => saved };
  }

  const dto = { court: 'Cancha 1', dateToPlay: '2030-10-12', turn: '20:15-22:00' };

  it('retains a night slot immediately without requiring an opponent or sending a preliminary email', async () => {
    const { service, saved, email, register } = fixture();
    const result = await service.createHold({ ...dto, player1: 'Forged', wasPaid: true, isPaidNight: false }, 'OWNER@test.cl');
    expect(register.findOneByEmail).toHaveBeenCalledWith('owner@test.cl');
    expect(result).toMatchObject({ idCourtReserve: 'hold-1', player1: 'Authenticated Player', ownerEmail: 'owner@test.cl', isPaidNight: true, wasPaid: false, checkoutReady: false, reservationStatus: 'PENDING_PAYMENT' });
    expect(saved().holdExpiresAt).toBeInstanceOf(Date);
    expect(result.serverNow).toEqual(expect.any(String));
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('retains a daytime slot only for a visit', async () => {
    const { service } = fixture();
    const day = { ...dto, turn: '18:15-20:00' };
    await expect(service.createHold(day, 'owner@test.cl')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createHold({ ...day, isVisit: true, visitName: 'Visita' }, 'owner@test.cl')).resolves.toMatchObject({ isVisit: true, isPaidNight: false });
  });

  it('uses a canonical date so an ISO timestamp cannot bypass the slot lock', async () => {
    const { service, slots } = fixture();
    await service.createHold({ ...dto, dateToPlay: '2030-10-12T15:00:00-03:00' }, 'owner@test.cl');
    expect(slots.acquire).toHaveBeenCalledWith(expect.objectContaining({ dateToPlay: '2030-10-12' }), 'owner@test.cl');
  });

  it('validates participants and prepares the existing reservation only once', async () => {
    const { service, model, slots } = fixture();
    model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ player1: 'Authenticated Player', isPaidNight: true }) });
    await service.prepareHold('hold-1', { ...dto, player1: 'Forged', player2: 'Opponent' }, 'owner@test.cl');
    expect(slots.assertEditable).toHaveBeenCalledWith('hold-1', 'owner@test.cl');
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ idCourtReserve: 'hold-1', checkoutReady: false, wasPaid: false }),
      expect.objectContaining({ $set: expect.objectContaining({ player1: 'Authenticated Player', player2: 'Opponent', checkoutReady: true }) }),
      { new: true },
    );
  });

  it('rejects missing opponents before checkout', async () => {
    const { service, model } = fixture();
    model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ player1: 'Player', isPaidNight: true }) });
    await expect(service.prepareHold('hold-1', dto, 'owner@test.cl')).rejects.toBeInstanceOf(BadRequestException);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('does not prepare a reservation which another request already prepared or cancelled', async () => {
    const { service, model } = fixture();
    model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ player1: 'Player', isPaidNight: true }) });
    model.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.prepareHold('hold-1', { ...dto, player2: 'Opponent' }, 'owner@test.cl')).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    { turn: '20:15-22:00', player2: 'Opponent' },
    { turn: '18:15-20:00', isVisit: true, visitName: 'Visitor' },
    { turn: '20:15-22:00', isVisit: true, visitName: 'Visitor' },
  ])('does not send a preliminary email for a paid booking, including the legacy create endpoint: %j', async flags => {
    const { service, email } = fixture();
    const sendReserve = jest.spyOn(service, 'sendEmailReserve').mockResolvedValue(undefined);
    await service.create({ ...dto, player1: 'Player', ...flags });
    expect(sendReserve).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('preserves confirmation emails for free reservations', async () => {
    const { service } = fixture();
    const sendReserve = jest.spyOn(service, 'sendEmailReserve').mockResolvedValue(undefined);
    await service.create({ ...dto, turn: '08:15-10:00', player1: 'Player', player2: 'Opponent' });
    expect(sendReserve).toHaveBeenCalledTimes(1);
  });
});
