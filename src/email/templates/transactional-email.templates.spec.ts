import {
  buildPasswordResetEmail,
  buildPaymentStatusEmail,
  buildRankingPointsEmail,
  buildVerificationEmail,
} from './transactional-email.templates';

describe('transactional email templates', () => {
  it('escapes password and verification link values', () => {
    expect(buildPasswordResetEmail('<secret>')).toContain('&lt;secret&gt;');
    expect(buildVerificationEmail('https://example.com?a=1&b=2')).toContain('a=1&amp;b=2');
  });

  it('builds an approved payment message with a player name', () => {
    const html = buildPaymentStatusEmail({ playerName: '<Player>', approved: true });
    expect(html).toContain('Pago confirmado');
    expect(html).toContain('&lt;Player&gt;');
    expect(html).toContain('reserva quedó definitivamente aprobada');
  });

  it('builds a rejected payment message without a player name', () => {
    const html = buildPaymentStatusEmail({ approved: false });
    expect(html).toContain('Pago rechazado');
    expect(html).toContain('reserva fue anulada automáticamente');
    expect(html).toContain('¡Hola!');
  });

  it('builds a winner ranking update with a positive change', () => {
    const html = buildRankingPointsEmail({
      playerName: '<Winner>',
      isWinner: true,
      opponentName: 'Opponent & Co',
      score: '6-1 < 6-2',
      oldPoints: 100,
      newPoints: 112,
    });
    expect(html).toContain('Victoria registrada');
    expect(html).toContain('+12 puntos');
    expect(html).toContain('&lt;Winner&gt;');
    expect(html).toContain('Opponent &amp; Co');
  });

  it('builds a loser ranking update with a negative change', () => {
    const html = buildRankingPointsEmail({
      playerName: 'Player',
      isWinner: false,
      opponentName: 'Opponent',
      score: '3-6',
      oldPoints: 100,
      newPoints: 95,
    });
    expect(html).toContain('Resultado registrado');
    expect(html).toContain('Derrota');
    expect(html).toContain('-5 puntos');
  });
});
