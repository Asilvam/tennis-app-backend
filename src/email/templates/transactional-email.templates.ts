import { buildEmailShell, escapeHtml } from './email-layout.template';

const paragraph = (content: string) => `<p style="margin:8px 0 0; color:#cbd5e1; font-size:15px; line-height:1.65;">${content}</p>`;

export const buildPasswordResetEmail = (newPassword: string) =>
  buildEmailShell({
    title: 'Contraseña restablecida',
    eyebrow: 'Seguridad de cuenta',
    accent: '#f4e85a',
    content: `
      <p style="margin:0; color:#e2e8f0; font-size:16px; line-height:1.6;">¡Hola!</p>
      ${paragraph('Se solicitó un restablecimiento de contraseña para tu cuenta.')}
      <div style="margin:20px 0; padding:18px; background:#102441; border:1px solid #52647d; border-radius:14px; text-align:center;">
        <div style="color:#94a3b8; font-size:10px; font-weight:800; letter-spacing:1px; text-transform:uppercase;">Nueva contraseña</div>
        <div style="margin-top:9px; color:#f4e85a; font-size:20px; font-weight:800; letter-spacing:2px; word-break:break-all;">${escapeHtml(newPassword)}</div>
      </div>
      ${paragraph('Por seguridad, inicia sesión y cambia esta contraseña. Si no solicitaste el restablecimiento, comunícate con la administración.')}`,
  });

export const buildVerificationEmail = (verificationLink: string) => {
  const safeLink = escapeHtml(verificationLink);

  return buildEmailShell({
    title: 'Verifica tu correo',
    eyebrow: 'Activación de cuenta',
    accent: '#f4e85a',
    content: `
      <p style="margin:0; color:#e2e8f0; font-size:16px; line-height:1.6;">¡Hola!</p>
      ${paragraph('Gracias por registrarte. Confirma tu dirección de correo para activar tu cuenta.')}
      <div style="margin:26px 0; text-align:center;">
        <a href="${safeLink}" style="display:inline-block; padding:14px 24px; background:#f4e85a; border:1px solid #f4e85a; border-radius:12px; color:#08172c; font-size:15px; font-weight:800; text-decoration:none;">Verificar mi correo</a>
      </div>
      ${paragraph('Si el botón no funciona, copia y pega este enlace en tu navegador:')}
      <div style="margin-top:10px; padding:12px 14px; background:#102441; border:1px solid #263a55; border-radius:10px; color:#7dd3fc; font-size:12px; line-height:1.5; word-break:break-all;">${safeLink}</div>`,
  });
};

export const buildPaymentStatusEmail = ({ playerName, approved }: { playerName?: string; approved: boolean }) =>
  buildEmailShell({
    title: approved ? 'Pago confirmado' : 'Pago rechazado',
    eyebrow: approved ? 'Reserva aprobada' : 'Reserva anulada',
    accent: approved ? '#86efac' : '#f87171',
    content: `
      <p style="margin:0; color:#e2e8f0; font-size:16px; line-height:1.6;">¡Hola${playerName ? `, ${escapeHtml(playerName)}` : ''}!</p>
      <div
        style="margin:18px 0; padding:15px 16px; background:${approved ? '#173629' : '#3b1820'}; border:1px solid ${approved ? '#286044' : '#71303b'};
          border-radius:12px; color:${approved ? '#bbf7d0' : '#fecaca'}; font-size:14px; line-height:1.6;">
        <strong style="color:${approved ? '#86efac' : '#fca5a5'};">${approved ? 'Tu pago fue confirmado.' : 'Tu pago no fue aprobado.'}</strong>
        ${approved ? ' La reserva quedó definitivamente aprobada.' : ' La reserva fue anulada automáticamente y la cancha volvió a quedar disponible.'}
      </div>
      ${approved ? paragraph('¡Nos vemos en la cancha! 🎾') : paragraph('Puedes realizar una nueva reserva con otro medio de pago o comunicarte con la administración del club.')}`,
  });

export const buildRankingPointsEmail = ({ playerName, isWinner, opponentName, score, oldPoints, newPoints }: { playerName: string; isWinner: boolean; opponentName: string; score: string; oldPoints: number; newPoints: number }) => {
  const pointChange = newPoints - oldPoints;
  const changeLabel = `${pointChange >= 0 ? '+' : ''}${pointChange}`;
  const accent = isWinner ? '#86efac' : '#7dd3fc';

  return buildEmailShell({
    title: 'Puntaje actualizado',
    eyebrow: isWinner ? 'Victoria registrada' : 'Resultado registrado',
    accent,
    content: `
      <p style="margin:0; color:#e2e8f0; font-size:16px; line-height:1.6;">¡Hola, ${escapeHtml(playerName)}!</p>
      ${paragraph('Actualizamos tu puntaje después del último partido de ranking.')}
      <div style="margin:18px 0; padding:18px; background:#102441; border:1px solid #263a55; border-radius:14px;">
        <div style="color:#94a3b8; font-size:10px; font-weight:800; letter-spacing:1px; text-transform:uppercase;">Resultado</div>
        <div style="margin-top:8px; color:${accent}; font-size:18px; font-weight:800;">${isWinner ? 'Victoria' : 'Derrota'}</div>
        <div style="margin-top:14px; color:#cbd5e1; font-size:14px; line-height:1.7;"><strong style="color:#f8fafc;">Rival:</strong> ${escapeHtml(opponentName)}<br><strong style="color:#f8fafc;">Marcador:</strong> ${escapeHtml(score)}</div>
      </div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; margin:18px 0;">
        <tr>
          <td align="center" style="padding:16px 8px; background:#08172c; border:1px solid #263a55; border-radius:12px;">
            <div style="color:#94a3b8; font-size:12px;">Puntaje anterior: ${oldPoints}</div>
            <div style="margin-top:8px; color:${accent}; font-size:21px; font-weight:800;">${changeLabel} puntos</div>
            <div style="margin-top:8px; color:#f4e85a; font-size:18px; font-weight:800;">Nuevo puntaje: ${newPoints}</div>
          </td>
        </tr>
      </table>
      ${paragraph('¡Sigue jugando y mejorando tu ranking!')}`,
  });
};
