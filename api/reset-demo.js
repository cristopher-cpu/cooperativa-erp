// POST /api/reset-demo  →  resetea el período de demo (solo para Admin)
//
// Borra todos los movimientos (pedidos, órdenes, etc.) del período "Prueba MVP"
// y resetea los saldos de todas las familias a 0.
// Solo accesible para usuarios con perfil Admin.

const { sb } = require('./_lib/db');
const { delRequest, haySecreto } = require('./_lib/sesion');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    // Verificar que quien llama es Admin
    const sesion = delRequest(req);

    if (!sesion && haySecreto()) {
      return res.status(401).json({
        error: 'Sesión no válida. Vuelve a entrar y reinténtalo.',
      });
    }

    if (sesion) {
      const esAdmin = Array.isArray(sesion.roles)
        ? sesion.roles.includes('admin')
        : sesion.role === 'admin';

      if (!esAdmin) {
        return res.status(403).json({
          error: 'Solo administración puede hacer reset de la demo.',
        });
      }
    }

    // Buscar o crear período "Prueba MVP"
    const periodId = 'P_DEMO';
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysLater = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    // Intentar actualizar el período (si existe, activarlo; si no, será un error de RLS)
    try {
      await sb(`/periods?id=eq.${encodeURIComponent(periodId)}`, 'PATCH', {
        active: true,
      });
    } catch (e) {
      // Si no existe, crearlo
      if (e.status === 404 || /not found/i.test(e.message)) {
        await sb('/periods', 'POST', {
          id: periodId,
          label: 'Prueba MVP',
          active: true,
          date_from: today,
          date_to: thirtyDaysLater,
          created_at: new Date().toISOString(),
        });
      } else {
        throw e;
      }
    }

    // Borrar todos los movimientos del período (el orden importa)
    const tables = [
      'bodega_bajas',
      'bodega_assignments',
      'bodega',
      'order_adjustments',
      'purchase_orders',
      'cash_flow',
      'sealed_orders',
    ];

    for (const table of tables) {
      try {
        await sb(
          `/${table}?period_id=eq.${encodeURIComponent(periodId)}`,
          { method: 'DELETE' }
        );
      } catch (e) {
        // Ignorar errores si la tabla no tiene datos o no existe
        console.warn(`Warning deleting ${table}:`, e.message);
      }
    }

    // Reabrir la ventana de pedidos
    try {
      await sb(
        `/periods?id=eq.${encodeURIComponent(periodId)}`,
        { method: 'PATCH', body: { orders_closed_at: null } }
      );
    } catch (e) {
      console.warn('Warning reopening orders:', e.message);
    }

    // Resetear saldos de todas las familias a 0
    try {
      await sb('/families', { method: 'PATCH', body: { balance: 0 } });
    } catch (e) {
      console.warn('Warning resetting balances:', e.message);
    }

    return res.status(200).json({
      ok: true,
      period: periodId,
      message: 'Demo reseteada exitosamente. El período Prueba MVP está listo.',
    });
  } catch (error) {
    console.error('Error en reset-demo:', error);
    return res.status(500).json({
      error: error.message || 'Error interno del servidor',
    });
  }
};
