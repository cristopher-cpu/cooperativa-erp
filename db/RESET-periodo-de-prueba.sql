-- ─────────────────────────────────────────────────────────────────────────────
-- RESETEAR EL PERÍODO DE PRUEBA
--
-- Borra los movimientos del período ACTIVO para empezar limpio, conservando el
-- catálogo, las familias, los proveedores y la configuración.
--
-- No es una migración: es una herramienta. Se puede usar cuantas veces haga
-- falta mientras se esté probando, y **no debe usarse nunca con datos reales**.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- QUÉ BORRA Y QUÉ NO
-- ═════════════════════════════════════════════════════════════════════════════
--
-- SE BORRA (solo del período activo):
--   · Los pedidos sellados
--   · Los faltantes y extras
--   · Las órdenes de compra y lo que los proveedores respondieron
--   · El stock de bodega, sus asignaciones y sus mermas
--   · Los movimientos de flujo de caja
--   · La marca de «pedidos cerrados», para que la ventana vuelva a abrirse
--
-- NO SE TOCA:
--   · Las familias, sus correos, sus perfiles ni sus PIN
--   · El catálogo de productos ni los proveedores
--   · Los cargos fijos del período ni las exenciones (son configuración)
--   · Las fechas del período
--   · Los períodos anteriores
--   · El registro de actividad (es el historial de quién hizo qué; borrarlo
--     sería borrar la auditoría, que es justo lo que no se borra)
--
-- Los SALDOS van aparte, al final, porque son una decisión distinta. Ver el
-- PASO 3.
-- ═════════════════════════════════════════════════════════════════════════════


-- ── PASO 1 · Ver qué se va a borrar ─────────────────────────────────────────
--
-- Ejecuta SOLO esta consulta primero. Si los números te calzan con lo que
-- probaste, sigue al paso 2. Si sale un período que no esperabas, PARA.

select p.label                                     as periodo_activo,
       p.id                                        as id,
       (select count(*) from sealed_orders      x where x.period_id = p.id) as pedidos,
       (select count(*) from order_adjustments  x where x.period_id = p.id) as faltantes_y_extras,
       (select count(*) from purchase_orders    x where x.period_id = p.id) as ordenes_de_compra,
       (select count(*) from bodega             x where x.period_id = p.id) as items_bodega,
       (select count(*) from cash_flow          x where x.period_id = p.id) as movimientos_caja
  from periods p
 where p.active = true;


-- ── PASO 2 · Borrar ─────────────────────────────────────────────────────────
--
-- Todo dentro de una transacción: o se borra todo, o no se borra nada. Si algo
-- falla a la mitad no queda un período medio limpio, que sería peor que no
-- haber empezado.
--
-- El orden importa: primero lo que depende de otra cosa.

begin;

-- Las mermas y asignaciones dependen del stock de bodega.
delete from bodega_bajas
 where period_id in (select id from periods where active = true);

delete from bodega_assignments
 where period_id in (select id from periods where active = true);

delete from bodega
 where period_id in (select id from periods where active = true);

-- Los faltantes y extras dependen de los pedidos.
delete from order_adjustments
 where period_id in (select id from periods where active = true);

-- Las órdenes de compra y lo que el proveedor respondió.
delete from purchase_orders
 where period_id in (select id from periods where active = true);

-- Los movimientos de caja, incluidos los egresos que generaron las mermas.
delete from cash_flow
 where period_id in (select id from periods where active = true);

-- Y por último los pedidos.
delete from sealed_orders
 where period_id in (select id from periods where active = true);

-- Reabrir la ventana de pedidos: si se había cerrado a mano durante la prueba,
-- nadie podría volver a pedir y parecería que el sistema está roto.
update periods
   set orders_closed_at = null
 where active = true;

commit;


-- ── PASO 3 · Los saldos (opcional, y es una decisión) ───────────────────────
--
-- Los saldos NO se borran con lo de arriba, a propósito: un saldo no pertenece a
-- un período, es lo que una familia debe o tiene a favor **acumulado**. Borrarlo
-- sin querer sería perder plata real.
--
-- Durante las pruebas los saldos se pudieron mover por dos vías: reservas de
-- bodega y movimientos de caja asociados a una familia. Si quieres dejarlos
-- como estaban, acá están los valores del respaldo del 12 de septiembre de
-- 2026 (`backups/backup-20260912-182117/families.json`).
--
-- **Está comentado a propósito.** Quítale los `-- ` del principio de cada línea
-- SOLO si estás seguro de que ningún saldo cambió por un motivo legítimo desde
-- esa fecha.

-- begin;
-- update families set balance = 0      where id = 'fabian';
-- update families set balance = -5750  where id = 'nancy';
-- update families set balance = 7400   where id = 'martina';
-- update families set balance = -1800  where id = 'cinthya';
-- update families set balance = -1150  where id = 'alison';
-- update families set balance = 0      where id = 'patricia_v';
-- update families set balance = -11275 where id = 'claudia';
-- update families set balance = 1950   where id = 'macarena';
-- update families set balance = -4150  where id = 'mercedes';
-- update families set balance = 0      where id = 'natalia';
-- update families set balance = -13000 where id = 'ines';
-- update families set balance = -25050 where id = 'carla';
-- update families set balance = -15360 where id = 'ale';
-- update families set balance = 0      where id = 'pablo';
-- update families set balance = -13250 where id = 'mj';
-- update families set balance = -600   where id = 'ruby';
-- update families set balance = 13500  where id = 'paty';
-- commit;

-- Si prefieres partir de cero con todas en blanco (solo si la cooperativa
-- decidió que no hay deudas anteriores que arrastrar):
-- update families set balance = 0;


-- ── PASO 4 · Comprobar ──────────────────────────────────────────────────────
--
-- Los cinco contadores tienen que dar 0.

select p.label,
       (select count(*) from sealed_orders      x where x.period_id = p.id) as pedidos,
       (select count(*) from order_adjustments  x where x.period_id = p.id) as faltantes_y_extras,
       (select count(*) from purchase_orders    x where x.period_id = p.id) as ordenes_de_compra,
       (select count(*) from bodega             x where x.period_id = p.id) as items_bodega,
       (select count(*) from cash_flow          x where x.period_id = p.id) as movimientos_caja,
       p.orders_closed_at                                                   as pedidos_cerrados
  from periods p
 where p.active = true;
