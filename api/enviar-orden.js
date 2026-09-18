// POST /api/enviar-orden
//
// Crea la orden de compra de un proveedor y se la envía por correo.
// El navegador nunca ve la clave de Brevo: solo llama a este endpoint.
//
// Body: { periodId, providerId }
//
// El navegador NO manda el contenido de la orden. Antes sí lo hacía, y eso
// significaba que cualquiera podía pedirle a esta función que le mandara a un
// proveedor real un pedido con productos, cantidades y precios inventados. Ahora
// el consolidado se reconstruye acá, leyendo los pedidos sellados: lo peor que
// puede lograr una llamada no autorizada es reenviar una orden que ya era cierta.

const crypto = require('crypto');
const {
  getProvider, insertOrder, updateOrder,
  getSealedOrdersForPeriod, getProductsOfProvider, getPeriod,
} = require('./_lib/db');
const { enviarOrden } = require('./_lib/correo');

function baseUrl(req) {
  // VERCEL_URL no incluye el esquema y en local no existe.
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (host && host.startsWith('localhost') ? 'http' : 'https');
  return proto + '://' + host;
}

function parseItems(ord) {
  try { return Array.isArray(ord.items) ? ord.items : JSON.parse(ord.items); } catch { return []; }
}

// Cómo se escribe el formato en la orden que el proveedor recibe.
//
// El maestro tiene 24 maneras de escribir cinco unidades, y entre ellas "Kg",
// "1 Kg" y "Kilo". Un proveedor que recibe tres formatos distintos para lo
// mismo tiene que preguntar, y preguntar por correo cuesta un día.
//
// Cuando la migración 008 ya corrió y el producto está normalizado, se usa la
// versión canónica. Si no, se manda el texto tal cual: es lo que se mandaba
// antes y no empeora nada. No se interpreta acá — adivinar en el borde que
// habla con afuera es el peor lugar para adivinar.

// Maneras de escribir una unidad de MEDIDA. Lo que no está acá es una palabra
// de envase —rollos, caja, bolsa, paquete— y esas sí hay que conservarlas: la
// diferencia entre "24 un" y "24 rollos" es lo que el proveedor despacha.
//
// Duplica parte de src/unidades.js a propósito: ese archivo es del bundle de
// React y aquí no se puede importar. Si se agregan sinónimos de medida allá,
// conviene agregarlos acá.
const MEDIDAS = new Set([
  'gr', 'g', 'grs', 'gramo', 'gramos',
  'kg', 'k', 'kgs', 'kilo', 'kilos', 'kilogramo', 'kilogramos',
  'ml', 'cc', 'mililitro', 'mililitros',
  'lt', 'l', 'lts', 'litro', 'litros',
  'un', 'u', 'uni', 'unid', 'unidad', 'unidades',
]);

function formatoParaProveedor(prod) {
  const qty = prod.format_qty;
  const unit = prod.format_unit;
  if (qty == null || !unit) return prod.unit || '';

  const n = Number(qty);
  const num = Number.isInteger(n) ? String(n) : String(n).replace('.', ',');
  const canonico = num + ' ' + unit;

  const original = String(prod.unit || '').trim();
  if (!original) return canonico;

  // El paréntesis se agrega solo cuando la etiqueta original dice algo que la
  // canónica pierde. "Kg" y "1 kg" son lo mismo y repetirlo es ruido; "24
  // rollos" y "24 un" no lo son.
  const palabras = original
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z]+/).filter(Boolean);
  const aporta = palabras.some(p => !MEDIDAS.has(p));

  return aporta ? canonico + ' (' + original + ')' : canonico;
}

// Agrupa los pedidos sellados del período y se queda con los productos de este
// proveedor. Es la misma lógica que muestra la pestaña Consolidado, pero acá es
// la que manda: si difieren, la verdad es esta.
function construirLineas(sealedOrders, productosDelProveedor) {
  const porProducto = new Map();
  const indice = new Map(productosDelProveedor.map(p => [p.id, p]));

  // Un mismo family_id puede tener más de una fila si algo salió mal al sellar.
  // Nos quedamos con la más reciente para no contar dos veces el mismo pedido.
  const ultimaPorFamilia = new Map();
  sealedOrders.forEach(o => { ultimaPorFamilia.set(o.family_id, o); });

  ultimaPorFamilia.forEach(ord => {
    parseItems(ord).forEach(item => {
      if (!item || !(Number(item.qty) > 0)) return;
      const prod = indice.get(item.id);
      if (!prod) return; // de otro proveedor, o ya no existe en el maestro

      if (!porProducto.has(prod.id)) {
        porProducto.set(prod.id, {
          product_id: prod.id,
          name: prod.name,
          unit: formatoParaProveedor(prod),
          price: Number(prod.price) || 0,
          qty: 0,
          subtotal: 0,
          available: null,
          confirmed_qty: null,
          note: null,
        });
      }
      const l = porProducto.get(prod.id);
      l.qty += Number(item.qty);
      l.subtotal = Math.round(l.qty * l.price);
    });
  });

  return Array.from(porProducto.values())
    .filter(l => l.qty > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { periodId, providerId } = body;

    if (!periodId) return res.status(400).json({ error: 'Falta el período' });
    if (!providerId) return res.status(400).json({ error: 'Falta el proveedor' });

    const [provider, periodo, sealedOrders, productos] = await Promise.all([
      getProvider(providerId),
      getPeriod(periodId),
      getSealedOrdersForPeriod(periodId),
      getProductsOfProvider(providerId),
    ]);

    if (!provider) return res.status(404).json({ error: 'El proveedor ya no existe' });
    if (!periodo) return res.status(404).json({ error: 'El período no existe' });

    const lineas = construirLineas(sealedOrders || [], productos || []);
    if (lineas.length === 0) {
      return res.status(400).json({ error: 'No hay nada que pedirle a ' + provider.name + ' en este período.' });
    }

    const total = lineas.reduce((s, l) => s + l.subtotal, 0);
    const token = crypto.randomBytes(24).toString('base64url');

    const orden = await insertOrder({
      period_id: String(periodId),
      period_label: periodo.label || null,
      provider_id: provider.id,
      provider_name: provider.name,
      token,
      status: 'enviada',
      confirm_until: periodo.date_confirm_until || null,
      lines: lineas,
      total,
    });

    if (!orden) return res.status(500).json({ error: 'No se pudo guardar la orden' });

    const link = baseUrl(req) + '/api/confirmar?token=' + encodeURIComponent(token);

    const envio = await enviarOrden({
      providerName: provider.name,
      providerEmail: provider.email,
      isMember: !!provider.is_member,
      periodLabel: periodo.label,
      fechaLimite: periodo.date_confirm_until || null,
      lines: lineas,
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
      lineas: lineas.length,
      enviadoA: envio.destinatario,
      esPrueba: !!envio.esPrueba,
      link,
    });
  } catch (e) {
    console.error('enviar-orden:', e);
    return res.status(500).json({ error: e.message || 'Error inesperado' });
  }
};
