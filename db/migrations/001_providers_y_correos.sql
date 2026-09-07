-- ─────────────────────────────────────────────────────────────────────────────
-- Fase 2 · Etapa 1 — Proveedores como entidad + segundo correo por familia
--
-- Seguro de re-ejecutar: usa IF NOT EXISTS / ON CONFLICT en todo.
-- NO borra ni modifica datos existentes. La columna products.provider (texto)
-- se conserva intacta como respaldo; se puede eliminar más adelante.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Tabla de proveedores ─────────────────────────────────────────────────────
create table if not exists providers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  email       text,                    -- pendiente: se completa después
  contact     text,                    -- persona de contacto
  phone       text,
  notes       text,
  is_member   boolean not null default false,  -- socia productora vs proveedor externo
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- 2. Carga de los 13 proveedores existentes ───────────────────────────────────
-- "Mundo Novo" se normaliza con N mayúscula (en products está como "Mundo novo").
-- is_member marca a las socias productoras: no reciben orden de compra formal.
insert into providers (name, is_member) values
  ('El Granero',       false),
  ('Karim Porta',      true),
  ('La Granja',        false),
  ('Simbiotika',       false),
  ('Grano a Grano',    false),
  ('VitaRautén',       false),
  ('Nitay',            false),
  ('Amador Aguilera',  true),
  ('Mundo Novo',       false),
  ('Paty',             true),
  ('Cahuil',           false),
  ('Pamela Marín',     true),
  ('Ximena Colliguay', true)
on conflict (name) do nothing;

-- 3. Vincular productos a proveedores ─────────────────────────────────────────
alter table products add column if not exists provider_id uuid references providers(id);

update products p
   set provider_id = pr.id
  from providers pr
 where p.provider_id is null
   and lower(trim(p.provider)) = lower(pr.name);

create index if not exists idx_products_provider_id on products(provider_id);

-- 4. Segundo correo por familia ───────────────────────────────────────────────
alter table families add column if not exists email2 text;

-- 5. Verificación ─────────────────────────────────────────────────────────────
-- Debe devolver 0 filas. Si devuelve alguna, ese producto tiene un nombre de
-- proveedor que no coincide con ninguno de los 13 y hay que revisarlo a mano.
select id, name, provider
  from products
 where provider_id is null;
