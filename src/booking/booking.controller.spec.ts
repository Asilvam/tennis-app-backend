import { BookingController } from './booking.controller';

describe('BookingController', () => {
  it('forwards the authenticated account to the service', async () => {
    const bookingService = { createMultiple: jest.fn().mockResolvedValue([]) };
    const controller = new BookingController(bookingService as any);
    const dto = { courts: [], dates: [], turns: [], motive: 'Clases' };
    const request = { user: { email: 'profe@example.com', role: 'profesor' } };

    await expect(controller.createMultiple(dto, request as any)).resolves.toEqual([]);
    expect(bookingService.createMultiple).toHaveBeenCalledWith(dto, request.user);
  });
});
