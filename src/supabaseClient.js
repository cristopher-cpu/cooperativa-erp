import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://fihovunxkkkwaqsggcri.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_tElx3P7KYXfYsqzsn2R7_g_lW70yulK";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function getFamilies() {
  const { data, error } = await supabase.from('families').select('*');
  return data || [];
}

export async function getProducts() {
  const { data, error } = await supabase.from('products').select('*');
  return data || [];
}

export async function getSealedOrders(periodId) {
  const { data, error } = await supabase.from('sealed_orders').select('*').eq('period_id', periodId);
  return data || [];
}

export async function getPeriod() {
  const { data, error } = await supabase.from('periods').select('*').eq('active', true).single();
  return data;
}

export async function sealOrder(order) {
  const { data, error } = await supabase.from('sealed_orders').insert([order]);
  if (error) console.error('Error sealing order:', error);
  return data;
}

export async function markRetired(orderId) {
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('sealed_orders').update({ retired: true, retired_at: now }).eq('id', orderId);
  if (error) console.error('Error marking retired:', error);
  return data;
}

export async function addFamily(family) {
  const { data, error } = await supabase.from('families').insert([family]);
  if (error) console.error('Error adding family:', error);
  return data;
}

export async function addProduct(product) {
  const { data, error } = await supabase.from('products').insert([product]);
  if (error) console.error('Error adding product:', error);
  return data;
}

export async function updateProduct(id, updates) {
  const { data, error } = await supabase.from('products').update(updates).eq('id', id);
  if (error) console.error('Error updating product:', error);
  return data;
}

export async function updatePeriod(periodId, updates) {
  const { data, error } = await supabase.from('periods').update(updates).eq('id', periodId);
  if (error) console.error('Error updating period:', error);
  return data;
}

export async function getInventory() {
  const { data, error } = await supabase.from('inventory').select('*');
  return data || [];
}

export async function getMovements() {
  const { data, error } = await supabase.from('movements').select('*').order('created_at', { ascending: false });
  return data || [];
}

export async function addInventoryEntry(movement) {
  const { data, error } = await supabase.from('movements').insert([movement]);
  if (error) console.error('Error adding inventory:', error);
  return data;
}

export async function updateInventory(productId, quantity) {
  const { data: existing } = await supabase.from('inventory').select('*').eq('product_id', productId).single();
  
  if (existing) {
    const { data, error } = await supabase.from('inventory').update({ quantity }).eq('product_id', productId);
    if (error) console.error('Error updating inventory:', error);
    return data;
  } else {
    const { data, error } = await supabase.from('inventory').insert([{ id: Date.now().toString(), product_id: productId, quantity }]);
    if (error) console.error('Error creating inventory:', error);
    return data;
  }
}