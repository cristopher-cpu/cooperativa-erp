-- ─────────────────────────────────────────────────────────────────────────────
-- Fase 2 · Etapa 7 — Mermas, regalos y sobrantes en bodega
--
-- Idempotente. No borra datos.
--
-- Del paso 08 del flujo de la cooperativa: «identificación y reporte de
-- sobrantes a la Comisión de Proveedores».
--
-- ── Por qué NO basta con bajar el stock ─────────────────────────────────────
--
-- Restarle 3 kilos al ítem de bodega deja el inventario correcto y la
-- contabilidad ciega. Una merma **es plata que la cooperativa perdió**: compró
-- el producto, lo pagó al proveedor, y no lo vendió. Si solo se descuenta el
-- stock, el flujo de caja del período cuadra sin haber registrado nunca esa
-- pérdida, y el perfil Balance Contable no tiene de dónde explicar el descalce.
--
-- Por eso cada baja registra su MOTIVO y su VALOR, y los motivos que cuestan
-- plata generan un egreso en `cash_flow`.
--
-- ── Por qué los motivos se distinguen ───────────────────────────────────────
--
--   merma        Se echó a perder, se rompió, se venció. Pérdida involuntaria.
--                Es lo que hay que medir para saber si conviene comprar menos.
--
--   regalo       Se donó o se regaló. **Pérdida deliberada**, no un descuido.
--                Mezclarlo con la merma hace que la cooperativa parezca
--                descuidada cuando en realidad fue generosa, y al revés:
--                esconde una merma real detrás de una decisión.
--
--   consumo      Se usó en una actividad de la cooperativa (una capacitación,
--                una once). Sale del stock y es gasto, pero es gasto con
--                propósito.
--
--   devolucion   Se le devolvió al proveedor. **No es pérdida**: no genera
--                egreso, porque la plata vuelve o nunca se pagó.
--
--   ajuste       La cuenta física no cuadraba con el sistema. No es un hecho
--                del mundo, es una corrección de registro. Se anota para que el
--                descalce quede visible en vez de desaparecer.
--
-- ── Por qué una tabla nueva y no `inventory` / `movements` ──────────────────
--
-- Esas dos tablas existen en la base y `supabaseClient.js` tiene funciones para
-- ellas que **nadie llama**: código muerto de un intento anterior. Verificado
-- el 18-sep-2026 contra el respaldo: **cero filas en ambas**.
--
-- Reaprovecharlas parecía ahorro y no lo es: `movements` no tiene `period_id`
-- —y todo en este sistema se contabiliza por período— ni campo de motivo, ni
-- vínculo con el ítem de bodega del que se descuenta. Habría que alterarlas
-- hasta dejarlas irreconocibles, conservando el nombre de un diseño que no era
-- para esto. Las funciones muertas se eliminan en el mismo cambio.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists bodega_bajas (
  id           uuid primary key default gen_random_uuid(),

  -- periods.id y bodega.id son TEXT, no uuid.
  period_id    text not null,
  bodega_id    text not null,

  -- Foto del producto, igual que en sealed_orders.items y en order_adjustments:
  -- si mañana el ítem de bodega se borra, esta baja tiene que seguir diciendo
  -- qué se perdió y cuánto valía.
  product_name text not null,
  unit         text,
  quantity     numeric not null check (quantity > 0),
  unit_price   integer not null default 0,

  -- Lo que la cooperativa dejó de tener, en pesos. Se guarda calculado para que
  -- un cambio de precio posterior no reescriba la pérdida del mes pasado.
  amount       integer not null default 0,

  reason       text not null check (reason in ('merma', 'regalo', 'consumo', 'devolucion', 'ajuste')),

  -- Obligatorio. Una merma sin explicación es un número que nadie puede
  -- defender en la asamblea, y es justo el número que va a generar preguntas.
  note         text not null,

  -- El movimiento de caja que generó, si generó uno. Permite deshacer la baja
  -- sin dejar un egreso huérfano en el flujo.
  cash_flow_id text,

  created_by      text,
  created_by_name text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_bajas_period on bodega_bajas(period_id, created_at desc);
create index if not exists idx_bajas_item   on bodega_bajas(bodega_id);
create index if not exists idx_bajas_reason on bodega_bajas(period_id, reason);

comment on table bodega_bajas is
  'Producto que salió de bodega sin venderse. El motivo decide si es pérdida de dinero (merma, regalo, consumo) o no (devolucion, ajuste). Las que cuestan plata generan un egreso en cash_flow.';

comment on column bodega_bajas.amount is
  'Cuánto dejó de tener la cooperativa, en pesos. Calculado al registrar y congelado: un cambio de precio posterior no debe reescribir la pérdida del mes pasado.';

comment on column bodega_bajas.cash_flow_id is
  'El egreso que esta baja generó en cash_flow, o null si el motivo no cuesta plata. Existe para poder deshacer la baja sin dejar el egreso huérfano.';


-- ── Verificación ────────────────────────────────────────────────────────────
select
  p.label,
  b.reason,
  count(*)        as bajas,
  sum(b.quantity) as cantidad,
  sum(b.amount)   as pesos
from bodega_bajas b
join periods p on p.id = b.period_id
group by p.label, b.reason
order by p.label, b.reason;
