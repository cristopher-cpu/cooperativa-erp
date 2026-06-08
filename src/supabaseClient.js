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
  const { data } = await supabase.from('sealed_orders').select('*').eq('period_id', periodId);
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

export async function closePeriod(periodId, newPeriodData) {
  const { error: closeErr } = await supabase
    .from('periods')
    .update({ active: false })
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
    return { error: createErr.message };
  }
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
