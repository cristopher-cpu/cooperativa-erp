// GET /api/sellar-vencidos  →  sella los carritos que quedaron sin sellar
//
// Lo llama el cron diario de Vercel (vercel.json), pasada la medianoche de
// Chile. Pedido de la cooperativa (27-sep-2026): si una familia armó su carrito
// y no lo selló, al llegar la fecha límite el sistema lo sella solo.
//
// Todo el trabajo lo hace `coop_sellar_borradores` en la base (migración 013):
// solo actúa sobre períodos cuya ventana de pedidos ya cerró, y es idempotente.
// Por eso da igual si esto corre de más, o si el panel ya lo hizo antes al
// cerrar los pedidos a mano. El plan Hobby de Vercel incluye un cron diario sin
// costo.
//
// Si CRON_SECRET está configurado en Vercel, se exige: Vercel lo manda solo en
// el encabezado Authorization de sus propias llamadas.

const { sb, hayServiceKey } = require('./_lib/db');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const secreto = process.env.CRON_SECRET;
  if (secreto && req.headers.authorization !== 'Bearer ' + secreto) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  if (!hayServiceKey()) {
    return res.status(500).json({ error: 'Falta SUPABASE_SERVICE_ROLE_KEY en Vercel.' });
  }

  try {
    const n = await sb('/rpc/coop_sellar_borradores', { method: 'POST', body: { p_period_id: null } });
    return res.status(200).json({ ok: true, sellados: Number(n) || 0 });
  } catch (e) {
    const falta = /coop_sellar_borradores|function|schema cache/i.test(e.message || '');
    return res.status(falta ? 501 : 500).json({
      error: falta ? 'Falta ejecutar db/migrations/013_saldos_atomicos_y_borradores.sql en Supabase.' : e.message,
    });
  }
};
