import {
  buildPasswordResetEmail,
  buildPasswordChangedEmail,
  buildPaymentStatusEmail,
  buildRankingPointsEmail,
  buildVerificationEmail,
} from './transactional-email.templates';

describe('transactional email templates', () => {
  it('escapes reset and verification link values and explains expiry', () => {
    const reset = buildPasswordResetEmail('https://front.example/reset#token=abc&test=<value>');
    expect(reset).toContain('token=abc&amp;test=&lt;value&gt;');
    expect(reset).toContain('vence en 24 horas');
    expect(reset).toContain('una sola vez');
    expect(buildVerificationEmail('https://example.com?a=1&b=2')).toContain('a=1&amp;b=2');
  });

  it('notifies a password change without a recovery link or generated password', () => {
    const message = buildPasswordChangedEmail();
    expect(message).toContain('Contraseña actualizada');
    expect(message).not.toContain('token=');
    expect(message).not.toContain('Nueva contraseña</div>');
  });

  it('describes public and admin links as 24-hour one-use links', () => {
    const admin = buildPasswordResetEmail('https://front.example/reset#token=fixture', '24 horas');
    expect(admin).toContain('vence en 24 horas');
    expect(admin).toContain('una sola vez');
    expect(admin).not.toContain('vence en 15 minutos');
    expect(buildPasswordResetEmail('https://front.example/reset')).toContain('vence en 24 horas');
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
