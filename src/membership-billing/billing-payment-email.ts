import { buildEmailShell, escapeHtml } from '../email/templates/email-layout.template';
import { MembershipPayment } from './entities/membership-payment.entity';

export function buildMembershipPaymentEmail(payment: MembershipPayment, reversed: boolean) {
  const money = (amount: number) => `$${amount.toLocaleString('es-CL')} CLP`;
  const method =
    payment.method === 'MERCADO_PAGO'
      ? 'Mercado Pago'
      : payment.method === 'BANK_TRANSFER'
        ? 'Transferencia bancaria'
        : payment.method === 'CASH'
          ? 'Efectivo'
          : 'Deposito bancario';
  const title = reversed ? 'Registro de pago anulado' : 'Mensualidades pagadas';
  const rows = payment.allocations
    .map(
      (row) =>
        `<tr>
          <td style="padding:8px 0;color:#f8fafc;">
            ${escapeHtml(row.beneficiaryName || 'Socio')}<br>${escapeHtml(row.period)}
          </td>
          <td style="text-align:right;color:#f8fafc;">${escapeHtml(money(row.amount))}</td>
        </tr>`,
    )
    .join('');
  const message = reversed
    ? 'Administracion anulo este registro de pago. Esto no representa una devolucion de dinero.'
    : payment.method === 'MERCADO_PAGO'
      ? 'Mercado Pago confirmo el pago de las siguientes mensualidades. El club verifico la operacion en el proveedor.'
      : payment.method === 'CASH'
        ? 'Administracion recibio y registro el pago en efectivo de las siguientes mensualidades.'
        : 'Administracion verifico y registro el ingreso bancario de las siguientes mensualidades.';
  const operation =
    payment.method === 'MERCADO_PAGO'
      ? `Operacion Mercado Pago: ${escapeHtml(payment.provider?.paymentId || '')}`
      : payment.method === 'CASH'
        ? `Folio de efectivo: ${escapeHtml(payment.cash?.receiptNumber || '')}`
        : `Referencia bancaria: ${escapeHtml(payment.bank?.reference || '')}`;
  const content = `
    <p>Hola ${escapeHtml(payment.payer.name || 'socio')},</p>
    <p>${message}</p>
    <table width="100%" role="presentation">${rows}</table>
    <p><strong>Total: ${escapeHtml(money(payment.amount))}</strong></p>
    <p>Medio: ${escapeHtml(method)}<br>
      ${operation}<br>
      Referencia CTQ: ${escapeHtml(payment.publicReference)}</p>
    ${reversed ? `<p>Motivo: ${escapeHtml(payment.reversal?.reason || '')}</p>` : ''}
    <p>Puedes consultar el estado actual de tus cuotas en el historial.
      Este aviso no modifica una desactivacion administrativa ni confirma que no existan otras deudas.</p>`;
  return {
    subject: `${title} - CTQ`,
    html: buildEmailShell({ title, eyebrow: 'Mensualidades CTQ', accent: '#f4e85a', content }),
  };
}
