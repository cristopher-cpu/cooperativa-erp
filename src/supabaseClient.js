import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://fihovunxkkkwaqsggcri.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_tElx3P7KYXfYsqzsn2R7_g_lWT0yulK";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function getFamilies() {
  const { data } = await supabase.from('families').select('*');
  return data || [];
}

export async function getProducts() {
  const { data } = await supabase.from('products').select('*');
  return data || [];
}

export async function getSealedOrders(periodId) {
  const { data } = await supabase.from('sealed_orders').select('*').eq('period_id', periodId).order('sealed_at', { ascending: true });
  return data || [];
}

export async function getPeriod() {
  const { data } = await supabase.from('periods').select('*').eq('active', true).single();
  return data;
}

export async function getAllPeriods() {
  const { data } = await supabase.from('periods').select('*').order('created_at', { ascending: false });
  return data || [];
}

// Analytics: fetch full history across all periods (client-side aggregation, no extra cost)
export async function getAllSealedOrders() {
  const { data, error } = await supabase.from('sealed_orders').select('*').order('sealed_at', { ascending: true });
  if (error) { console.error('getAllSealedOrders error:', error.message); return []; }
  return data || [];
}

export async function getAllCashFlow() {
  const { data, error } = await supabase.from('cash_flow').select('*').order('date', { ascending: true });
  if (error) { console.error('getAllCashFlow error:', error.message); return []; }
  return data || [];
}

// Supabase v2: insert/update without .select() returns null data even on success.
// All mutating functions below use .select() so callers get real data back.

export async function sealOrder(order) {
  const { data, error } = await supabase
    .from('sealed_orders')
    .insert([order])
    .select()
    .single();
  if (error) console.error('sealOrder error:', error.message);
  return data;
}

export async function unsealOrder(orderId) {
  const { error } = await supabase.from('sealed_orders').delete().eq('id', orderId);
  if (error) console.error('unsealOrder error:', error.message);
  return !error;
}

export async function markRetired(orderId) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('sealed_orders')
    .update({ retired: true, retired_at: now })
    .eq('id', orderId)
    .select()
    .single();
  if (error) console.error('markRetired error:', error.message);
  return data;
}

export async function addFamily(family) {
  const { data, error } = await supabase
    .from('families')
    .insert([family])
    .select()
    .single();
  if (error) console.error('addFamily error:', error.message);
  return data;
}

export async function updateFamilyBalance(familyId, balance) {
  const { data, error } = await supabase
    .from('families')
    .update({ balance })
    .eq('id', familyId)
    .select()
    .single();
  if (error) console.error('updateFamilyBalance error:', error.message);
  return data;
}

export async function addProduct(product) {
  const { data, error } = await supabase
    .from('products')
    .insert([product])
    .select()
    .single();
  if (error) console.error('addProduct error:', error.message);
  return data;
}

export async function updateProduct(id, updates) {
  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) console.error('updateProduct error:', error.message);
  return data;
}

export async function updatePeriod(periodId, updates) {
  // Sanitize: DATE columns must receive null, never empty string
  const clean = { ...updates };
  ['date_from', 'date_to', 'date_delivery'].forEach(k => {
    if (k in clean && clean[k] === '') clean[k] = null;
  });
  const { data, error } = await supabase
    .from('periods')
    .update(clean)
    .eq('id', periodId)
    .select()
    .single();
  if (error) console.error('updatePeriod error:', error.message);
  return data;
}

export async function closePeriod(periodId, newPeriodData, periodSummary = null) {
  const closeUpdates = { active: false, closed_at: new Date().toISOString() };
  if (periodSummary !== null) closeUpdates.summary = typeof periodSummary === 'string' ? periodSummary : JSON.stringify(periodSummary);
  const { error: closeErr } = await supabase
    .from('periods')
    .update(closeUpdates)
    .eq('id', periodId);
  if (closeErr) {
    console.error('closePeriod (close) error:', closeErr.message);
    return { error: closeErr.message };
  }
  const { data, error: createErr } = await supabase
    .from('periods')
    .insert([newPeriodData])
    .select()
    .single();
  if (createErr) {
    console.error('closePeriod (create) error:', createErr.message);
    // Rollback: reactivate old period so we're never left without an active period
    await supabase.from('periods').update({ active: true }).eq('id', periodId);
    return { error: createErr.message };
  }
  return data;
}

export async function addAdminLog(log) {
  const { data, error } = await supabase.from('admin_logs').insert([log]).select().single();
  if (error) console.error('addAdminLog error:', error.message);
  return data;
}

export async function getAdminLogs() {
  const { data, error } = await supabase.from('admin_logs').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) { console.error('getAdminLogs error:', error.message); return []; }
  return data || [];
}

export async function getPastPeriods() {
  const { data, error } = await supabase.from('periods').select('*').eq('active', false).order('closed_at', { ascending: false });
  if (error) { console.error('getPastPeriods error:', error.message); return []; }
  return data || [];
}

export async function createPeriod(periodData) {
  const { data, error } = await supabase
    .from('periods')
    .insert([periodData])
    .select()
    .single();
  if (error) { console.error('createPeriod error:', error.message); return { error: error.message }; }
  return data;
}

export async function getCashFlow(periodId) {
  const { data, error } = await supabase
    .from('cash_flow')
    .select('*')
    .eq('period_id', periodId)
    .order('date', { ascending: false });
  if (error) { console.error('getCashFlow error:', error.message); return []; }
  return data || [];
}

export async function addCashFlowEntry(entry) {
  const { data, error } = await supabase
    .from('cash_flow')
    .insert([entry])
    .select()
    .single();
  if (error) { console.error('addCashFlowEntry error:', error.message); return null; }
  return data;
}

export async function deleteCashFlowEntry(id) {
  const { error } = await supabase.from('cash_flow').delete().eq('id', id);
  if (error) console.error('deleteCashFlowEntry error:', error.message);
  return !error;
}

export async function updateFamilyPin(familyId, pin) {
  const { data, error } = await supabase.from('families').update({ pin: pin || null }).eq('id', familyId).select().single();
  if (error) console.error('updateFamilyPin error:', error.message);
  return data;
}

export async function updateFamilyRole(familyId, role) {
  const { data, error } = await supabase.from('families').update({ role }).eq('id', familyId).select().single();
  if (error) console.error('updateFamilyRole error:', error.message);
  return data;
}

export async function getBodega(periodId) {
  const { data, error } = await supabase.from('bodega').select('*').eq('period_id', periodId).order('created_at', { ascending: true });
  if (error) { console.error('getBodega error:', error.message); return []; }
  return data || [];
}

export async function addBodegaItem(item) {
  const { data, error } = await supabase.from('bodega').insert([item]).select().single();
  if (error) { console.error('addBodegaItem error:', error.message); return null; }
  return data;
}

export async function updateBodegaItem(id, updates) {
  const { data, error } = await supabase.from('bodega').update(updates).eq('id', id).select().single();
  if (error) { console.error('updateBodegaItem error:', error.message); return null; }
  return data;
}

export async function deleteBodegaItem(id) {
  const { error } = await supabase.from('bodega').delete().eq('id', id);
  if (error) console.error('deleteBodegaItem error:', error.message);
  return !error;
}

export async function getBodegaAssignments(periodId) {
  const { data, error } = await supabase.from('bodega_assignments').select('*').eq('period_id', periodId).order('assigned_at', { ascending: false });
  if (error) { console.error('getBodegaAssignments error:', error.message); return []; }
  return data || [];
}

export async function addBodegaAssignment(assignment) {
  const { data, error } = await supabase.from('bodega_assignments').insert([assignment]).select().single();
  if (error) { console.error('addBodegaAssignment error:', error.message); return null; }
  return data;
}

export async function deleteBodegaAssignment(id) {
  const { error } = await supabase.from('bodega_assignments').delete().eq('id', id);
  if (error) console.error('deleteBodegaAssignment error:', error.message);
  return !error;
}

export async function getInventory() {
  const { data } = await supabase.from('inventory').select('*');
  return data || [];
}

export async function getMovements() {
  const { data } = await supabase
    .from('movements')
    .select('*')
    .order('created_at', { ascending: false });
  return data || [];
}

export async function addInventoryEntry(movement) {
  const { data, error } = await supabase.from('movements').insert([movement]).select().single();
  if (error) console.error('addInventoryEntry error:', error.message);
  return data;
}

export async function updateInventory(productId, quantity) {
  const { data: existing } = await supabase
    .from('inventory')
    .select('*')
    .eq('product_id', productId)
    .single();
  if (existing) {
    const { data, error } = await supabase
      .from('inventory')
      .update({ quantity })
      .eq('product_id', productId)
      .select()
      .single();
    if (error) console.error('updateInventory error:', error.message);
    return data;
  } else {
    const { data, error } = await supabase
      .from('inventory')
      .insert([{ id: Date.now().toString(), product_id: productId, quantity }])
      .select()
      .single();
    if (error) console.error('updateInventory (insert) error:', error.message);
    return data;
  }
}

// ─── PROVEEDORES ──────────────────────────────────────────────────────────────
// Los proveedores dejaron de ser texto libre dentro de cada producto y pasaron a
// ser una entidad propia (Fase 2, etapa 1). products.provider_id apunta acá.
// products.provider (texto) se mantiene sincronizado para no romper la búsqueda
// del catálogo ni los items ya guardados en sealed_orders.

export async function getProviders() {
  const { data, error } = await supabase.from('providers').select('*').order('name');
  if (error) { console.error('getProviders error:', error.message); return []; }
  return data || [];
}

export async function addProvider(provider) {
  const { data, error } = await supabase.from('providers').insert([provider]).select().single();
  if (error) { console.error('addProvider error:', error.message); return { error: error.message }; }
  return data;
}

export async function updateProvider(id, updates) {
  const { data, error } = await supabase.from('providers').update(updates).eq('id', id).select().single();
  if (error) { console.error('updateProvider error:', error.message); return { error: error.message }; }
  return data;
}

export async function deleteProvider(id) {
  const { error } = await supabase.from('providers').delete().eq('id', id);
  if (error) { console.error('deleteProvider error:', error.message); return { error: error.message }; }
  return true;
}

// Renombrar un proveedor obliga a reescribir el texto denormalizado en products,
// o el catálogo mostraría el nombre viejo hasta el próximo despliegue.
export async function syncProviderNameOnProducts(providerId, newName) {
  const { error } = await supabase.from('products').update({ provider: newName }).eq('provider_id', providerId);
  if (error) console.error('syncProviderNameOnProducts error:', error.message);
  return !error;
}

export async function updateFamilyContacts(familyId, email, email2) {
  const { data, error } = await supabase
    .from('families')
    .update({ email: email || null, email2: email2 || null })
    .eq('id', familyId)
    .select()
    .single();
  if (error) { console.error('updateFamilyContacts error:', error.message); return { error: error.message }; }
  return data;
}

// ─── ÓRDENES DE COMPRA ────────────────────────────────────────────────────────
// El envío NO se hace desde el navegador: la clave de Brevo vive solo en el
// servidor. Acá únicamente leemos el estado y llamamos a /api/enviar-orden.

export async function getPurchaseOrders(periodId) {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('*')
    .eq('period_id', periodId)
    .order('created_at', { ascending: false });
  if (error) { console.error('getPurchaseOrders error:', error.message); return []; }
  return data || [];
}

export async function deletePurchaseOrder(id) {
  const { error } = await supabase.from('purchase_orders').delete().eq('id', id);
  if (error) { console.error('deletePurchaseOrder error:', error.message); return { error: error.message }; }
  return true;
}

// Llama a la función serverless. Devuelve { ok, ... } o { error }.
export async function sendPurchaseOrder(payload) {
  try {
    const res = await fetch('/api/enviar-orden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* respuesta no-JSON */ }
    if (!res.ok) {
      // Sin cuerpo JSON casi siempre significa que la función no existe todavía:
      // pasa al correr `npm start`, que no ejecuta el directorio /api.
      return { error: (body && body.error) || 'El servidor respondió ' + res.status + '. Si estás en npm start, usa `vercel dev` para probar el envío de correos.', guardada: body && body.guardada };
    }
    return body || { error: 'Respuesta vacía del servidor' };
  } catch (e) {
    return { error: 'No se pudo contactar al servidor: ' + e.message };
  }
}
