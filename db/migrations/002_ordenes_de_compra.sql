-- ─────────────────────────────────────────────────────────────────────────────
-- Fase 2 · Etapa 2 — Órdenes de compra por proveedor
--
-- Seguro de re-ejecutar. No toca ninguna tabla existente.
--
-- Nota de diseño: las líneas van en JSONB, igual que sealed_orders.items. Una
-- orden es una FOTO del momento en que se envió: si después cambia el precio de
-- un producto o alguien modifica su pedido, la orden que el proveedor recibió
-- por correo debe seguir diciendo exactamente lo mismo.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists purchase_orders (
  id             uuid primary key default gen_random_uuid(),

  -- periods.id y sealed_orders.period_id son TEXT (ej: "P109"), no uuid.
  period_id      text not null,
  period_label   text,

  provider_id    uuid not null references providers(id),
  provider_name  text not null,          -- copia: el nombre puede cambiar después

  -- Secreto del enlace de confirmación. Sin sesión ni contraseña: quien tiene
  -- el token puede ver y confirmar ESTA orden y ninguna otra.
  token          text not null unique,

  -- enviada → el proveedor aún no responde
  -- confirmada → el proveedor ya marcó qué llega y qué no
  status         text not null default 'enviada',

  -- [{ product_id, name, unit, qty, price, subtotal,
  --    available: true|false|null, confirmed_qty, note }]
  lines          jsonb not null default '[]'::jsonb,
  total          integer not null default 0,

  -- Trazabilidad del envío
  is_test        boolean not null default false,  -- se desvió al correo de pruebas
  sent_to        text,                            -- destinatario real
  sent_at        timestamptz,
  send_error     text,                            -- si Brevo rechazó el envío

  -- Respuesta del proveedor
  confirmed_at   timestamptz,
  provider_note  text,

  created_at     timestamptz not null default now()
);

create index if not exists idx_po_period   on purchase_orders(period_id);
create index if not exists idx_po_provider on purchase_orders(provider_id);
create index if not exists idx_po_token    on purchase_orders(token);

-- Verificación: debe devolver la tabla vacía, sin error.
select count(*) as ordenes_existentes from purchase_orders;
