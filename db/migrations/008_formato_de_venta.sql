-- ─────────────────────────────────────────────────────────────────────────────
-- Fase 2 · Etapa 6 — Formato de venta estructurado
--
-- Idempotente. No borra datos. NO reescribe `products.unit`.
--
-- ── El problema ─────────────────────────────────────────────────────────────
--
-- `products.unit` no es una unidad de medida: es el FORMATO DE VENTA, y `price`
-- es el precio de ese formato. "500 gr" significa «bolsa de medio kilo» y el
-- precio es el de la bolsa.
--
-- Hay 24 variantes de texto libre para cinco unidades canónicas. Entre ellas
-- "Kg", "1 Kg" y "Kilo", que son lo mismo escrito de tres maneras.
--
-- ── Qué NO rompe (importante, porque es la conclusión intuitiva y es falsa) ─
--
-- El consolidado por proveedor **funciona bien**: agrupa por producto, y cada
-- producto arrastra su propio formato. Arreglar algo que no está roto cuesta
-- lo mismo que arreglar algo que sí.
--
-- ── Qué sí rompe ────────────────────────────────────────────────────────────
--
--   · La orden que sale hacia el proveedor: lee "Kg", "1 Kg" y "Kilo" como si
--     fueran tres formatos distintos del mismo producto.
--   · El peso total por proveedor: no se puede calcular desde texto libre.
--   · El emparejamiento al importar una planilla de precios.
--
-- ── Por qué se AGREGAN columnas en vez de limpiar `unit` ────────────────────
--
-- Dos razones, y las dos pesan:
--
--   1. "24 rollos" canonizado es "24 un", y eso pierde información que alguien
--      necesita: quien recibe la caja tiene que saber que son rollos. Lo mismo
--      "Caja 3 un". La etiqueta que lee una persona y la que usa una cuenta no
--      son la misma cosa.
--
--   2. `sealed_orders.items` tiene el formato congelado adentro. Reescribir
--      `unit` haría que un pedido viejo y el maestro dijeran cosas distintas
--      del mismo producto — justo lo que la foto en JSONB existe para evitar.
--
-- Así que `unit` sigue siendo la etiqueta humana, y estas dos columnas son la
-- versión con la que se calcula.
--
-- ── Por qué la migración no interpreta el texto ─────────────────────────────
--
-- Se podría escribir el parser en SQL, y sería un parser peor: no puede pedir
-- confirmación. De los 24 formatos reales, 21 se interpretan sin ambigüedad,
-- 3 asumen que "Kg" significa un kilo, y un formato compuesto como
-- "3 bandejas de 500 gr" tiene que decidirlo una persona.
--
-- Interpretar en silencio un formato que no se entiende es cómo un precio
-- termina dividido por mil. La normalización se hace desde el panel
-- (Productos → Normalizar formatos), que muestra lo que propone y espera el
-- visto bueno.
-- ─────────────────────────────────────────────────────────────────────────────

alter table products add column if not exists format_qty  numeric;
alter table products add column if not exists format_unit text;

comment on column products.unit is
  'Formato de venta como lo escribe una persona ("500 gr", "24 rollos", "Caja 3 un"). `price` es el precio de ESTE formato, no de la unidad de medida. Es la etiqueta que se muestra; para calcular, usar format_qty + format_unit.';

comment on column products.format_qty is
  'Cuántas unidades canónicas trae el formato. "500 gr" → 500. "Kg" → 1.';

comment on column products.format_unit is
  'Unidad canónica: gr, kg, ml, lt o un. Los envases (rollos, caja, bolsa, paquete) se cuentan: su unidad es un.';

-- Solo las cinco. Sin esto, la primera importación que traiga "cc" o "grs"
-- dejaría una sexta unidad en la tabla y el problema volvería por otra puerta.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_format_unit_canonica'
  ) then
    alter table products add constraint products_format_unit_canonica
      check (format_unit is null or format_unit in ('gr', 'kg', 'ml', 'lt', 'un'));
  end if;
end $$;

-- Una cantidad sin unidad, o al revés, es medio dato: no se puede calcular con
-- ella y aparentaría estar normalizada.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'products_formato_completo'
  ) then
    alter table products add constraint products_formato_completo
      check ((format_qty is null and format_unit is null)
          or (format_qty is not null and format_unit is not null and format_qty > 0));
  end if;
end $$;

create index if not exists idx_products_format on products(format_unit, format_qty);


-- ── Historial de precios ────────────────────────────────────────────────────
--
-- La carga masiva cambia precios de a decenas. Sin historial, un archivo
-- equivocado sobrescribe el maestro y no queda de dónde volver: los pedidos ya
-- sellados conservan su foto, pero el precio anterior del producto se pierde.
--
-- Guarda el precio ANTERIOR, no el nuevo. El nuevo ya está en `products`, y
-- duplicarlo abriría la posibilidad de que las dos copias discrepen.

create table if not exists price_history (
  id           uuid primary key default gen_random_uuid(),
  product_id   integer not null,
  price_before  integer not null,
  price_after   integer not null,
  source       text not null default 'manual',   -- manual | importacion
  batch_id     text,                             -- agrupa una misma importación
  changed_by      text,
  changed_by_name text,
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_price_history_product on price_history(product_id, created_at desc);
create index if not exists idx_price_history_batch   on price_history(batch_id);


-- ── Verificación ────────────────────────────────────────────────────────────
select
  count(*)                                                    as productos,
  count(*) filter (where format_unit is not null)             as normalizados,
  count(*) filter (where format_unit is null)                 as por_normalizar,
  count(distinct unit)                                        as variantes_de_texto,
  count(distinct format_unit) filter (where format_unit is not null) as unidades_canonicas
from products;
