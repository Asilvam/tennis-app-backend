export const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

export const buildEmailShell = ({ title, eyebrow, accent, content }: { title: string; eyebrow: string; accent: string; content: string }) => `
<!doctype html>
<html lang="es">
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      @media only screen and (max-width: 480px) {
        .ctq-email-content { padding: 22px 14px 26px !important; }
        .ctq-details { border-spacing: 0 8px !important; }
        .ctq-detail-cell { display: block !important; width: auto !important; margin: 0 0 8px !important; }
      }
    </style>
  </head>
  <body style="margin:0; padding:0; background:#07152a;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">${escapeHtml(title)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; background:#07152a;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
            style="width:100%; max-width:600px; background:#0a1b33; border:1px solid #263a55; border-radius:18px; overflow:hidden; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#f8fafc;">
            <tr>
              <td style="padding:0; height:5px; background:${accent}; font-size:0; line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td align="center" style="padding:28px 24px 22px; background:#112544; border-bottom:1px solid #263a55;">
                <div
                  style="display:inline-block; padding:7px 12px; border-radius:999px; background:#17263f; border:1px solid ${accent}; color:${accent};
                    font-size:11px; line-height:1; font-weight:800; letter-spacing:1.2px; text-transform:uppercase;">
                  ${escapeHtml(eyebrow)}
                </div>
                <h1 style="margin:14px 0 0; color:#f8fafc; font-size:26px; line-height:1.2; font-weight:750;">${escapeHtml(title)}</h1>
              </td>
            </tr>
            <tr>
              <td class="ctq-email-content" style="padding:26px 24px 30px;">${content}</td>
            </tr>
            <tr>
              <td align="center" style="padding:18px 24px; background:#08172c; border-top:1px solid #263a55; color:#94a3b8; font-size:12px; line-height:1.5;">
                <strong style="color:#f8fafc;">Club de Tenis Quintero</strong><br>
                Mensaje automático · Por favor, no respondas a este correo.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
