-- ─────────────────────────────────────────────────────────────────────────────
-- Fase 2 · Etapa 3 — Faltantes, extras y cobro post-confirmación
--
-- Seguro de re-ejecutar. No borra datos.
--
-- ── Convención de signo (leer antes de tocar nada) ──────────────────────────
--
--   amount = cuánto cambia lo que la familia DEBE por este período.
--
--     negativo → debe menos  (no llegó / no lo trajeron)
--     positivo → debe más    (se llevó algo extra)
--
--   Total a pagar = pedido.total + cargo_fijo + suma(ajustes.amount)
--
-- Un solo signo para los tres tipos evita el error clásico de sumar donde había
-- que restar. Si algún día hay que preguntarse "¿este tipo suma o resta?", la
-- respuesta ya está en el dato, no en el código que lo lee.
--
-- ── Los tres tipos ──────────────────────────────────────────────────────────
--
--   no_confirmado  El proveedor avisó ANTES de la entrega que no lo trae.
--                  La familia no debería pagarlo nunca. amount negativo.
--
--   faltante       Estaba en la lista, se pagó, y no llegó a la caja (o llegó
--                  en mal estado). amount negativo → queda saldo a favor.
--
--   extra          La familia se llevó algo no pedido, normalmente en el
--                  retiro. amount positivo. Puede estar pagado o no.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists order_adjustments (
  id              uuid primary key default gen_random_uuid(),

  -- periods.id, families.id y sealed_orders.id son TEXT, no uuid.
  period_id       text not null,
  family_id       text not null,
  sealed_order_id text,                  -- puede faltar: un extra sin pedido previo

  type            text not null check (type in ('no_confirmado', 'faltante', 'extra')),

  -- Foto del producto. Igual que en sealed_orders.items: si mañana cambia el
  -- precio o se borra del maestro, este ajuste debe seguir diciendo lo mismo.
  product_id      integer,
  product_name    text not null,
  unit            text,
  qty             numeric not null default 1,
  unit_price      integer not null default 0,

  -- Ver la convención de signo arriba. Se guarda calculado y no se deriva al
  -- leer, para que un cambio de precio no reescriba el pasado.
  amount          integer not null,

  -- De dónde salió: 'proveedor' (automático desde la confirmación),
  -- 'familia' (lo registró la propia familia), 'comision' (Retiro).
  source          text not null default 'comision',

  -- Solo para extras: si ya se pagó aparte, no debe arrastrarse al saldo.
  paid            boolean not null default false,

  note            text,
  created_by      text,                  -- family_id de quien lo registró
  created_at      timestamptz not null default now()
);

create index if not exists idx_adj_period on order_adjustments(period_id);
create index if not exists idx_adj_family on order_adjustments(period_id, family_id);
create index if not exists idx_adj_order  on order_adjustments(sealed_order_id);

-- Un mismo producto no puede generarse dos veces automáticamente desde la
-- confirmación del proveedor. Sin esto, reenviar una orden duplicaría el
-- descuento y la familia terminaría con saldo a favor inventado.
create unique index if not exists idx_adj_no_confirmado_unico
  on order_adjustments(period_id, family_id, product_id)
  where type = 'no_confirmado';


-- ── Ventana de ajustes ──────────────────────────────────────────────────────
-- El paso 08 del flujo de la cooperativa da "margen para ajustes finales de cada
-- planilla desde el hogar". Después de esta fecha se congela.
alter table periods add column if not exists date_adjust_until date;

-- Fecha límite para que los proveedores confirmen. Si no responden, el cobro no
-- puede quedar esperando para siempre.
alter table periods add column if not exists date_confirm_until date;


-- ── Cobro idempotente ───────────────────────────────────────────────────────
-- handleClosePeriod descuenta el saldo de cada familia en un bucle y DESPUÉS
-- cierra el período. Si el cierre falla, las familias ya quedaron cobradas y el
-- período sigue abierto: reintentar cobra dos veces. Con esta marca, el
-- reintento salta lo ya cobrado.
alter table sealed_orders add column if not exists charged_at     timestamptz;
alter table sealed_orders add column if not exists charged_amount integer;


-- ── Verificación ────────────────────────────────────────────────────────────
select
  (select count(*) from order_adjustments) as ajustes,
  (select count(*) from sealed_orders where charged_at is not null) as pedidos_ya_cobrados;
