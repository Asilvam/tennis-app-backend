import { CourtReserveService } from './court-reserve.service';

describe('CourtReserveService availability pricing', () => {
  function createService() {
    const query = {
      select: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    const courtReserveModel = {
      find: jest.fn().mockReturnValue(query),
    };

    return new CourtReserveService(
      courtReserveModel as any,
      {} as any,
      {} as any,
      {} as any,
    );
  }

  it('keeps 18:15 free and charges only the later night slots', async () => {
    const availability = await createService().getAllCourtAvailable('2026-09-10');

    const slotAt = (time: string) =>
      availability.find((slot) => slot.time === time)?.slots;

    expect(slotAt('18:15-20:00')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ court: 'Cancha 1', isPayed: false }),
        expect.objectContaining({ court: 'Cancha 2', isPayed: false }),
        expect.objectContaining({ court: 'Cancha 3', isPayed: false }),
      ]),
    );
    expect(slotAt('20:15-22:00')?.every((slot) => slot.isPayed)).toBe(true);
    expect(slotAt('22:15-00:00')?.every((slot) => slot.isPayed)).toBe(true);
  });
});
