-- ─── 006 · CIERRE DE PEDIDOS Y CONFIRMACIÓN ASISTIDA ─────────────────────────
--
-- Dos cosas que la cooperativa pidió después de probar el flujo real:
--
-- 1. La orden de compra no debe poder salir mientras las familias todavía pueden
--    pedir. Antes era solo una advertencia que se podía saltar con un clic, y lo
--    que se compra de menos recién se descubre el día del retiro.
--
--    `orders_closed_at` es un cierre EXPLÍCITO de la ventana de pedidos, distinto
--    de `date_to` (la fecha planificada) y distinto de cerrar el período entero
--    (que es el corte contable y ocurre mucho después). Se separa a propósito:
--    cambiar `date_to` para poder enviar una orden borraría la fecha que se le
--    anunció a las familias.
--
-- 2. No todos los proveedores usan el enlace. La Comisión Proveedores necesita
--    poder registrar por teléfono lo que el proveedor respondió, y que quede
--    escrito QUIÉN lo registró — una respuesta anotada por un tercero no vale lo
--    mismo que una que dio el proveedor, y el indicador de cumplimiento no puede
--    contarlas como si fueran iguales.
--
-- Idempotente: se puede correr más de una vez sin efecto adicional.

-- ── 1. Cierre explícito de la ventana de pedidos ────────────────────────────
alter table periods add column if not exists orders_closed_at timestamptz;

comment on column periods.orders_closed_at is
  'Cuándo se cerró la ventana de pedidos. Null = sigue abierta (o se cierra sola al pasar date_to). No confundir con closed_at, que es el cierre contable del período.';

-- ── 2. Quién registró la confirmación ───────────────────────────────────────
alter table purchase_orders add column if not exists confirmed_source text;
alter table purchase_orders add column if not exists confirmed_by      text;
alter table purchase_orders add column if not exists confirmed_by_name text;

comment on column purchase_orders.confirmed_source is
  'proveedor = respondió el proveedor por el enlace · comision = lo registró alguien de la cooperativa por teléfono u otro medio';

-- Las que ya estaban confirmadas solo pudieron serlo por el enlace: antes de
-- esta migración no existía otra forma.
update purchase_orders
   set confirmed_source = 'proveedor'
 where status = 'confirmada'
   and confirmed_source is null;

-- ── Verificación ────────────────────────────────────────────────────────────
select
  (select count(*) from purchase_orders where confirmed_source = 'proveedor') as confirmadas_por_proveedor,
  (select count(*) from purchase_orders where confirmed_source = 'comision')  as registradas_por_comision,
  (select orders_closed_at from periods where active = true)                  as pedidos_cerrados_el;
