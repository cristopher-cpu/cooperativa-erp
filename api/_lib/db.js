// Acceso a Supabase desde el servidor, vía REST directo.
//
// Deliberadamente NO usamos @supabase/supabase-js aquí: la librería completa
// alarga el arranque en frío de la función y solo necesitamos cuatro consultas.
//
// ── Qué clave usa, y por qué cambió ─────────────────────────────────────────
//
// Antes usaba la clave pública, la misma del bundle, y estaba bien: con RLS
// apagado daba acceso total de todos modos, y el secreto real del flujo de
// proveedores era el token de cada orden.
//
// Con RLS encendido (migración 010) esa clave ya no puede leer nada, y el
// servidor necesita hacer cosas que ninguna política debería permitirle a un
// usuario: verificar un PIN contra `pin_hash`, armar la lista de la pantalla de
// ingreso antes de que nadie haya entrado, y reconstruir una orden de compra.
// Para eso está `SUPABASE_SERVICE_ROLE_KEY`, que se salta RLS.
//
// **Sin prefijo REACT_APP_.** Ese prefijo la incrustaría en el JavaScript
// público, y con la clave de servicio en el bundle RLS dejaría de servir para
// nada — sería peor que no haberlo encendido, porque parecería protegido.
//
// Si la variable no está, se cae a la clave pública: así todo sigue funcionando
// mientras RLS siga apagado, y el día que se enciende sin haber configurado la
// variable el error es inmediato y visible en /api/estado, no silencioso.

const SUPABASE_URL = 'https://fihovunxkkkwaqsggcri.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tElx3P7KYXfYsqzsn2R7_g_lWT0yulK';

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || null;
const KEY = SERVICE_KEY || SUPABASE_ANON_KEY;

const REST = SUPABASE_URL + '/rest/v1';

async function sb(path, options) {
  const opts = options || {};
  const res = await fetch(REST + path, {
    method: opts.method || 'GET',
    headers: {
      apikey: KEY,
      Authorization: 'Bearer ' + KEY,
      'Content-Type': 'application/json',
      Prefer: opts.prefer || 'return=representation',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) {
    const msg = (data && data.message) || ('HTTP ' + res.status);
    throw new Error(msg);
  }
  return data;
}

const enc = encodeURIComponent;

module.exports = {
  sb,

  // Para que /api/estado pueda avisar si falta la clave sin revelarla.
  hayServiceKey: () => !!SERVICE_KEY,

  getOrderByToken: (token) =>
    sb('/purchase_orders?select=*&token=eq.' + enc(token) + '&limit=1').then(r => (r && r[0]) || null),

  // Si la migración 004 todavía no corrió, la columna confirm_until no existe y
  // PostgREST rechaza el insert entero. Enviar órdenes de compra funcionaba
  // antes de esa migración y debe seguir funcionando: se reintenta sin el campo.
  // Una función nueva no puede romper una que ya andaba.
  insertOrder: async (row) => {
    try {
      const r = await sb('/purchase_orders', { method: 'POST', body: [row] });
      return (r && r[0]) || null;
    } catch (e) {
      const falta = /confirm_until/.test(e.message || '');
      if (!falta) throw e;
      console.warn('insertOrder: falta la migración 004, se guarda la orden sin confirm_until');
      const { confirm_until, ...resto } = row;
      const r = await sb('/purchase_orders', { method: 'POST', body: [resto] });
      return (r && r[0]) || null;
    }
  },

  // Mismo criterio que insertOrder: si falta la migración 006 la columna
  // confirmed_source no existe, y perder la confirmación de un proveedor por
  // una columna nueva sería mucho peor que guardarla sin etiquetar de dónde
  // vino. Se reintenta sin los campos que la base todavía no conoce.
  updateOrder: async (id, patch) => {
    try {
      const r = await sb('/purchase_orders?id=eq.' + enc(id), { method: 'PATCH', body: patch });
      return (r && r[0]) || null;
    } catch (e) {
      if (!/confirmed_(source|by)/.test(e.message || '')) throw e;
      console.warn('updateOrder: falta la migración 006, se guarda sin confirmed_source');
      const { confirmed_source, confirmed_by, confirmed_by_name, ...resto } = patch;
      const r = await sb('/purchase_orders?id=eq.' + enc(id), { method: 'PATCH', body: resto });
      return (r && r[0]) || null;
    }
  },

  getProvider: (id) =>
    sb('/providers?select=*&id=eq.' + enc(id) + '&limit=1').then(r => (r && r[0]) || null),
};

// Lecturas para reconstruir el consolidado en el servidor. El navegador solo dice
// "período X, proveedor Y": el contenido de la orden se deriva acá, de la base.
module.exports.getSealedOrdersForPeriod = (periodId) =>
  sb('/sealed_orders?select=*&period_id=eq.' + enc(periodId) + '&order=sealed_at.asc');

module.exports.getProductsOfProvider = (providerId) =>
  sb('/products?select=id,name,unit,price,provider_id&provider_id=eq.' + enc(providerId));

module.exports.getPeriod = (periodId) =>
  sb('/periods?select=*&id=eq.' + enc(periodId) + '&limit=1').then(r => (r && r[0]) || null);

module.exports.getOrdersForProviderPeriod = (periodId, providerId) =>
  sb('/purchase_orders?select=*&period_id=eq.' + enc(periodId) + '&provider_id=eq.' + enc(providerId));
