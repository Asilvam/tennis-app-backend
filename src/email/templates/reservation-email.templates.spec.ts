import { buildReservationCancellationEmail, buildReservationConfirmationEmail } from './reservation-email.templates';

const reserve = (overrides: Record<string, unknown> = {}) =>
  ({
    turn: '19:00',
    player1: 'Player <One>',
    player2: 'Player Two',
    player3: 'Player Three',
    player4: 'Player Four',
    visitName: 'Visitor & Guest',
    isDouble: false,
    isPaidNight: false,
    isVisit: false,
    isForRanking: false,
    ...overrides,
  }) as any;

describe('reservation email templates', () => {
  it('builds a confirmed ranking singles reservation with maintenance instructions', () => {
    const html = buildReservationConfirmationEmail({
      reserve: reserve({ isForRanking: true }),
      formattedDate: '2 < 3',
      courtNumber: 'Court & 1',
      requiresMaintenance: true,
    });
    expect(html).toContain('Reserva confirmada');
    expect(html).toContain('Partido de ranking');
    expect(html).toContain('Cuidado de la cancha');
    expect(html).toContain('Player &lt;One&gt;');
    expect(html).toContain('Court &amp; 1');
  });

  it('builds a temporary visit reservation', () => {
    const html = buildReservationConfirmationEmail({
      reserve: reserve({ player2: '', isVisit: true }),
      formattedDate: '01-09-2026',
      courtNumber: '2',
      requiresMaintenance: false,
    });
    expect(html).toContain('Reserva recibida');
    expect(html).toContain('reserva con visita quedó registrada temporalmente');
    expect(html).toContain('Visitor &amp; Guest');
    expect(html).not.toContain('Cuidado de la cancha');
  });

  it('builds a temporary paid-night doubles reservation', () => {
    const html = buildReservationConfirmationEmail({
      reserve: reserve({ isDouble: true, isPaidNight: true }),
      formattedDate: '01-09-2026',
      courtNumber: '3',
      requiresMaintenance: false,
    });
    expect(html).toContain('turno nocturno quedó reservado temporalmente');
    expect(html).toContain('Player &lt;One&gt; / Player Two');
    expect(html).toContain('Player Three / Player Four');
  });

  it('describes a paid-night reservation with a visit', () => {
    const html = buildReservationConfirmationEmail({
      reserve: reserve({ isDouble: true, isPaidNight: true, isVisit: true, player2: '' }),
      formattedDate: '01-09-2026',
      courtNumber: '4',
      requiresMaintenance: false,
    });
    expect(html).toContain('turno nocturno con visita');
    expect(html).toContain('Player &lt;One&gt; / Visitor &amp; Guest');
  });

  it('builds a cancellation with an escaped reason', () => {
    const html = buildReservationCancellationEmail({
      reserve: reserve(),
      formattedDate: '01-09-2026',
      courtNumber: '1',
      reason: '<rain>',
    });
    expect(html).toContain('Reserva anulada');
    expect(html).toContain('Motivo:');
    expect(html).toContain('&lt;rain&gt;');
  });

  it('omits the reason section when none is supplied', () => {
    const html = buildReservationCancellationEmail({
      reserve: reserve(),
      formattedDate: '01-09-2026',
      courtNumber: '1',
    });
    expect(html).not.toContain('Motivo:');
  });
});
