// POST /api/enviar-orden
//
// Crea la orden de compra de un proveedor y se la envía por correo.
// El navegador nunca ve la clave de Brevo: solo llama a este endpoint.
//
// Body: { periodId, periodLabel, providerId, lines: [{product_id,name,unit,qty,price,subtotal}] }

const crypto = require('crypto');
const { getProvider, insertOrder, updateOrder } = require('./_lib/db');
const { enviarOrden } = require('./_lib/correo');

function baseUrl(req) {
  // VERCEL_URL no incluye el esquema y en local no existe.
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (host && host.startsWith('localhost') ? 'http' : 'https');
  return proto + '://' + host;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { periodId, periodLabel, providerId, lines } = body;

    if (!periodId) return res.status(400).json({ error: 'Falta el período' });
    if (!providerId) return res.status(400).json({ error: 'Falta el proveedor' });
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'La orden no tiene productos' });
    }

    const provider = await getProvider(providerId);
    if (!provider) return res.status(404).json({ error: 'El proveedor ya no existe' });

    // Se recalcula en el servidor: no confiamos en los totales que manda el navegador.
    const limpias = lines.map(l => {
      const qty = Number(l.qty) || 0;
      const price = Number(l.price) || 0;
      return {
        product_id: l.product_id,
        name: String(l.name || ''),
        unit: String(l.unit || ''),
        qty,
        price,
        subtotal: Math.round(qty * price),
        available: null,      // lo llena el proveedor al confirmar
        confirmed_qty: null,
        note: null,
      };
    }).filter(l => l.qty > 0);

    if (limpias.length === 0) return res.status(400).json({ error: 'Todas las cantidades son cero' });

    const total = limpias.reduce((s, l) => s + l.subtotal, 0);
    const token = crypto.randomBytes(24).toString('base64url');

    const orden = await insertOrder({
      period_id: String(periodId),
      period_label: periodLabel || null,
      provider_id: provider.id,
      provider_name: provider.name,
      token,
      status: 'enviada',
      lines: limpias,
      total,
    });

    if (!orden) return res.status(500).json({ error: 'No se pudo guardar la orden' });

    const link = baseUrl(req) + '/api/confirmar?token=' + encodeURIComponent(token);

    const envio = await enviarOrden({
      providerName: provider.name,
      providerEmail: provider.email,
      isMember: !!provider.is_member,
      periodLabel,
      lines: limpias,
      total,
      linkConfirmar: link,
    });

    // La orden queda guardada aunque el correo falle: así el admin puede
    // reintentar el envío sin rearmar nada, y queda registro del error.
    await updateOrder(orden.id, envio.ok
      ? { sent_at: new Date().toISOString(), sent_to: envio.destinatario, is_test: !!envio.esPrueba, send_error: null }
      : { send_error: envio.error });

    if (!envio.ok) {
      return res.status(502).json({ error: envio.error, orderId: orden.id, guardada: true });
    }

    return res.status(200).json({
      ok: true,
      orderId: orden.id,
      total,
      enviadoA: envio.destinatario,
      esPrueba: !!envio.esPrueba,
      link,
    });
  } catch (e) {
    console.error('enviar-orden:', e);
    return res.status(500).json({ error: e.message || 'Error inesperado' });
  }
};
