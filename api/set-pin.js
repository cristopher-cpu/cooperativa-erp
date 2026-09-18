// POST /api/set-pin  { familyId, pin }   → asigna o cambia el PIN
// POST /api/set-pin  { familyId, pin: null } → lo quita
//
// El cifrado tiene que ocurrir en el servidor, así que el panel no puede escribir
// la columna directamente. También borra la columna `pin` de texto plano, que
// queda en el esquema solo como resto de la versión anterior.
//
// ── Quién puede llamar (antes: cualquiera) ──────────────────────────────────
//
// Hasta la sesión firmada, este endpoint no verificaba nada, y la advertencia
// que había acá decía que daba igual porque con RLS apagado se podía escribir
// directo a la base de todos modos. **Eso dejó de ser cierto en dos sentidos y
// los dos empeoran el riesgo:**
//
//   · Con RLS encendido, escribir directo a la base ya no se puede — pero esta
//     función sí puede, porque usa la clave de servicio. Se convertiría en la
//     única puerta abierta, y en la peor: quien pudiera llamarla se asignaría el
//     PIN de una administradora y entraría como ella.
//   · El PIN es ahora la credencial de verdad, no una formalidad.
//
// Reglas: hace falta sesión firmada, y solo **Administración** puede tocar el
// PIN de otra persona. Cada familia puede cambiar el suyo.

const { sb } = require('./_lib/db');
const { hashPin, validarPin } = require('./_lib/pin');
const { delRequest, haySecreto } = require('./_lib/sesion');

// Mismo criterio que /api/login y que src/perfiles.js: lo que la cuenta PUEDE
// VER, no la etiqueta heredada de cuando los roles eran uno solo.
function entraAlPanel(f) {
  const roles = Array.isArray(f.roles) && f.roles.length
    ? f.roles
    : (f.role === 'admin' ? ['admin', 'familia'] : ['familia']);
  return roles.some(r => r !== 'familia');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { familyId } = body;
    const pin = body.pin;

    if (!familyId) return res.status(400).json({ error: 'Falta la familia' });

    // ── Quién llama ─────────────────────────────────────────────────────────
    //
    // Si SUPABASE_JWT_SECRET no está configurado, no existe el mecanismo de
    // sesión: nadie puede tener token, así que exigirlo no protegería nada —
    // haría imposible asignar PIN, que es justamente el paso previo a poder
    // encender RLS. Se degrada, igual que la exigencia de PIN en /api/login
    // cuando falta la migración 003: un control que el sistema todavía no puede
    // sostener no lo deja seguro, lo deja inutilizable.
    //
    // No es un agujero nuevo: es exactamente cómo estaba este endpoint antes.
    // Y se cierra solo en cuanto exista la variable.
    const sesion = delRequest(req);
    if (!sesion && haySecreto()) {
      return res.status(401).json({
        error: 'Sesión no válida o vencida. Vuelve a entrar y reinténtalo.',
      });
    }
    if (!sesion) {
      console.warn('set-pin: falta SUPABASE_JWT_SECRET, no se verifica quién llama');
    }
    // Sin sesión (solo posible si falta el secreto, por lo de arriba) no hay a
    // quién comparar: se deja pasar, que es el comportamiento anterior.
    if (sesion) {
      const esAdmin = Array.isArray(sesion.roles) && sesion.roles.includes('admin');
      const esSuPropio = String(sesion.family_id) === String(familyId);
      if (!esAdmin && !esSuPropio) {
        return res.status(403).json({
          error: 'Solo Administración puede cambiar el PIN de otra familia.',
        });
      }
    }

    let filas;
    try {
      filas = await sb('/families?select=id,name,role,roles,pin_hash&id=eq.' + encodeURIComponent(familyId) + '&limit=1');
    } catch (e) {
      // Antes de la migración 005 no existe `roles`.
      if (!/roles/.test(e.message || '')) throw e;
      filas = await sb('/families?select=id,name,role,pin_hash&id=eq.' + encodeURIComponent(familyId) + '&limit=1');
    }
    const fam = filas && filas[0];
    if (!fam) return res.status(404).json({ error: 'Esa familia ya no existe' });

    // Quitar el PIN
    if (pin === null || pin === '' || pin === undefined) {
      // Vale para las seis comisiones, no solo para Admin: dejar sin PIN a una
      // cuenta que ve saldos y flujo de caja de toda la cooperativa la deja sin
      // credencial y, además, sin poder entrar — /api/login la rechazaría.
      if (entraAlPanel(fam)) {
        return res.status(400).json({
          error: 'No se puede dejar sin PIN a una cuenta con acceso al panel. Si quieres quitárselo, primero quítale sus perfiles de comisión.',
        });
      }
      await sb('/families?id=eq.' + encodeURIComponent(familyId), {
        method: 'PATCH', body: { pin_hash: null, pin: null, pin_set_at: null },
      });
      return res.status(200).json({ ok: true, tienePin: false });
    }

    const err = validarPin(pin);
    if (err) return res.status(400).json({ error: err });

    await sb('/families?id=eq.' + encodeURIComponent(familyId), {
      method: 'PATCH',
      body: {
        pin_hash: hashPin(pin),
        pin: null, // se elimina el texto plano heredado
        pin_set_at: new Date().toISOString(),
      },
    });

    return res.status(200).json({ ok: true, tienePin: true });
  } catch (e) {
    console.error('set-pin:', e);
    // El error de PostgREST por columna inexistente es incomprensible para quien
    // está en el panel; se traduce a algo accionable.
    if (/pin_hash|pin_set_at/.test(e.message || '')) {
      return res.status(409).json({
        error: 'Falta ejecutar la migración en Supabase (db/migrations/003_pin_cifrado.sql). Hasta entonces no se pueden guardar PIN.',
      });
    }
    return res.status(500).json({ error: 'No se pudo guardar el PIN. Intenta de nuevo.' });
  }
};
