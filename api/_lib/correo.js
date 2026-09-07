// Envío de correo vía Brevo.
//
// La clave vive SOLO aquí, en el servidor. Nunca debe pasar al bundle del
// navegador: por eso la variable se llama BREVO_API_KEY y no REACT_APP_*, que
// CRA incrustaría en el JavaScript público.

const REMITENTE = {
  name: 'Pedidos Cooperativa Quilpueblo',
  email: 'crisyaleusandoia@gmail.com',
};

// Mientras esté definido, TODAS las órdenes se desvían acá en vez de ir al
// proveedor real. Es la salvaguarda para que un correo a medio afinar no le
// llegue a El Granero. Se apaga borrando la variable CORREO_PRUEBAS en Vercel.
const CORREO_PRUEBAS = process.env.CORREO_PRUEBAS || '';

const clp = (n) => '$' + Math.round(n || 0).toLocaleString('es-CL');
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function plantillaOrden({ providerName, isMember, periodLabel, lines, total, linkConfirmar, esPrueba, destinoReal }) {
  const filas = lines.map(l => `
    <tr>
      <td style="padding:9px 10px;border-bottom:1px solid #eee;font-size:14px;color:#222">${esc(l.name)}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #eee;font-size:13px;color:#666;white-space:nowrap">${esc(l.unit)}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #eee;font-size:14px;text-align:center;font-weight:700;color:#222">${l.qty}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #eee;font-size:13px;text-align:right;color:#666;white-space:nowrap">${clp(l.price)}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #eee;font-size:14px;text-align:right;font-weight:600;color:#222;white-space:nowrap">${clp(l.subtotal)}</td>
    </tr>`).join('');

  const saludo = isMember
    ? `Hola ${esc(providerName)}, ¿cómo estás?`
    : `Estimado proveedor ${esc(providerName)}:`;

  const cuerpo = isMember
    ? 'Te dejamos el detalle de lo que la cooperativa necesita este período. Cuando puedas, confírmanos qué vas a tener disponible.'
    : 'Junto con saludar, se adjunta el pedido a realizar. Agradeceremos confirmar la disponibilidad de los productos dentro de las próximas 24 horas.';

  const avisoPrueba = esPrueba ? `
    <div style="background:#fff8e1;border:2px dashed #ffb300;border-radius:8px;padding:12px 14px;margin-bottom:18px">
      <p style="margin:0;font-size:13px;color:#e65100;font-weight:700">⚠ CORREO DE PRUEBA — no es un pedido real</p>
      <p style="margin:5px 0 0;font-size:12px;color:#795548">
        El sistema está en modo prueba. En producción este correo se habría enviado a
        <strong>${esc(destinoReal || 'el proveedor')}</strong>.
      </p>
    </div>` : '';

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f0f7f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    <div style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(45,90,45,0.10)">

      <div style="background:#2d5a2d;padding:20px 24px">
        <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700">🛒 Cooperativa Quilpueblo</p>
        <p style="margin:4px 0 0;color:#bcd9bc;font-size:13px">Orden de compra${periodLabel ? ' · ' + esc(periodLabel) : ''}</p>
      </div>

      <div style="padding:24px">
        ${avisoPrueba}
        <p style="margin:0 0 12px;font-size:15px;color:#222">${saludo}</p>
        <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.55">${cuerpo}</p>

        <table style="width:100%;border-collapse:collapse;margin-bottom:4px">
          <thead>
            <tr style="background:#f0f7f0">
              <th style="padding:9px 10px;text-align:left;font-size:11px;color:#2d5a2d;text-transform:uppercase;letter-spacing:.05em">Producto</th>
              <th style="padding:9px 10px;text-align:left;font-size:11px;color:#2d5a2d;text-transform:uppercase;letter-spacing:.05em">Formato</th>
              <th style="padding:9px 10px;text-align:center;font-size:11px;color:#2d5a2d;text-transform:uppercase;letter-spacing:.05em">Cant.</th>
              <th style="padding:9px 10px;text-align:right;font-size:11px;color:#2d5a2d;text-transform:uppercase;letter-spacing:.05em">Precio</th>
              <th style="padding:9px 10px;text-align:right;font-size:11px;color:#2d5a2d;text-transform:uppercase;letter-spacing:.05em">Subtotal</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
          <tfoot>
            <tr>
              <td colspan="4" style="padding:12px 10px;text-align:right;font-size:15px;font-weight:700;color:#2d5a2d">Total</td>
              <td style="padding:12px 10px;text-align:right;font-size:17px;font-weight:700;color:#2d5a2d;white-space:nowrap">${clp(total)}</td>
            </tr>
          </tfoot>
        </table>

        <div style="text-align:center;margin:26px 0 8px">
          <a href="${esc(linkConfirmar)}"
             style="display:inline-block;background:#4CAF50;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700">
            Confirmar disponibilidad
          </a>
          <p style="margin:12px 0 0;font-size:12px;color:#888;line-height:1.5">
            Se abre directo, sin usuario ni contraseña.<br>Podrás marcar producto por producto qué tienes disponible.
          </p>
        </div>
      </div>

      <div style="background:#fafafa;padding:14px 24px;border-top:1px solid #eee">
        <p style="margin:0;font-size:11px;color:#999;line-height:1.5">
          Este enlace es personal y corresponde solo a tu pedido. Si no esperabas este correo, puedes ignorarlo.
        </p>
      </div>
    </div>
  </div>
</body></html>`;
}

async function enviarOrden(params) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'Falta BREVO_API_KEY. Cárgala en Vercel (Settings → Environments → Production) y vuelve a desplegar.' };
  }

  const esPrueba = !!CORREO_PRUEBAS;
  const destinatario = esPrueba ? CORREO_PRUEBAS : params.providerEmail;

  if (!destinatario) {
    return { ok: false, error: 'El proveedor "' + params.providerName + '" no tiene correo cargado.' };
  }

  const html = plantillaOrden({ ...params, esPrueba, destinoReal: params.providerEmail });
  const asunto = (esPrueba ? '[PRUEBA] ' : '') +
    'Orden de compra Cooperativa Quilpueblo' + (params.periodLabel ? ' — ' + params.periodLabel : '');

  let res, body;
  try {
    res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: REMITENTE,
        to: [{ email: destinatario, name: params.providerName }],
        subject: asunto,
        htmlContent: html,
      }),
    });
    body = await res.text();
  } catch (e) {
    return { ok: false, error: 'No se pudo contactar a Brevo: ' + e.message };
  }

  if (!res.ok) {
    let detalle = body;
    try {
      const j = JSON.parse(body);
      detalle = j.message || body;
      // El error más común de la primera vez, traducido a algo accionable.
      if (j.code === 'unauthorized') {
        detalle = 'Brevo rechazó la clave API. Revisa que BREVO_API_KEY sea correcta en Vercel.';
      } else if (/sender/i.test(String(j.message))) {
        detalle = 'Brevo no acepta el remitente ' + REMITENTE.email +
          '. Verifícalo en Brevo: Settings → Senders, Domains, IPs → Senders → Add a sender.';
      }
    } catch { /* body no era JSON */ }
    return { ok: false, error: detalle, destinatario, esPrueba };
  }

  return { ok: true, destinatario, esPrueba };
}

module.exports = { enviarOrden, REMITENTE, CORREO_PRUEBAS };
