import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://fihovunxkkkwaqsggcri.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_tElx3P7KYXfYsqzsn2R7_g_lWT0yulK";

// ─── SESIÓN ──────────────────────────────────────────────────────────────────
//
// `/api/login` verifica el PIN y devuelve un token firmado con el secreto JWT
// del proyecto. Desde ese momento cada consulta lo lleva, y las políticas RLS
// leen de él quién es y qué perfiles tiene. Sin token, la base no devuelve nada.
//
// ── Por qué el token vive solo en memoria ───────────────────────────────────
//
// No se guarda en localStorage ni en sessionStorage. Dos razones:
//
//   1. Un token en localStorage sobrevive al cierre del navegador, y varias
//      socias usan el computador de la casa o del centro comunitario. La sesión
//      de una no debe seguir abierta para la siguiente persona que se siente.
//   2. Es la única forma de que un XSS no se lo pueda llevar para usarlo después.
//
// El costo es que recargar la página obliga a entrar de nuevo — que es
// exactamente lo que ya pasaba antes de esta capa, porque el usuario vivía en el
// estado de React. No se pierde nada que se tuviera.
//
// ── Por qué se inyecta con un fetch propio ──────────────────────────────────
//
// `supabase.auth.setSession()` espera un par de tokens emitidos por Supabase
// Auth y un refresh token que acá no existe. Envolver `fetch` es la forma
// directa de poner el encabezado: el cliente se crea una sola vez y el token
// puede cambiar después sin reconstruirlo.

let sesionToken = null;

// Si Supabase RECHAZA el token —no si lo acepta y las políticas niegan, eso es
// un 403— el problema es la firma, y hay un solo motivo probable: el proyecto
// no usa el secreto simétrico con que /api/login está firmando. Algunos
// proyectos nuevos firman con claves asimétricas y el secreto HS256 ya no vale.
//
// Se guarda acá para que la interfaz lo pueda decir con nombre. Sin esto el
// síntoma es que nada carga y no hay ninguna pista de por qué.
let tokenRechazado = null;
export const getTokenRechazado = () => tokenRechazado;

export function setSesion(token) { sesionToken = token || null; tokenRechazado = null; }
export function cerrarSesion() { sesionToken = null; tokenRechazado = null; }
export const haySesion = () => !!sesionToken;

// Cuando hay sesión se manda el token del usuario; cuando no, la clave pública.
// `apikey` va siempre: Supabase la exige para enrutar el proyecto, y con RLS
// encendido por sí sola no autoriza nada.
const fetchConSesion = async (input, init = {}) => {
  const headers = new Headers(init.headers || {});
  headers.set('apikey', SUPABASE_ANON_KEY);
  headers.set('Authorization', 'Bearer ' + (sesionToken || SUPABASE_ANON_KEY));
  const res = await fetch(input, { ...init, headers });

  if (res.status === 401 && sesionToken) {
    const copia = res.clone();
    let msg = '';
    try { msg = (await copia.json()).message || ''; } catch { /* sin cuerpo JSON */ }
    if (/jwt|token|signature|expired/i.test(msg) || !msg) {
      tokenRechazado = /expired/i.test(msg)
        ? 'La sesión venció. Vuelve a entrar.'
        : 'Supabase rechazó la sesión firmada (' + (msg || 'JWT inválido') + '). ' +
          'Lo más probable es que SUPABASE_JWT_SECRET no coincida con el secreto del proyecto, ' +
          'o que el proyecto firme con claves asimétricas y no con el secreto HS256.';
      console.error('supabase:', tokenRechazado);
    }
  }
  return res;
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // No hay usuarios de Supabase Auth en este proyecto: la sesión la emite
    // /api/login. Sin esto, la librería intentaría refrescar una sesión que no
    // existe y escribiría en localStorage.
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: { fetch: fetchConSesion },
});

// ─── PANTALLA DE INGRESO ─────────────────────────────────────────────────────
//
// Antes de entrar no hay sesión, así que con RLS encendido el navegador no puede
// leer `families`. Pero para entrar hay que poder elegir su nombre de una lista.
// `/api/portada` resuelve ese huevo-y-gallina devolviendo solo nombres,
// iniciales y si cada uno tiene PIN — ni correos, ni saldos.
//
// En local (`npm start`) no hay funciones serverless: se cae a leer la base
// directo, que es lo que se podía hacer antes. Sin eso no habría manera de
// trabajar en el proyecto.
export async function getPortada() {
  try {
    const res = await fetch('/api/portada');
    if (res.ok) {
      const d = await res.json();
      return {
        // `tienePin` es el nombre honesto de lo que devuelve el servidor (un
        // booleano, no la fecha). Se expone también como `pin_set_at` porque es
        // lo que la pantalla de ingreso ya consulta, y su fecha exacta no le
        // hace falta a nadie ahí.
        familias: (d.familias || []).map(f => ({ ...f, pin_set_at: f.tienePin ? true : null })),
        period: d.period || null,
      };
    }
    if (res.status !== 404) {
      console.error('getPortada: HTTP', res.status);
      return { familias: [], period: null, error: 'No se pudo cargar la pantalla de ingreso.' };
    }
  } catch (e) {
    if (!EN_LOCAL) {
      console.error('getPortada:', e.message);
      return { familias: [], period: null, error: 'No se pudo cargar la pantalla de ingreso.' };
    }
  }

  // Respaldo local: sin /api, se lee la base como antes.
  console.warn('getPortada: sin /api/portada (¿npm start?), leyendo la base directamente');
  const [familias, period] = await Promise.all([getFamilies(), getPeriod()]);
  return { familias, period, local: true };
}

// Columnas explícitas, nunca select('*'). Con '*' viajaban `pin` (texto plano) y
// `pin_hash` al navegador de cualquiera que abriera el sitio. Para saber si una
// familia tiene PIN basta `pin_set_at`, que no revela nada.
const FAMILY_COLS = 'id,name,initials,balance,role,email,email2,created_at,pin_set_at,last_login_at';

// Cascada de columnas, de la más completa a la más antigua. Las migraciones se
// ejecutan a mano y pueden ir por detrás del despliegue: si pidiéramos siempre
// el conjunto completo, la app se quedaría sin familias y nadie podría entrar.
// Cada nivel quita lo que aporta una migración que quizá aún no corrió.
const FAMILY_COLS_CASCADA = [
  FAMILY_COLS + ',roles',  // con 005 (perfiles múltiples)
  FAMILY_COLS,             // con 003 (PIN cifrado)
  'id,name,initials,balance,role,email,email2,created_at', // esquema original
];

export async function getFamilies() {
  for (let i = 0; i < FAMILY_COLS_CASCADA.length; i++) {
    const { data, error } = await supabase.from('families').select(FAMILY_COLS_CASCADA[i]);
    if (!error) return data || [];
    if (i < FAMILY_COLS_CASCADA.length - 1) {
      console.warn('getFamilies: faltan columnas de una migración, reintentando con menos:', error.message);
    } else {
      console.error('getFamilies error:', error.message);
    }
  }
  return [];
}

export async function updateFamilyRoles(familyId, roles) {
  // `role` (valor único) se mantiene sincronizado con la lista para no romper el
  // código que todavía lo lee. Se podrá eliminar cuando nada dependa de él.
  const legacy = roles.includes('admin') ? 'admin' : 'familia';
  const { data, error } = await supabase
    .from('families')
    .update({ roles, role: legacy })
    .eq('id', familyId)
    .select()
    .single();
  if (error) { console.error('updateFamilyRoles error:', error.message); return { error: error.message }; }
  return data;
}

// `npm start` levanta solo el servidor de React, que no ejecuta la carpeta /api:
// cualquier llamada a un endpoint devuelve 404. Sin esto, trabajar en local sería
// imposible porque nadie podría entrar.
const EN_LOCAL = typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1', '::1', ''].includes(window.location.hostname);

// El PIN se verifica en el servidor. Devuelve { family } o { error }.
export async function loginFamily(familyId, pin) {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ familyId, pin: pin || null }),
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* no era JSON */ }

    // 404 = el endpoint no existe. En local se deja pasar; en producción jamás,
    // porque ahí un 404 significa que algo se rompió, no que falte el backend.
    if (res.status === 404 && EN_LOCAL) {
      console.warn('loginFamily: /api/login no existe (npm start no ejecuta /api). Acceso sin verificar PIN. Usa `vercel dev` para probarlo de verdad.');
      return { ok: true, sinVerificar: true };
    }

    if (!res.ok) {
      return {
        error: (body && body.error) || 'No se pudo verificar el acceso (' + res.status + ' desde ' + window.location.origin + ')',
        necesitaPin: body && body.necesitaPin,
      };
    }
    // Desde acá, cada consulta a la base va firmada como esta familia. Se
    // guarda antes de devolver: si el componente hiciera una consulta al
    // renderizar, ya tiene que ir identificada.
    if (body && body.token) setSesion(body.token);

    return body || { error: 'Respuesta vacía del servidor' };
  } catch (e) {
    if (EN_LOCAL) {
      console.warn('loginFamily: sin backend en local, acceso sin verificar PIN.');
      return { ok: true, sinVerificar: true };
    }
    return { error: 'No se pudo contactar al servidor: ' + e.message };
  }
}

// Cifrar exige el servidor, así que el panel no escribe la columna directamente.
//
// Manda la sesión: `/api/set-pin` usa la clave de servicio y se salta RLS, así
// que tiene que comprobar quién llama. Solo Administración puede cambiarle el
// PIN a otra familia; cada una puede cambiar el suyo.
export async function setFamilyPin(familyId, pin) {
  try {
    const res = await fetch('/api/set-pin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sesionToken ? { Authorization: 'Bearer ' + sesionToken } : {}),
      },
      body: JSON.stringify({ familyId, pin: pin || null }),
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* no era JSON */ }
    if (!res.ok) return { error: (body && body.error) || 'No se pudo guardar el PIN (' + res.status + ')' };
    return body || { error: 'Respuesta vacía del servidor' };
  } catch (e) {
    return { error: 'No se pudo contactar al servidor: ' + e.message };
  }
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
  ['date_from', 'date_to', 'date_delivery', 'date_adjust_until', 'date_confirm_until', 'orders_closed_at'].forEach(k => {
    if (k in clean && clean[k] === '') clean[k] = null;
  });
  let { data, error } = await supabase
    .from('periods')
    .update(clean)
    .eq('id', periodId)
    .select()
    .single();

  // Si falta la migración 006 la columna no existe todavía. Guardamos el resto
  // igual: perder las fechas por una columna nueva sería peor que no cerrar.
  if (error && 'orders_closed_at' in clean && /orders_closed_at/.test(error.message || '')) {
    const { orders_closed_at, ...resto } = clean;
    const reintento = await supabase.from('periods').update(resto).eq('id', periodId).select().single();
    if (!reintento.error) return { ...reintento.data, _faltaMigracion: '006' };
    error = reintento.error;
  }

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
  if (error) {
    console.error('addBodegaAssignment error:', error.message);
    // El motivo del rechazo tiene que llegar a la pantalla. El trigger de la
    // migración 012 rechaza una reserva que supere el stock con un mensaje
    // escrito para una persona («Solo quedan 3 kg de Papas…»); mostrarlo como
    // «revisa la conexión» mandaría a buscar un problema que no existe.
    return { error: error.message };
  }
  return data;
}

export async function deleteBodegaAssignment(id) {
  const { error } = await supabase.from('bodega_assignments').delete().eq('id', id);
  if (error) console.error('deleteBodegaAssignment error:', error.message);
  return !error;
}

// Las funciones de las tablas `inventory` y `movements` se eliminaron el
// 18-sep-2026: código muerto de un intento anterior de llevar inventario.
// Verificado contra el respaldo antes de borrarlas — cero filas en ambas tablas
// y ningún llamador en toda la aplicación.
//
// Se evaluó reaprovecharlas para las mermas de la etapa 7 y no convenía:
// `movements` no tiene `period_id` —y acá todo se contabiliza por período— ni
// campo de motivo, ni vínculo con el ítem de bodega del que se descuenta.
// Habría que alterarlas hasta dejarlas irreconocibles conservando el nombre de
// un diseño que no era para esto. Ver `bodega_bajas` en la migración 009.


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

// Registra la respuesta de un proveedor que no usó el enlace: la comisión lo
// llamó y anota lo que dijo. Queda escrito quién lo anotó, porque una respuesta
// de segunda mano no vale lo mismo que una que dio el proveedor — y el indicador
// de cumplimiento las cuenta por separado.
export async function confirmarOrdenManual(orderId, { lines, nota, usuario }) {
  const base = {
    status: 'confirmada',
    lines,
    confirmed_at: new Date().toISOString(),
    provider_note: (nota || '').trim() || null,
  };
  const conAutor = {
    ...base,
    confirmed_source: 'comision',
    confirmed_by: usuario ? usuario.id : null,
    confirmed_by_name: usuario ? usuario.name : null,
  };

  let { data, error } = await supabase
    .from('purchase_orders').update(conAutor).eq('id', orderId).select().single();

  // Sin la migración 006 no existen las columnas de autoría. Guardar la
  // confirmación sin firma es mejor que no poder registrarla, pero hay que
  // decirlo: quien llama muestra el aviso de migración pendiente.
  if (error && /confirmed_(source|by)/.test(error.message || '')) {
    const r = await supabase.from('purchase_orders').update(base).eq('id', orderId).select().single();
    if (!r.error) return { ...r.data, _sinFirma: true };
    error = r.error;
  }

  if (error) { console.error('confirmarOrdenManual error:', error.message); return { error: error.message }; }
  return data;
}

// Llama a la función serverless. Devuelve { ok, ... } o { error }.
export async function sendPurchaseOrder(payload) {
  try {
    const res = await fetch('/api/enviar-orden', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sesionToken ? { Authorization: 'Bearer ' + sesionToken } : {}),
      },
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

// ─── AJUSTES DE PEDIDO (faltantes, extras, no confirmados) ───────────────────
// Convención de signo: amount = cuánto cambia lo que la familia DEBE.
//   negativo → debe menos (no llegó)   ·   positivo → debe más (se llevó extra)
// Total a pagar = pedido.total + cargo + suma(ajustes.amount)

export async function getAdjustments(periodId) {
  const { data, error } = await supabase
    .from('order_adjustments')
    .select('*')
    .eq('period_id', periodId)
    .order('created_at', { ascending: false });
  // null (no []) cuando la tabla aún no existe: quien llama necesita poder
  // distinguir "no hay ajustes" de "falta la migración 004".
  if (error) { console.error('getAdjustments error:', error.message); return null; }
  return data || [];
}

export async function addAdjustment(adj) {
  const { data, error } = await supabase.from('order_adjustments').insert([adj]).select().single();
  if (error) { console.error('addAdjustment error:', error.message); return { error: error.message }; }
  return data;
}

// Varios de una vez (la confirmación del proveedor genera uno por familia).
//
// No se usa upsert a propósito. El índice que protege contra descuentos
// duplicados es PARCIAL —solo cubre los 'no_confirmado', porque una familia sí
// puede tener un faltante y un extra del mismo producto— y Postgres exige
// repetir ese WHERE en el ON CONFLICT, cosa que PostgREST no sabe mandar.
// Pedirlo devuelve "there is no unique or exclusion constraint matching the
// ON CONFLICT specification".
//
// Quien llama ya filtra los que existen, así que el insert directo basta. El
// índice queda de última barrera para dos personas aplicando a la vez: si
// choca, se reintenta uno por uno y los repetidos simplemente se saltan.
export async function addAdjustmentsBulk(adjs) {
  if (!adjs.length) return [];

  const { data, error } = await supabase.from('order_adjustments').insert(adjs).select();
  if (!error) return data || [];

  const duplicado = e => e && (e.code === '23505' || /duplicate key|already exists/i.test(e.message || ''));
  if (!duplicado(error)) {
    console.error('addAdjustmentsBulk error:', error.message);
    return { error: error.message };
  }

  const guardados = [];
  for (const a of adjs) {
    const r = await supabase.from('order_adjustments').insert([a]).select().single();
    if (!r.error) { guardados.push(r.data); continue; }
    if (duplicado(r.error)) continue;  // ya lo aplicó alguien más
    console.error('addAdjustmentsBulk error:', r.error.message);
    return { error: r.error.message };
  }
  return guardados;
}

export async function updateAdjustment(id, updates) {
  const { data, error } = await supabase.from('order_adjustments').update(updates).eq('id', id).select().single();
  if (error) { console.error('updateAdjustment error:', error.message); return { error: error.message }; }
  return data;
}

export async function deleteAdjustment(id) {
  const { error } = await supabase.from('order_adjustments').delete().eq('id', id);
  if (error) { console.error('deleteAdjustment error:', error.message); return { error: error.message }; }
  return true;
}

// Marca un pedido como cobrado. El cierre de período lo usa para no cobrar dos
// veces si falla a la mitad y hay que reintentar.
export async function markOrderCharged(orderId, amount) {
  const { data, error } = await supabase
    .from('sealed_orders')
    .update({ charged_at: new Date().toISOString(), charged_amount: amount })
    .eq('id', orderId)
    .select()
    .single();
  if (error) { console.error('markOrderCharged error:', error.message); return { error: error.message }; }
  return data;
}

// Histórico completo, para la analítica de cumplimiento de proveedores.
export async function getAllPurchaseOrders() {
  const { data, error } = await supabase.from('purchase_orders').select('*').order('created_at', { ascending: true });
  if (error) { console.error('getAllPurchaseOrders error:', error.message); return []; }
  return data || [];
}

export async function getAllAdjustments() {
  const { data, error } = await supabase.from('order_adjustments').select('*').order('created_at', { ascending: true });
  if (error) { console.error('getAllAdjustments error:', error.message); return []; }
  return data || [];
}

// ─── CARGOS FIJOS DEL PERÍODO Y EXENCIONES ───────────────────────────────────
//
// Migración 007. Igual que con los ajustes, `null` cuando la tabla no existe:
// quien llama tiene que poder distinguir "este período no tiene cargos" de
// "falta ejecutar la migración", porque en el primer caso no se cobra nada y en
// el segundo hay que seguir leyendo `periods.fixed_charge`.

export async function getPeriodCharges(periodId) {
  const { data, error } = await supabase
    .from('period_charges')
    .select('*')
    .eq('period_id', periodId)
    .order('sort', { ascending: true });
  if (error) { console.error('getPeriodCharges error:', error.message); return null; }
  return data || [];
}

export async function getChargeExemptions(periodId) {
  const { data, error } = await supabase
    .from('charge_exemptions')
    .select('*')
    .eq('period_id', periodId);
  if (error) { console.error('getChargeExemptions error:', error.message); return null; }
  return data || [];
}

export async function addPeriodCharge(charge) {
  const { data, error } = await supabase.from('period_charges').insert([charge]).select().single();
  if (error) {
    console.error('addPeriodCharge error:', error.message);
    const dup = error.code === '23505' || /duplicate key|already exists/i.test(error.message || '');
    return { error: dup ? 'Ya existe un cargo con ese nombre en este período.' : error.message };
  }
  return data;
}

export async function updatePeriodCharge(id, updates) {
  const { data, error } = await supabase.from('period_charges').update(updates).eq('id', id).select().single();
  if (error) {
    console.error('updatePeriodCharge error:', error.message);
    const dup = error.code === '23505' || /duplicate key|already exists/i.test(error.message || '');
    return { error: dup ? 'Ya existe un cargo con ese nombre en este período.' : error.message };
  }
  return data;
}

// Borra el cargo y, en cascada, sus exenciones (lo hace la FK de la migración).
export async function deletePeriodCharge(id) {
  const { error } = await supabase.from('period_charges').delete().eq('id', id);
  if (error) { console.error('deletePeriodCharge error:', error.message); return { error: error.message }; }
  return true;
}

export async function addChargeExemption(exemption) {
  const { data, error } = await supabase.from('charge_exemptions').insert([exemption]).select().single();
  if (error) {
    console.error('addChargeExemption error:', error.message);
    const dup = error.code === '23505' || /duplicate key|already exists/i.test(error.message || '');
    return { error: dup ? 'Esa familia ya estaba eximida de este cargo.' : error.message };
  }
  return data;
}

export async function deleteChargeExemption(id) {
  const { error } = await supabase.from('charge_exemptions').delete().eq('id', id);
  if (error) { console.error('deleteChargeExemption error:', error.message); return { error: error.message }; }
  return true;
}

// Copia los cargos de un período al siguiente. Se llama al crear un período,
// porque la alternativa —tipear los mismos cuatro cargos cada mes— termina en
// que alguien olvida uno y el cierre no cuadra.
//
// Las EXENCIONES no se copian. Eximir a una familia es una decisión sobre plata
// que alguien tomó para un ciclo concreto; arrastrarla en silencio significaría
// que una familia deja de pagar durante meses sin que nadie lo vuelva a decidir.
export async function copyChargesToPeriod(fromPeriodId, toPeriodId) {
  const origen = await getPeriodCharges(fromPeriodId);
  if (origen === null) return { error: 'falta_migracion' };
  if (!origen.length) return [];

  const copias = origen.map(c => ({
    period_id: toPeriodId,
    name: c.name,
    amount: c.amount,
    note: c.note,
    sort: c.sort,
  }));
  const { data, error } = await supabase.from('period_charges').insert(copias).select();
  if (error) { console.error('copyChargesToPeriod error:', error.message); return { error: error.message }; }
  return data || [];
}

// Deshacer un retiro marcado por error.
//
// No se borra el rastro de que ocurrió: `retired_at` vuelve a null porque la
// entrega no pasó, pero el registro de quién lo deshizo va al log de actividad,
// que es donde vive el resto de las correcciones del panel. Un retiro marcado
// de más en la familia equivocada le cierra la ventana de ajustes a alguien que
// todavía no recibió su caja.
export async function unmarkRetired(orderId) {
  const { data, error } = await supabase
    .from('sealed_orders')
    .update({ retired: false, retired_at: null })
    .eq('id', orderId)
    .select()
    .single();
  if (error) { console.error('unmarkRetired error:', error.message); return { error: error.message }; }
  return data;
}

// ─── FORMATO DE VENTA Y CARGA MASIVA DE PRECIOS ──────────────────────────────
// Migración 008.

// Normaliza el formato de venta de varios productos. NO toca `unit`: esa sigue
// siendo la etiqueta humana ("24 rollos"), y estas dos columnas son la versión
// con la que se calcula. Ver el encabezado de la migración 008.
export async function normalizarFormatos(cambios) {
  if (!cambios.length) return [];
  const hechos = [];
  for (const c of cambios) {
    const { data, error } = await supabase
      .from('products')
      .update({ format_qty: c.qty, format_unit: c.unit })
      .eq('id', c.id)
      .select()
      .single();
    if (error) {
      console.error('normalizarFormatos error:', error.message);
      // La restricción de la 008 rechaza una unidad que no sea canónica. Eso es
      // un error del código que llama, no algo que el usuario pueda arreglar.
      if (/format_unit|format_qty|column/.test(error.message)) {
        return { error: /column/.test(error.message)
          ? 'Falta ejecutar db/migrations/008_formato_de_venta.sql en Supabase.'
          : error.message, hechos };
      }
      return { error: error.message, hechos };
    }
    hechos.push(data);
  }
  return hechos;
}

// Aplica precios nuevos, dejando en `price_history` el precio ANTERIOR.
//
// Uno por uno y no en lote a propósito: si falla a la mitad hay que poder decir
// exactamente cuáles se aplicaron. Un lote que falla deja al usuario sin saber
// si tiene que volver a importar todo o nada.
//
// El historial se escribe DESPUÉS del precio, y si falla no se aborta: perder el
// registro de un cambio es malo, pero dejar el maestro a medio actualizar
// porque una tabla de auditoría no existe todavía es peor.
export async function aplicarPrecios(cambios, { batchId, quien, quienNombre, source = 'importacion', note = null } = {}) {
  const hechos = [];
  const fallidos = [];
  let sinHistorial = false;

  for (const c of cambios) {
    const { data, error } = await supabase
      .from('products')
      .update({ price: c.precio })
      .eq('id', c.id)
      .select()
      .single();

    if (error) {
      console.error('aplicarPrecios error:', error.message);
      fallidos.push({ ...c, error: error.message });
      continue;
    }
    hechos.push(data);

    const h = await supabase.from('price_history').insert([{
      product_id: c.id,
      price_before: c.precioAnterior,
      price_after: c.precio,
      source,
      batch_id: batchId || null,
      changed_by: quien || null,
      changed_by_name: quienNombre || null,
      note,
    }]);
    if (h.error) sinHistorial = true;
  }

  return { hechos, fallidos, sinHistorial };
}

export async function getPriceHistory(productId = null, limite = 200) {
  let q = supabase.from('price_history').select('*').order('created_at', { ascending: false }).limit(limite);
  if (productId != null) q = q.eq('product_id', productId);
  const { data, error } = await q;
  // null cuando la tabla no existe: quien llama distingue "sin cambios" de
  // "falta la migración".
  if (error) { console.error('getPriceHistory error:', error.message); return null; }
  return data || [];
}

// Deshacer una importación completa. Es la red que hace tolerable cambiar
// ochenta precios de una vez: sin vuelta atrás, nadie se atreve a usarlo.
//
// Solo revierte los productos cuyo precio sigue siendo el que dejó la
// importación. Si alguien lo cambió después a mano, ese cambio es más nuevo y
// pisarlo sería descartar una decisión posterior sin avisar.
export async function revertirImportacion(batchId) {
  const { data: filas, error } = await supabase
    .from('price_history').select('*').eq('batch_id', batchId);
  if (error) { console.error('revertirImportacion error:', error.message); return { error: error.message }; }
  if (!filas || !filas.length) return { error: 'No se encontró esa importación.' };

  const revertidos = [], saltados = [];
  for (const f of filas) {
    const { data: prod } = await supabase.from('products').select('id,name,price').eq('id', f.product_id).single();
    if (!prod) { saltados.push({ ...f, motivo: 'el producto ya no existe' }); continue; }
    if (Number(prod.price) !== Number(f.price_after)) {
      saltados.push({ ...f, nombre: prod.name, precioActual: prod.price, motivo: 'cambió después de la importación' });
      continue;
    }
    const r = await supabase.from('products').update({ price: f.price_before }).eq('id', f.product_id).select().single();
    if (r.error) { saltados.push({ ...f, nombre: prod.name, motivo: r.error.message }); continue; }
    revertidos.push(r.data);
    await supabase.from('price_history').insert([{
      product_id: f.product_id,
      price_before: f.price_after,
      price_after: f.price_before,
      source: 'reversion',
      batch_id: batchId + '-revertido',
      note: 'Reversión de la importación ' + batchId,
    }]);
  }
  return { revertidos, saltados };
}

// ─── BAJAS DE BODEGA: MERMAS, REGALOS Y SOBRANTES ────────────────────────────
// Migración 009.

export async function getBajas(periodId) {
  const { data, error } = await supabase
    .from('bodega_bajas')
    .select('*')
    .eq('period_id', periodId)
    .order('created_at', { ascending: false });
  // null cuando la tabla no existe: la pantalla tiene que poder decir "falta la
  // migración" en vez de "no hay mermas", que es una afirmación distinta.
  if (error) { console.error('getBajas error:', error.message); return null; }
  return data || [];
}

// Registra la baja y, si el motivo cuesta plata, el egreso en el flujo de caja.
//
// El egreso va DESPUÉS de la baja, y si falla no se aborta: la baja es el hecho
// —el producto ya no está— y el egreso es su consecuencia contable. Dejar el
// stock mal por una tabla de caja que no existe sería peor. Se devuelve
// `sinCaja` para que la pantalla lo diga en vez de callarlo.
//
// `cash_flow_id` queda guardado en la baja para poder deshacerla sin dejar un
// egreso huérfano en el flujo.
export async function addBaja(baja, { cuestaPlata, periodLabel } = {}) {
  const cashFlowId = cuestaPlata ? 'baja-' + Date.now().toString(36) : null;

  const { data, error } = await supabase
    .from('bodega_bajas')
    .insert([{ ...baja, cash_flow_id: cashFlowId }])
    .select()
    .single();

  if (error) {
    console.error('addBaja error:', error.message);
    return {
      error: /relation|does not exist|schema cache/.test(error.message)
        ? 'Falta ejecutar db/migrations/009_mermas_regalos_sobrantes.sql en Supabase.'
        : error.message,
    };
  }

  let sinCaja = false;
  if (cuestaPlata && baja.amount > 0) {
    const r = await supabase.from('cash_flow').insert([{
      id: cashFlowId,
      period_id: baja.period_id,
      type: 'egreso',
      description: 'Bodega · ' + baja.product_name + ' (' + baja.quantity + ' ' + (baja.unit || '') + ') — ' + baja.note,
      amount: baja.amount,
      date: new Date().toISOString().split('T')[0],
      family_id: null,
      family_name: null,
    }]);
    if (r.error) { console.error('addBaja (cash_flow) error:', r.error.message); sinCaja = true; }
  }

  return { baja: data, sinCaja };
}

// Deshacer. Devuelve el stock y borra el egreso que había generado, para que el
// flujo de caja no quede afirmando una pérdida que se revirtió.
export async function deleteBaja(baja) {
  const { error } = await supabase.from('bodega_bajas').delete().eq('id', baja.id);
  if (error) { console.error('deleteBaja error:', error.message); return { error: error.message }; }

  if (baja.cash_flow_id) {
    const r = await supabase.from('cash_flow').delete().eq('id', baja.cash_flow_id);
    if (r.error) {
      console.error('deleteBaja (cash_flow) error:', r.error.message);
      // La baja ya no está; el egreso quedó. Se avisa en vez de callarlo, porque
      // el flujo de caja va a mostrar una pérdida sin respaldo y alguien va a
      // tener que borrarla a mano.
      return { ok: true, egresoHuerfano: baja.cash_flow_id };
    }
  }
  return { ok: true };
}

export async function getAllBajas() {
  const { data, error } = await supabase.from('bodega_bajas').select('*').order('created_at', { ascending: true });
  if (error) { console.error('getAllBajas error:', error.message); return []; }
  return data || [];
}

// ─── RESERVAS DE BODEGA: EL SALDO LO MUEVE LA BASE ───────────────────────────
//
// Asignar stock de bodega a una familia le carga el monto a su saldo. Ese cargo
// lo escribía el navegador —leía el saldo, restaba, sobrescribía— y con RLS
// encendido una familia ya no puede escribir su propio saldo, así que esa vía
// quedó cerrada. La migración 010 pone un trigger que lo hace en la base, que
// además es atómico: dos personas asignando a la vez ya no pierden un cargo.
//
// Estas dos funciones se adaptan solas: insertan (o borran), vuelven a leer el
// saldo y, si no se movió, aplican el cargo como antes. Así funcionan con la
// migración 010 corrida o sin ella, y nunca cobran dos veces.
//
// El precio es una lectura extra por asignación. A cambio, no hay una versión
// del código que solo funcione después de correr un SQL a mano.

async function saldoActual(familyId) {
  const { data, error } = await supabase.from('families').select('balance').eq('id', familyId).single();
  if (error) { console.error('saldoActual error:', error.message); return null; }
  return data ? Number(data.balance) || 0 : null;
}

export async function asignarBodegaConCargo(assignment, saldoAntes) {
  const creada = await addBodegaAssignment(assignment);
  if (!creada) return { error: 'No se pudo asignar. Revisa la conexión e intenta de nuevo.' };
  // La base rechazó la reserva. El caso normal es que otra familia alcanzó a
  // tomar el stock: el mensaje del trigger ya dice cuánto queda, así que se
  // muestra tal cual en vez de traducirlo a algo más vago.
  if (creada.error) return { error: creada.error, rechazada: true };

  const esperado = (Number(saldoAntes) || 0) - (Number(assignment.total_value) || 0);
  const despues = await saldoActual(assignment.family_id);

  if (despues === null) return { asignacion: creada, balance: esperado, sinConfirmar: true };
  if (despues === esperado) return { asignacion: creada, balance: despues, porTrigger: true };

  // El trigger no está (falta la migración 010): se aplica como antes.
  const r = await updateFamilyBalance(assignment.family_id, esperado);
  if (!r) {
    // Ni trigger ni permiso para escribir. La asignación quedó y el saldo no:
    // hay que decirlo, porque el descalce es de plata.
    return {
      asignacion: creada, balance: despues,
      aviso: 'Se asignó el stock, pero el saldo no se pudo actualizar. Corrígelo en Saldos y ejecuta db/migrations/010_rls_y_sesiones.sql.',
    };
  }
  return { asignacion: creada, balance: esperado };
}

export async function borrarAsignacionConReverso(asn, saldoAntes) {
  const ok = await deleteBodegaAssignment(asn.id);
  if (!ok) return { error: 'No se pudo eliminar la asignación.' };

  const esperado = (Number(saldoAntes) || 0) + (Number(asn.total_value) || 0);
  const despues = await saldoActual(asn.family_id);

  if (despues === null) return { balance: esperado, sinConfirmar: true };
  if (despues === esperado) return { balance: despues, porTrigger: true };

  const r = await updateFamilyBalance(asn.family_id, esperado);
  if (!r) {
    return {
      balance: despues,
      aviso: 'Se eliminó la asignación, pero el saldo no se pudo devolver. Corrígelo en Saldos.',
    };
  }
  return { balance: esperado };
}
