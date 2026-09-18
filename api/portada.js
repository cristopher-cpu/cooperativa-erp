// GET /api/portada
//
// Lo único que la pantalla de ingreso necesita ANTES de que alguien entre: los
// nombres para elegir, si cada uno tiene PIN, y el período activo.
//
// ── Por qué hace falta un endpoint para esto ────────────────────────────────
//
// Con RLS encendido, el navegador sin sesión no puede leer `families`. Pero para
// entrar hay que poder elegir su nombre de una lista, y para eso hay que leer la
// tabla. Es un huevo y una gallina, y las dos salidas posibles son:
//
//   a) Dejar `families` legible para el público. Eso publica correos y saldos de
//      diecisiete familias, que es exactamente el hallazgo crítico que RLS viene
//      a cerrar.
//   b) Un endpoint que devuelva SOLO lo indispensable, desde el servidor.
//
// Es (b). Acá se ve por qué importa: lo que sale de esta función son nombres,
// iniciales y un booleano. **Ni correos, ni saldos, ni pin_hash, ni fechas de
// último acceso.** El listado de nombres de una cooperativa de barrio no es un
// secreto; los saldos de cada familia sí.
//
// ── Por qué devuelve `roles` ────────────────────────────────────────────────
//
// La pantalla separa a las comisiones de las familias y muestra la etiqueta de
// cada una. Es información organizativa, no una credencial: saber que alguien
// está en la Comisión Retiro no ayuda a entrar como ella. Lo que abre la puerta
// es el PIN, y eso no sale de acá.

const { sb } = require('./_lib/db');

// Se cachea un momento porque esta es la petición que recibe TODA visita al
// sitio, incluidos los rastreadores. Treinta segundos alcanzan para que un
// cambio de PIN se vea al recargar y evitan gastar la cuota de Supabase en
// responder diecisiete nombres una y otra vez.
const CACHE_SEGUNDOS = 30;

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    // Columnas explícitas, nunca '*'. Con '*' viajarían correos, saldos y
    // pin_hash a cualquiera que abra la URL de esta función.
    let familias;
    try {
      familias = await sb('/families?select=id,name,initials,pin_set_at,role,roles&order=name');
    } catch (e) {
      // Antes de la migración 005 no existe `roles`. Se reintenta sin ella en
      // vez de dejar la pantalla de ingreso vacía, que sería no poder entrar.
      if (!/roles/.test(e.message || '')) throw e;
      familias = await sb('/families?select=id,name,initials,pin_set_at,role&order=name');
    }

    const periodos = await sb('/periods?select=id,label,month,date_from,date_to,date_delivery,date_confirm_until,date_adjust_until,orders_closed_at,active&active=is.true&limit=1');

    res.setHeader('Cache-Control', 'public, max-age=' + CACHE_SEGUNDOS);
    return res.status(200).json({
      familias: (familias || []).map(f => ({
        id: f.id,
        name: f.name,
        initials: f.initials,
        // Solo si TIENE PIN, no cuándo se lo pusieron: la fecha diría qué
        // cuentas son nuevas, y ésas son las que alguien intentaría primero.
        tienePin: !!f.pin_set_at,
        role: f.role,
        roles: f.roles || undefined,
      })),
      period: (periodos && periodos[0]) || null,
    });
  } catch (e) {
    console.error('portada:', e);
    return res.status(500).json({ error: 'No se pudo cargar la pantalla de ingreso.' });
  }
};
