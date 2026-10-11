// POST /api/reset-demo  →  DESACTIVADO (27-sep-2026)
//
// Borraba los pedidos del período de prueba y ponía TODOS los saldos en 0 con
// un solo clic desde el panel. Desde el piloto del 2 de octubre los saldos son
// reales (los que informó Ruby), y ese botón a un clic de distancia era una
// forma de perderlos sin vuelta atrás. Además estaba roto: buscaba un período
// con id fijo `P_DEMO` que no es el activo, así que borraba nada y dejaba los
// saldos en cero igual.
//
// El reinicio ahora es un script revisable, en una transacción y con
// comprobaciones antes de borrar: db/RESET-inicio-piloto-mvp.sql.

module.exports = async (req, res) => {
  res.status(410).json({
    error: 'El reinicio desde el panel se desactivó para no borrar saldos reales. ' +
      'Usa db/RESET-inicio-piloto-mvp.sql en el SQL Editor de Supabase.',
  });
};
