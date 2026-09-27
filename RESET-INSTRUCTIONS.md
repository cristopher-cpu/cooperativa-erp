# Resetear Demo para Presentación

**Cuándo usarlo:** Antes de cada presentación para dejar el período limpio, sin pedidos ni retiros, solo con las familias y estructura base.

## Opción 1: Desde Supabase SQL Editor (Recomendado)

1. Entra a [Supabase Console](https://app.supabase.com/project/fihovunxkkkwaqsggcri)
2. Ve a **SQL Editor**
3. Crea una nueva query
4. Copia este script:

```sql
-- RESET: Limpiar período de prueba
BEGIN;

-- 1. Crear período "Prueba MVP" si no existe
INSERT INTO periods (id, label, active, date_from, date_to, created_at)
VALUES ('P_DEMO', 'Prueba MVP', true, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', NOW())
ON CONFLICT (id) DO UPDATE
SET active = true;

-- 2. Borrar todos los movimientos del período
DELETE FROM bodega_bajas WHERE period_id = 'P_DEMO';
DELETE FROM bodega_assignments WHERE period_id = 'P_DEMO';
DELETE FROM bodega WHERE period_id = 'P_DEMO';
DELETE FROM order_adjustments WHERE period_id = 'P_DEMO';
DELETE FROM purchase_orders WHERE period_id = 'P_DEMO';
DELETE FROM cash_flow WHERE period_id = 'P_DEMO';
DELETE FROM sealed_orders WHERE period_id = 'P_DEMO';

-- 3. Reabrir ventana de pedidos
UPDATE periods SET orders_closed_at = NULL WHERE id = 'P_DEMO';

-- 4. Resetear saldos a 0
UPDATE families SET balance = 0;

COMMIT;

-- Verificación
SELECT 
  'Pedidos' as item, (SELECT COUNT(*) FROM sealed_orders WHERE period_id = 'P_DEMO')::text as count
UNION ALL
SELECT 'Ordenes de compra', (SELECT COUNT(*) FROM purchase_orders WHERE period_id = 'P_DEMO')::text
UNION ALL
SELECT 'Ajustes', (SELECT COUNT(*) FROM order_adjustments WHERE period_id = 'P_DEMO')::text
UNION ALL
SELECT 'Bodega items', (SELECT COUNT(*) FROM bodega WHERE period_id = 'P_DEMO')::text
UNION ALL
SELECT 'Cash flow', (SELECT COUNT(*) FROM cash_flow WHERE period_id = 'P_DEMO')::text;
```

5. Haz clic en **Run**
6. Verifica que todos los contadores den 0

## Opción 2: Script Node.js (si tienes credenciales de admin)

```bash
node scripts/reset-demo.js
```

Este script:
- Crea o busca el período "Prueba MVP"
- Borra todos los pedidos, órdenes y movimientos
- Resetea saldos a 0
- Reabre la ventana de pedidos

## Después del Reset

Cuando estés listo para empezar la presentación:

1. **Entra a la app** como admin
2. **Ve a Período** → "Prueba MVP"
3. **Configura las fechas** del período actual (desde hoy hasta 30 días adelante)
4. **Abre la ventana de pedidos** para que las familias comiencen
5. ¡Listo! Las familias ya pueden pedir

## Qué se borra y qué NO

✅ **SE BORRA:**
- Todos los pedidos del período
- Órdenes de compra
- Faltantes y extras
- Stock de bodega
- Movimientos de caja
- Marcas de período cerrado

❌ **NO se toca:**
- Familias (mantiene nombres, credenciales, perfiles)
- Productos y proveedores
- Configuración del período (fechas se pueden cambiar manualmente)
- Historial de auditoría

## Troubleshooting

**"RLS policy error"**
→ Usa la Opción 1 (Supabase SQL Editor). Ejecuta el SQL directamente como superuser.

**"Período no encontrado"**
→ El período se crea automáticamente en la Opción 1. Verifica que se creó con `SELECT * FROM periods;`
