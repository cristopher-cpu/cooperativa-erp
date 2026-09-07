// GET  /api/confirmar?token=xxx  → página de confirmación del proveedor
// POST /api/confirmar?token=xxx  → guarda la respuesta
//
// La página se sirve como HTML plano desde el servidor, NO como parte de la
// aplicación React. Es deliberado: el proveedor es externo a la cooperativa, y
// así nunca carga el bundle del navegador (que contiene la clave pública de
// Supabase) ni tiene forma de llegar a los datos de las familias. Lo único que
// puede ver es la orden cuyo token trae en el enlace.

const { getOrderByToken, updateOrder } = require('./_lib/db');

const clp = (n) => '$' + Math.round(n || 0).toLocaleString('es-CL');
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const shell = (titulo, contenido) => `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(titulo)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#f0f7f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#222}
  .wrap{max-width:720px;margin:0 auto;padding:20px 14px 60px}
  .card{background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(45,90,45,.10);overflow:hidden}
  .head{background:#2d5a2d;padding:20px 22px}
  .head h1{margin:0;color:#fff;font-size:18px;font-weight:700}
  .head p{margin:4px 0 0;color:#bcd9bc;font-size:13px}
  .body{padding:22px}
  .intro{font-size:14px;color:#555;line-height:1.55;margin:0 0 18px}
  .row{border:1px solid #e6ede6;border-radius:10px;padding:13px 14px;margin-bottom:10px}
  .rowTop{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
  .pname{font-size:15px;font-weight:600;margin:0}
  .pmeta{font-size:12px;color:#888;margin:3px 0 0}
  .psub{font-size:15px;font-weight:700;color:#2d5a2d;white-space:nowrap}
  .opts{display:flex;gap:8px;margin-top:11px;flex-wrap:wrap}
  .opt{flex:1;min-width:130px}
  .opt input{position:absolute;opacity:0;pointer-events:none}
  .opt span{display:block;text-align:center;padding:9px 10px;border:1.5px solid #dde8dd;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;background:#fff;color:#555;user-select:none}
  .opt input:checked + span.si{background:#e8f5e9;border-color:#4CAF50;color:#2e7d32}
  .opt input:checked + span.parcial{background:#fff8e1;border-color:#ffb300;color:#e65100}
  .opt input:checked + span.no{background:#ffebee;border-color:#e57373;color:#c62828}
  .qty{margin-top:9px;display:none}
  .qty label{font-size:12px;color:#666;display:block;margin-bottom:4px}
  .qty input{width:130px;padding:8px;border:1.5px solid #ffb300;border-radius:7px;font-size:15px;text-align:center}
  .total{display:flex;justify-content:space-between;align-items:center;padding:15px 2px 4px;font-size:16px;font-weight:700;color:#2d5a2d}
  textarea{width:100%;padding:10px;border:1px solid #dde8dd;border-radius:8px;font-size:14px;font-family:inherit;resize:vertical;min-height:70px}
  button{width:100%;padding:15px;background:#4CAF50;color:#fff;border:0;border-radius:9px;font-size:16px;font-weight:700;cursor:pointer;margin-top:16px}
  button:active{transform:translateY(1px)}
  .note{font-size:12px;color:#999;text-align:center;margin:12px 0 0;line-height:1.5}
  .msg{padding:26px 22px;text-align:center}
  .msg .big{font-size:44px;margin:0}
  .msg h2{font-size:19px;margin:14px 0 6px}
  .msg p{font-size:14px;color:#666;margin:0;line-height:1.6}
  .badge{display:inline-block;font-size:11px;font-weight:700;padding:4px 11px;border-radius:11px;background:#e8f5e9;color:#2e7d32;margin-top:12px}
  .aviso{background:#fff8e1;border:2px dashed #ffb300;border-radius:8px;padding:11px 13px;margin-bottom:16px;font-size:12px;color:#e65100;font-weight:600}
</style></head><body><div class="wrap">${contenido}</div></body></html>`;

const pantallaSimple = (emoji, titulo, texto) => shell(titulo, `
  <div class="card"><div class="msg">
    <p class="big">${emoji}</p><h2>${esc(titulo)}</h2><p>${texto}</p>
  </div></div>`);

function pantallaOrden(o) {
  const lineas = o.lines.map((l, i) => `
    <div class="row">
      <div class="rowTop">
        <div>
          <p class="pname">${esc(l.name)}</p>
          <p class="pmeta">${esc(l.unit)} · ${clp(l.price)} c/u</p>
        </div>
        <div style="text-align:right">
          <p class="pname">${l.qty}</p>
          <p class="psub">${clp(l.subtotal)}</p>
        </div>
      </div>
      <div class="opts">
        <label class="opt"><input type="radio" name="d${i}" value="si" checked onchange="tog(${i})"><span class="si">✓ Completo</span></label>
        <label class="opt"><input type="radio" name="d${i}" value="parcial" onchange="tog(${i})"><span class="parcial">≈ Parcial</span></label>
        <label class="opt"><input type="radio" name="d${i}" value="no" onchange="tog(${i})"><span class="no">✕ No tengo</span></label>
      </div>
      <div class="qty" id="q${i}">
        <label>¿Cuántas unidades puedes entregar? (de ${l.qty})</label>
        <input type="number" name="q${i}" min="0" max="${l.qty}" step="1" value="${l.qty}">
      </div>
    </div>`).join('');

  return shell('Confirmar pedido · Cooperativa Quilpueblo', `
  <div class="card">
    <div class="head">
      <h1>🛒 Cooperativa Quilpueblo</h1>
      <p>Orden de compra${o.period_label ? ' · ' + esc(o.period_label) : ''} — ${esc(o.provider_name)}</p>
    </div>
    <div class="body">
      ${o.is_test ? '<div class="aviso">⚠ Esta es una orden de PRUEBA del sistema, no un pedido real.</div>' : ''}
      <p class="intro">Marca para cada producto si podrás entregarlo completo, solo una parte, o si no lo tienes disponible. Al terminar, presiona el botón del final.</p>
      <form method="POST" action="?token=${encodeURIComponent(o.token)}">
        ${lineas}
        <div class="total"><span>Total del pedido</span><span>${clp(o.total)}</span></div>
        <div style="margin-top:14px">
          <label style="font-size:13px;color:#666;display:block;margin-bottom:6px">¿Algo que debamos saber? (opcional)</label>
          <textarea name="nota" placeholder="Plazos, cambios de precio, sustituciones..."></textarea>
        </div>
        <button type="submit">Enviar confirmación</button>
        <p class="note">Podrás volver a abrir este enlace para revisar lo que enviaste.</p>
      </form>
    </div>
  </div>
  <script>
    function tog(i){
      var v=document.querySelector('input[name="d'+i+'"]:checked').value;
      var q=document.getElementById('q'+i);
      q.style.display = v==='parcial' ? 'block' : 'none';
    }
  </script>`);
}

function pantallaGracias(o) {
  const filas = o.lines.map(l => {
    const est = l.available === true
      ? (l.confirmed_qty != null && l.confirmed_qty < l.qty
          ? '<span style="color:#e65100;font-weight:600">Parcial: ' + l.confirmed_qty + ' de ' + l.qty + '</span>'
          : '<span style="color:#2e7d32;font-weight:600">Completo</span>')
      : '<span style="color:#c62828;font-weight:600">No disponible</span>';
    return '<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid #f2f2f2;font-size:13px">' +
      '<span>' + esc(l.name) + ' <span style="color:#aaa">×' + l.qty + '</span></span>' + est + '</div>';
  }).join('');

  return shell('Confirmación recibida', `
  <div class="card">
    <div class="msg">
      <p class="big">✅</p>
      <h2>Confirmación recibida</h2>
      <p>Gracias, ${esc(o.provider_name)}. La cooperativa ya tiene tu respuesta.</p>
      <span class="badge">Enviada el ${new Date(o.confirmed_at).toLocaleString('es-CL')}</span>
    </div>
    <div style="padding:0 22px 22px">
      <p style="font-size:12px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px">Lo que confirmaste</p>
      ${filas}
      ${o.provider_note ? '<p style="margin:14px 0 0;font-size:13px;color:#555;background:#f7f9f7;padding:11px 13px;border-radius:8px"><strong>Tu nota:</strong> ' + esc(o.provider_note) + '</p>' : ''}
    </div>
  </div>`);
}

function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const out = {};
      new URLSearchParams(raw).forEach((v, k) => { out[k] = v; });
      resolve(out);
    });
  });
}

module.exports = async (req, res) => {
  const send = (code, html) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(code).send(html);
  };

  try {
    const token = (req.query && req.query.token) || '';
    if (!token) {
      return send(400, pantallaSimple('🔗', 'Enlace incompleto', 'Al enlace le falta el código. Abre el que llegó en el correo, completo.'));
    }

    const orden = await getOrderByToken(token);
    if (!orden) {
      return send(404, pantallaSimple('🔍', 'Enlace no válido', 'Este enlace no corresponde a ningún pedido. Puede que haya sido reemplazado por uno más reciente: revisa si te llegó otro correo.'));
    }

    if (req.method === 'GET') {
      return send(200, orden.status === 'confirmada' ? pantallaGracias(orden) : pantallaOrden(orden));
    }

    if (req.method === 'POST') {
      if (orden.status === 'confirmada') return send(200, pantallaGracias(orden));

      const form = await parseBody(req);
      const lines = orden.lines.map((l, i) => {
        const d = form['d' + i];
        if (d === 'no') return { ...l, available: false, confirmed_qty: 0 };
        if (d === 'parcial') {
          let q = parseInt(form['q' + i], 10);
          if (isNaN(q) || q < 0) q = 0;
          if (q > l.qty) q = l.qty;
          // "Parcial" con la cantidad completa es en realidad completo.
          return { ...l, available: q > 0, confirmed_qty: q };
        }
        return { ...l, available: true, confirmed_qty: l.qty };
      });

      const actualizada = await updateOrder(orden.id, {
        status: 'confirmada',
        lines,
        confirmed_at: new Date().toISOString(),
        provider_note: (form.nota || '').trim() || null,
      });

      return send(200, pantallaGracias(actualizada || { ...orden, lines, confirmed_at: new Date().toISOString(), provider_note: form.nota }));
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).send('Método no permitido');
  } catch (e) {
    console.error('confirmar:', e);
    return send(500, pantallaSimple('⚠️', 'Algo salió mal', 'No pudimos cargar el pedido. Intenta de nuevo en unos minutos o avísale a la cooperativa.'));
  }
};
