import { CourtReserve } from '../../court-reserve/entities/court-reserve.entity';
import { buildEmailShell, escapeHtml } from './email-layout.template';

const buildDetails = (formattedDate: string, turn: string, courtNumber: string) => `
<table class="ctq-details" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; margin:18px 0; border-collapse:separate; border-spacing:6px;">
  <tr>
    <td class="ctq-detail-cell" width="33.33%" valign="top" style="padding:13px 8px; background:#102441; border:1px solid #263a55; border-radius:12px; text-align:center;">
      <div style="color:#94a3b8; font-size:10px; font-weight:800; letter-spacing:1px; text-transform:uppercase;">Fecha</div>
      <div style="margin-top:6px; color:#f8fafc; font-size:15px; font-weight:700;">${escapeHtml(formattedDate)}</div>
    </td>
    <td class="ctq-detail-cell" width="33.33%" valign="top" style="padding:13px 8px; background:#102441; border:1px solid #263a55; border-radius:12px; text-align:center;">
      <div style="color:#94a3b8; font-size:10px; font-weight:800; letter-spacing:1px; text-transform:uppercase;">Horario</div>
      <div style="margin-top:6px; color:#f8fafc; font-size:15px; font-weight:700; white-space:nowrap;">${escapeHtml(turn)}</div>
    </td>
    <td class="ctq-detail-cell" width="33.33%" valign="top" style="padding:13px 8px; background:#102441; border:1px solid #263a55; border-radius:12px; text-align:center;">
      <div style="color:#94a3b8; font-size:10px; font-weight:800; letter-spacing:1px; text-transform:uppercase;">Cancha</div>
      <div style="margin-top:6px; color:#f8fafc; font-size:15px; font-weight:700;">${escapeHtml(courtNumber)}</div>
    </td>
  </tr>
</table>`;

const buildMatchup = (reserve: CourtReserve) => {
  const firstTeam = reserve.isDouble ? `${reserve.player1} / ${reserve.player2 || reserve.visitName}` : reserve.player1;
  const secondTeam = reserve.isDouble ? `${reserve.player3} / ${reserve.player4}` : reserve.player2 || reserve.visitName;

  return `
  <div style="margin:18px 0; padding:18px; background:#102441; border:1px solid #263a55; border-radius:14px; text-align:center;">
    <div style="color:#94a3b8; font-size:10px; font-weight:800; letter-spacing:1px; text-transform:uppercase;">Partido</div>
    <div style="margin-top:12px; color:#7dd3fc; font-size:17px; line-height:1.35; font-weight:750;">${escapeHtml(firstTeam)}</div>
    <div style="margin:8px 0; color:#94a3b8; font-size:11px; font-weight:800; letter-spacing:1px; text-transform:uppercase;">vs</div>
    <div style="color:#f8fafc; font-size:17px; line-height:1.35; font-weight:750;">${escapeHtml(secondTeam)}</div>
  </div>`;
};

export const buildReservationConfirmationEmail = ({ reserve, formattedDate, courtNumber, requiresMaintenance }: { reserve: CourtReserve; formattedDate: string; courtNumber: string; requiresMaintenance: boolean }) => {
  const isTemporary = reserve.isPaidNight || reserve.isVisit;
  const temporaryDescription =
    reserve.isPaidNight && reserve.isVisit ? 'Tu turno nocturno con visita quedó reservado temporalmente.' : reserve.isPaidNight ? 'Tu turno nocturno quedó reservado temporalmente.' : 'Tu reserva con visita quedó registrada temporalmente.';

  const content = `
    <p style="margin:0; color:#e2e8f0; font-size:16px; line-height:1.6;">¡Hola!</p>
    <p style="margin:8px 0 0; color:#cbd5e1; font-size:15px; line-height:1.65;">
      ${isTemporary ? escapeHtml(temporaryDescription) : 'Tu reserva quedó confirmada correctamente.'}
    </p>
    ${
      isTemporary
        ? `<div style="margin:18px 0; padding:14px 16px; background:#3b330f; border:1px solid #6d6119; border-radius:12px; color:#fef3c7; font-size:14px; line-height:1.55;">
            <strong style="color:#f4e85a;">Pago pendiente:</strong>
            La confirmación definitiva se realizará cuando completes el pago mediante Mercado Pago.
          </div>`
        : ''
    }
    ${buildDetails(formattedDate, reserve.turn, courtNumber)}
    ${buildMatchup(reserve)}
    ${
      !reserve.isVisit && reserve.isForRanking
        ? `<div style="margin-top:16px; padding:14px 16px; background:#102b4a; border:1px solid #24547b; border-radius:12px; color:#bae6fd; font-size:14px; line-height:1.55;">
            <strong style="color:#7dd3fc;">Partido de ranking:</strong>
            Después del partido podrás registrar el marcador y el ganador desde <strong>Agregar resultado</strong>.
          </div>`
        : ''
    }
    ${
      requiresMaintenance
        ? `<div style="margin-top:16px; padding:14px 16px; background:#173629; border:1px solid #286044; border-radius:12px; color:#bbf7d0; font-size:14px; line-height:1.55;">
            <strong style="color:#86efac;">Cuidado de la cancha:</strong>
            En este horario no hay canchero disponible. Al finalizar, por favor pasa el paño y riega la cancha.
          </div>`
        : ''
    }
    <p style="margin:24px 0 0; color:#e2e8f0; font-size:15px; line-height:1.6;">¡Nos vemos en la cancha! 🎾</p>`;

  return buildEmailShell({
    title: isTemporary ? 'Reserva recibida' : 'Reserva confirmada',
    eyebrow: isTemporary ? 'Pendiente de pago' : 'Confirmación',
    accent: '#f4e85a',
    content,
  });
};

export const buildReservationCancellationEmail = ({ reserve, formattedDate, courtNumber, reason }: { reserve: CourtReserve; formattedDate: string; courtNumber: string; reason?: string }) => {
  const content = `
    <p style="margin:0; color:#e2e8f0; font-size:16px; line-height:1.6;">¡Hola!</p>
    <p style="margin:8px 0 0; color:#cbd5e1; font-size:15px; line-height:1.65;">La siguiente reserva fue anulada y la cancha volvió a quedar disponible.</p>
    ${buildDetails(formattedDate, reserve.turn, courtNumber)}
    ${buildMatchup(reserve)}
    ${
      reason
        ? `<div style="margin-top:16px; padding:14px 16px; background:#3b1820; border:1px solid #71303b; border-radius:12px; color:#fecaca; font-size:14px; line-height:1.55;">
            <strong style="color:#fca5a5;">Motivo:</strong> ${escapeHtml(reason)}
          </div>`
        : ''
    }
    <p style="margin:22px 0 0; color:#cbd5e1; font-size:14px; line-height:1.6;">Si tienes dudas, comunícate con la administración del club.</p>`;

  return buildEmailShell({
    title: 'Reserva anulada',
    eyebrow: 'Cancelación',
    accent: '#f87171',
    content,
  });
};
