// POST /api/login  { familyId, pin }
//
// Verifica el PIN EN EL SERVIDOR. Antes la comparación ocurría en App.js, con el
// PIN en texto plano que getFamilies() mandaba al navegador de cualquiera: quien
// abriera las herramientas de desarrollo veía todos los PIN de la cooperativa.
//
// Limitación conocida: mientras RLS siga apagado, alguien con la clave pública
// puede leer y escribir las tablas sin pasar por aquí. Esto cierra el acceso por
// la interfaz, no el acceso directo a la base.

const { sb } = require('./_lib/db');
const { verifyPin } = require('./_lib/pin');

// Contador de intentos en memoria. Se pierde cuando la función se apaga, y no se
// comparte entre instancias: no es una defensa sólida, es un freno para que un
// PIN de 4 dígitos no se pueda barrer en segundos desde un script.
const intentos = new Map();
const MAX_INTENTOS = 8;
const VENTANA_MS = 10 * 60 * 1000;

function registrarFallo(clave) {
  const ahora = Date.now();
  const prev = intentos.get(clave);
  if (!prev || ahora - prev.desde > VENTANA_MS) {
    intentos.set(clave, { n: 1, desde: ahora });
    return 1;
  }
  prev.n += 1;
  return prev.n;
}

function bloqueado(clave) {
  const prev = intentos.get(clave);
  if (!prev) return false;
  if (Date.now() - prev.desde > VENTANA_MS) { intentos.delete(clave); return false; }
  return prev.n >= MAX_INTENTOS;
}

// ¿La base ya tiene las columnas de la migración 003?
//
// Sin esto, exigir PIN a los administradores deja a TODO EL MUNDO fuera cuando la
// migración aún no ha corrido: no hay dónde guardar el PIN, así que ningún admin
// puede tener uno, así que ninguno puede entrar — y asignar un PIN exige estar
// dentro. Un control de seguridad que la base todavía no puede sostener no debe
// aplicarse: no deja el sistema seguro, lo deja inutilizable. La exigencia se
// enciende sola en cuanto exista la columna.
let soportaPinCache = null;
async function soportaPin() {
  if (soportaPinCache !== null) return soportaPinCache;
  try {
    await sb('/families?select=pin_hash&limit=1');
    soportaPinCache = true;
  } catch {
    soportaPinCache = false;
  }
  return soportaPinCache;
}

// Lo que se devuelve al navegador. Nunca pin ni pin_hash.
function familiaPublica(f) {
  return {
    id: f.id, name: f.name, initials: f.initials, role: f.role,
    balance: f.balance, email: f.email, email2: f.email2,
    tienePin: !!f.pin_hash,
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { familyId, pin } = body;
    if (!familyId) return res.status(400).json({ error: 'Falta la familia' });

    const clave = String(familyId);
    if (bloqueado(clave)) {
      return res.status(429).json({ error: 'Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.' });
    }

    const filas = await sb('/families?select=*&id=eq.' + encodeURIComponent(clave) + '&limit=1');
    const fam = filas && filas[0];
    if (!fam) return res.status(404).json({ error: 'Esa familia ya no existe' });

    const esAdmin = fam.role === 'admin';
    const conPin = await soportaPin();

    if (!conPin) {
      // Migración 003 pendiente: se mantiene el comportamiento anterior. No abre
      // ningún agujero nuevo — antes de la migración nadie tenía PIN de todos
      // modos — pero evita dejar la cooperativa encerrada fuera.
      console.warn('login: migración 003 pendiente, exigencia de PIN desactivada');
      return res.status(200).json({
        ok: true,
        family: familiaPublica(fam),
        avisoMigracion: 'La migración 003 no ha corrido: el acceso por PIN está inactivo y cualquiera puede entrar. Ejecuta db/migrations/003_pin_cifrado.sql en Supabase.',
      });
    }

    if (!fam.pin_hash) {
      // Un administrador sin PIN es exactamente el agujero que este parche viene
      // a cerrar: no se le deja entrar hasta que alguien le configure uno.
      if (esAdmin) {
        return res.status(403).json({
          error: 'Esta cuenta de administrador no tiene PIN configurado. Por seguridad no puede entrar hasta que se le asigne uno.',
          necesitaPin: true,
        });
      }
      // Las familias sin PIN mantienen el acceso directo de siempre.
      return res.status(200).json({ ok: true, family: familiaPublica(fam) });
    }

    if (!verifyPin(pin, fam.pin_hash)) {
      const n = registrarFallo(clave);
      const restantes = Math.max(0, MAX_INTENTOS - n);
      return res.status(401).json({
        error: restantes > 0 && restantes <= 3
          ? 'PIN incorrecto. Te quedan ' + restantes + ' intentos.'
          : 'PIN incorrecto',
      });
    }

    intentos.delete(clave);
    // No bloqueamos la respuesta por registrar la fecha de acceso.
    sb('/families?id=eq.' + encodeURIComponent(clave), {
      method: 'PATCH', body: { last_login_at: new Date().toISOString() }, prefer: 'return=minimal',
    }).catch(() => {});

    return res.status(200).json({ ok: true, family: familiaPublica(fam) });
  } catch (e) {
    console.error('login:', e);
    return res.status(500).json({ error: 'No se pudo verificar el acceso. Intenta de nuevo.' });
  }
};
