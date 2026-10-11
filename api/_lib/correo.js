// Envío de correo vía Brevo.
//
// La clave vive SOLO aquí, en el servidor. Nunca debe pasar al bundle del
// navegador: por eso la variable se llama BREVO_API_KEY y no REACT_APP_*, que
// CRA incrustaría en el JavaScript público.

// El remitente tiene que ser una dirección verificada en Brevo (Senders).
// Configurable en Vercel con CORREO_REMITENTE, para que el Go Live —pasar al
// correo oficial de la cooperativa— sea cambiar una variable y no el código.
const REMITENTE = {
  name: process.env.CORREO_REMITENTE_NOMBRE || 'Pedidos Cooperativa Quilpueblo',
  email: process.env.CORREO_REMITENTE || 'crisyaleusandoia@gmail.com',
};

// Adónde llega la COPIA de cada orden de compra, con el enlace de
// confirmación listo para reenviar por WhatsApp. Pedido de la cooperativa
// (27-sep-2026): muchos proveedores no usan correo, y con la copia la comisión
// no tiene que reescribir el pedido a mano. Por defecto es el mismo remitente
// de Brevo; en el Go Live se cambia CORREO_COOPERATIVA en Vercel.
//
// Admite varias casillas separadas por coma (pedido de la cooperativa,
// 10-oct-2026: Cristopher y Ruby reciben las dos la copia durante el piloto).
const CORREO_COOPERATIVA = process.env.CORREO_COOPERATIVA || REMITENTE.email;

function listaCooperativa(excluir) {
  const lista = String(CORREO_COOPERATIVA || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const filtrada = excluir
    ? lista.filter(e => e.toLowerCase() !== String(excluir).toLowerCase())
    : lista;
  return filtrada.length ? filtrada : null;
}

// Mientras esté definido, TODAS las órdenes se desvían acá en vez de ir al
// proveedor real. Es la salvaguarda para que un correo a medio afinar no le
// llegue a El Granero. Se apaga borrando la variable CORREO_PRUEBAS en Vercel.
const CORREO_PRUEBAS = process.env.CORREO_PRUEBAS || '';

const clp = (n) => '$' + Math.round(n || 0).toLocaleString('es-CL');
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function plantillaOrden({ providerName, isMember, periodLabel, lines, total, linkConfirmar, esPrueba, destinoReal, fechaLimite }) {
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

  const limiteTxt = fechaLimite
    ? new Date(fechaLimite + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })
    : null;

  const cuerpo = isMember
    ? 'Te dejamos el detalle de lo que la cooperativa necesita este período. ' +
      (limiteTxt ? 'Confírmanos qué vas a tener disponible <strong>antes del ' + esc(limiteTxt) + '</strong>.' : 'Cuando puedas, confírmanos qué vas a tener disponible.')
    : 'Junto con saludar, se adjunta el pedido a realizar. ' +
      (limiteTxt
        ? 'Agradeceremos confirmar la disponibilidad de los productos <strong>antes del ' + esc(limiteTxt) + '</strong>.'
        : 'Agradeceremos confirmar la disponibilidad de los productos dentro de las próximas 24 horas.');

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
          ${limiteTxt ? '<div style="margin-top:16px;padding:11px 14px;background:#fff8e1;border:1px solid #ffe082;border-radius:8px"><p style="margin:0;font-size:13px;color:#e65100;font-weight:700">📅 Plazo para confirmar: ' + esc(limiteTxt) + '</p><p style="margin:5px 0 0;font-size:12px;color:#795548;line-height:1.5">Si no recibimos respuesta antes de esa fecha, <strong>asumiremos que traes el pedido completo</strong> y se le cobrará así a las familias.</p></div>' : ''}
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

// La copia para la cooperativa: la misma orden, más un recuadro arriba con el
// enlace a la vista y el pedido ya redactado para pegar en WhatsApp.
function plantillaCopia(params, { esPrueba, destinoReal, sinCorreo }) {
  const lineasTxt = params.lines.map(l => '• ' + l.qty + ' × ' + l.name + (l.unit ? ' (' + l.unit + ')' : '')).join('\n');
  const whatsapp =
    'Hola ' + params.providerName + ', te escribimos de la Cooperativa Quilpueblo.\n' +
    'Este es nuestro pedido' + (params.periodLabel ? ' de ' + params.periodLabel : '') + ':\n\n' +
    lineasTxt + '\n\nTotal aprox.: ' + clp(params.total) + '\n\n' +
    'Puedes confirmar qué tienes disponible acá, producto por producto:\n' + params.linkConfirmar;

  const recuadro = `
    <div style="max-width:640px;margin:0 auto;padding:24px 16px 0">
      <div style="background:#e3f2fd;border:1px solid #90caf9;border-radius:10px;padding:14px 16px">
        <p style="margin:0;font-size:14px;color:#1565c0;font-weight:700">📋 Copia para la cooperativa — ${esc(params.providerName)}</p>
        <p style="margin:6px 0 0;font-size:13px;color:#333;line-height:1.5">
          ${sinCorreo
            ? 'Este proveedor <strong>no tiene correo cargado</strong>: la orden no se le envió. Reenvíale el enlace o el texto de abajo por WhatsApp.'
            : 'La orden se envió a <strong>' + esc(destinoReal || '') + '</strong>' + (esPrueba ? ' (en modo prueba, desviada)' : '') + '. Si el proveedor no usa correo, reenvíale el enlace por WhatsApp.'}
        </p>
        <p style="margin:10px 0 4px;font-size:12px;color:#666">Enlace de confirmación:</p>
        <p style="margin:0;font-size:13px;word-break:break-all"><a href="${esc(params.linkConfirmar)}">${esc(params.linkConfirmar)}</a></p>
        <p style="margin:12px 0 4px;font-size:12px;color:#666">Texto listo para WhatsApp (seleccionar y copiar):</p>
        <pre style="margin:0;padding:10px;background:#fff;border:1px solid #dde;border-radius:6px;font-size:12px;white-space:pre-wrap;font-family:inherit">${esc(whatsapp)}</pre>
      </div>
    </div>`;
  return plantillaOrden({ ...params, esPrueba, destinoReal }).replace('<body style="margin:0;padding:0;background:#f0f7f0;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif">',
    '<body style="margin:0;padding:0;background:#f0f7f0;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif">' + recuadro);
}

async function mandarBrevo({ apiKey, to, subject, html, replyTo }) {
  let res, body;
  try {
    res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: REMITENTE,
        to,
        subject,
        htmlContent: html,
        ...(replyTo ? { replyTo } : {}),
      }),
    });
    body = await res.text();
  } catch (e) {
    return { ok: false, error: 'No se pudo contactar a Brevo: ' + e.message };
  }
  if (!res.ok) return { ok: false, error: traducirError(body) };
  return { ok: true };
}

function traducirError(body) {
  let detalle = body;
  try {
    const j = JSON.parse(body);
    detalle = j.message || body;
    if (j.code === 'unauthorized') {
      detalle = 'Brevo rechazó la clave API. Revisa que BREVO_API_KEY sea correcta en Vercel.';
    } else if (/sender/i.test(String(j.message))) {
      detalle = 'Brevo no acepta el remitente ' + REMITENTE.email +
        '. Verifícalo en Brevo: Settings → Senders, Domains, IPs → Senders → Add a sender.';
    }
  } catch { /* body no era JSON */ }
  return detalle;
}

// Envía la copia a la cooperativa. Nunca hace fallar el envío principal: si la
// copia no sale, la orden ya le llegó al proveedor y el enlace está en el panel.
async function enviarCopiaCooperativa(params, { esPrueba, destinoReal, sinCorreo, excluir }) {
  const apiKey = process.env.BREVO_API_KEY;
  const destinatarios = listaCooperativa(excluir);
  if (!apiKey || !destinatarios) return { ok: false, error: 'sin configurar' };
  const asunto = (esPrueba ? '[PRUEBA] ' : '') + '[Copia] Orden de compra a ' + params.providerName +
    (params.periodLabel ? ' — ' + params.periodLabel : '');
  const r = await mandarBrevo({
    apiKey,
    to: destinatarios.map(email => ({ email, name: 'Cooperativa Quilpueblo' })),
    subject: asunto,
    html: plantillaCopia(params, { esPrueba, destinoReal, sinCorreo }),
  });
  return { ...r, destinatario: destinatarios.join(', ') };
}

async function enviarOrden(params) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'Falta BREVO_API_KEY. Cárgala en Vercel (Settings → Environments → Production) y vuelve a desplegar.' };
  }

  const esPrueba = !!CORREO_PRUEBAS;
  const destinatario = esPrueba ? CORREO_PRUEBAS : params.providerEmail;

  // Sin correo del proveedor la orden igual sirve: se manda solo la copia a la
  // cooperativa, con el enlace para reenviarlo por WhatsApp.
  if (!destinatario) {
    const copia = await enviarCopiaCooperativa(params, { esPrueba, destinoReal: null, sinCorreo: true });
    if (!copia.ok) {
      return { ok: false, error: 'El proveedor "' + params.providerName + '" no tiene correo, y la copia a la cooperativa tampoco salió: ' + copia.error };
    }
    return { ok: true, sinCorreo: true, destinatario: null, esPrueba, copiaA: copia.destinatario };
  }

  const html = plantillaOrden({ ...params, esPrueba, destinoReal: params.providerEmail });
  const asunto = (esPrueba ? '[PRUEBA] ' : '') +
    'Orden de compra Cooperativa Quilpueblo' + (params.periodLabel ? ' — ' + params.periodLabel : '');

  // Si el proveedor responde el correo, la respuesta le llega a la cooperativa
  // (la primera casilla de la lista, si hay varias).
  const primeraCooperativa = listaCooperativa();
  const r = await mandarBrevo({
    apiKey,
    to: [{ email: destinatario, name: params.providerName }],
    subject: asunto,
    html,
    replyTo: primeraCooperativa && primeraCooperativa[0] !== REMITENTE.email ? { email: primeraCooperativa[0] } : null,
  });
  if (!r.ok) return { ok: false, error: r.error, destinatario, esPrueba };

  // La copia a la cooperativa sale a todas las casillas configuradas, salvo la
  // que ya recibió la orden directamente (en modo prueba suelen coincidir).
  let copiaA = null, copiaError = null;
  const copia = await enviarCopiaCooperativa(params, { esPrueba, destinoReal: params.providerEmail, sinCorreo: false, excluir: destinatario });
  if (copia.ok) copiaA = copia.destinatario;
  else if (copia.error !== 'sin configurar') copiaError = copia.error;

  return { ok: true, destinatario, esPrueba, copiaA, copiaError };
}

module.exports = { enviarOrden, REMITENTE, CORREO_PRUEBAS, CORREO_COOPERATIVA };
