// POST /api/set-pin  { familyId, pin }   → asigna o cambia el PIN
// POST /api/set-pin  { familyId, pin: null } → lo quita
//
// El cifrado tiene que ocurrir en el servidor, así que el panel no puede escribir
// la columna directamente. También borra la columna `pin` de texto plano, que
// queda en el esquema solo como resto de la versión anterior.
//
// Advertencia honesta: este endpoint no verifica QUIÉN llama, porque la
// aplicación todavía no tiene sesiones. Mientras RLS siga apagado eso da igual —
// quien quisiera abusar puede escribir directo a la base de todos modos. Cuando
// exista autenticación real, aquí va la comprobación de que el que llama es
// administrador.

const { sb } = require('./_lib/db');
const { hashPin, validarPin } = require('./_lib/pin');

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

    const filas = await sb('/families?select=id,name,role,pin_hash&id=eq.' + encodeURIComponent(familyId) + '&limit=1');
    const fam = filas && filas[0];
    if (!fam) return res.status(404).json({ error: 'Esa familia ya no existe' });

    // Quitar el PIN
    if (pin === null || pin === '' || pin === undefined) {
      if (fam.role === 'admin') {
        return res.status(400).json({
          error: 'No se puede dejar sin PIN a un administrador. Si quieres quitárselo, primero pásalo a Familia.',
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
