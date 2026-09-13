// Acceso a Supabase desde el servidor, vía REST directo.
//
// Deliberadamente NO usamos @supabase/supabase-js aquí: la librería completa
// alarga el arranque en frío de la función y solo necesitamos cuatro consultas.
//
// La clave es la anónima, la misma que ya viaja en el bundle del navegador. No
// es un secreto y no se gana nada ocultándola; el secreto real de este flujo es
// el token de cada orden.

const SUPABASE_URL = 'https://fihovunxkkkwaqsggcri.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tElx3P7KYXfYsqzsn2R7_g_lWT0yulK';

const REST = SUPABASE_URL + '/rest/v1';

async function sb(path, options) {
  const opts = options || {};
  const res = await fetch(REST + path, {
    method: opts.method || 'GET',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
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

  updateOrder: (id, patch) =>
    sb('/purchase_orders?id=eq.' + enc(id), { method: 'PATCH', body: patch }).then(r => (r && r[0]) || null),

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
