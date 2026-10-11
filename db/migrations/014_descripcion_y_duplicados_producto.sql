-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 014 — Descripción del producto y freno a duplicados
--
-- Pedido de la cooperativa (nota de Ruby, 10-oct-2026, piloto MVP): el nombre
-- del producto no tiene dónde poner detalles (gramaje, marca, variedad) y, al
-- cargar productos rápido, es fácil repetir uno que ya estaba. Dos cosas:
--
--   1. Una columna `description`, visible para la familia al elegir el
--      producto (no solo para la comisión).
--   2. Un producto no puede llamarse exactamente igual, del mismo proveedor,
--      dos veces. Mismo patrón que `idx_period_charges_nombre_unico` de la
--      migración 007: si YA hay duplicados cargados, no se crea el índice y
--      hay que resolverlos primero (fusionar o renombrar) antes de reintentar.
-- ─────────────────────────────────────────────────────────────────────────────

alter table products add column if not exists description text;

do $$ begin
  if exists (
    select 1 from products
     where provider_id is not null
     group by provider_id, lower(trim(name))
    having count(*) > 1
  ) then
    raise notice 'Hay productos duplicados (mismo nombre y proveedor). No se crea el índice único: fusiona o renombra esos productos y vuelve a correr esta migración.';
  else
    execute 'create unique index if not exists idx_products_nombre_proveedor_unico
               on products(provider_id, lower(trim(name)))
               where provider_id is not null';
  end if;
end $$;


-- ── Verificación ────────────────────────────────────────────────────────────
select
  exists (select 1 from information_schema.columns
           where table_name = 'products' and column_name = 'description') as columna_descripcion,
  (select count(*) from pg_indexes where indexname = 'idx_products_nombre_proveedor_unico') as indice_antiduplicados;
