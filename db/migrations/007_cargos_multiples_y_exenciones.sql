-- ─────────────────────────────────────────────────────────────────────────────
-- Fase 2 · Etapa 4c — Cargos fijos múltiples y exenciones por familia
--
-- Idempotente. No borra datos.
--
-- ── Qué cambia ──────────────────────────────────────────────────────────────
--
-- Hasta ahora el cargo fijo era UN número en `periods.fixed_charge`, igual para
-- todas. La cooperativa necesita dos cosas que ese número no puede dar:
--
--   1. Varios cargos con nombre propio (cuota administrativa, fondo de bodega,
--      aporte a capacitación...). Un solo total de $4.000 no dice en qué se
--      gastó, y el perfil Balance Contable necesita justamente eso para rendir.
--
--   2. Eximir a una familia de un cargo. Hoy la única forma es descontárselo a
--      mano del saldo, y eso no deja registro de POR QUÉ — el mismo problema que
--      la migración 004 vino a resolver con los ajustes.
--
-- ── Por qué por período y no una lista permanente ───────────────────────────
--
-- Un período cerrado tiene que seguir diciendo lo que decía. Si los cargos
-- fueran una lista global con un monto vigente, subir la cuota en noviembre
-- reescribiría lo que se cobró en septiembre, y el cierre contable de septiembre
-- dejaría de cuadrar con sus propios comprobantes.
--
-- Misma decisión que `sealed_orders.items` (foto de precios) y que las líneas de
-- una orden de compra: lo que ya ocurrió no se recalcula.
--
-- El costo es tipear los cargos en cada período, y se paga copiándolos del
-- anterior al crear uno nuevo (lo hace la app, no el SQL).
--
-- ── Compatibilidad ──────────────────────────────────────────────────────────
--
-- `periods.fixed_charge` NO se elimina: se mantiene sincronizado con la suma de
-- los cargos del período, igual que `families.role` quedó sincronizado con
-- `roles` en la 005. Así nada de lo que ya lo lee se rompe, y los períodos
-- anteriores a esta migración siguen valiendo lo que valían.
--
-- Si esta migración no se ejecuta, la app degrada: muestra `fixed_charge` como
-- un único cargo llamado "Cargo fijo" y esconde el botón de agregar.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Los cargos de cada período ───────────────────────────────────────────

create table if not exists period_charges (
  id          uuid primary key default gen_random_uuid(),

  -- periods.id es TEXT, no uuid.
  period_id   text    not null,

  name        text    not null,
  amount      integer not null default 0,

  -- Para qué es. Se le muestra a la familia junto al monto: un cargo que nadie
  -- puede explicar es un cargo que las socias van a discutir en la asamblea.
  note        text,

  -- Orden de presentación. Sin esto el desglose se reordena solo entre cargas y
  -- la misma cuenta se lee distinta dos veces.
  sort        integer not null default 0,

  created_by      text,
  created_by_name text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_period_charges_period on period_charges(period_id, sort);

-- Dos cargos con el mismo nombre en el mismo período son casi siempre un doble
-- clic, y se cobrarían los dos.
create unique index if not exists idx_period_charges_nombre_unico
  on period_charges(period_id, lower(name));


-- ── 2. Quién está eximido de qué ────────────────────────────────────────────
--
-- La exención es por (cargo, familia), no por familia: se puede eximir a alguien
-- del fondo de bodega y seguirle cobrando la cuota administrativa.
--
-- `reason` no es opcional por diseño. Eximir a una familia de un cargo es mover
-- plata de la cooperativa, y la decisión la toma una persona: tiene que quedar
-- escrito quién y por qué. Es la misma razón por la que los ajustes de la 004
-- guardan `source` y `note`.

create table if not exists charge_exemptions (
  id          uuid primary key default gen_random_uuid(),

  period_id   text not null,
  charge_id   uuid not null references period_charges(id) on delete cascade,
  family_id   text not null,

  reason      text not null,

  granted_by      text,
  granted_by_name text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_exempt_period on charge_exemptions(period_id);
create index if not exists idx_exempt_family on charge_exemptions(period_id, family_id);

-- Una familia no puede estar eximida dos veces del mismo cargo.
create unique index if not exists idx_exempt_unico
  on charge_exemptions(charge_id, family_id);


-- ── 3. Migrar el cargo único que ya existe ──────────────────────────────────
--
-- Cada período con `fixed_charge` distinto de cero y todavía sin cargos pasa a
-- tener uno solo, llamado como se llamaba en la interfaz. Solo toca los períodos
-- que aún no tienen ninguno, para poder re-ejecutar sin duplicar.

insert into period_charges (period_id, name, amount, note, sort)
select p.id, 'Cargo fijo', p.fixed_charge,
       'Migrado del cargo único que existía antes de separar los cargos por nombre', 0
  from periods p
 where coalesce(p.fixed_charge, 0) <> 0
   and not exists (select 1 from period_charges c where c.period_id = p.id);


-- ── 4. Mantener `fixed_charge` sincronizado ─────────────────────────────────
--
-- Es la suma de los cargos del período, SIN exenciones: sigue siendo "cuánto se
-- le cobra a una familia normal", que es lo que significaba antes. Lo que una
-- familia eximida paga de menos se calcula al leer, no se guarda acá.
--
-- El trigger existe para que el código viejo que lee `fixed_charge` nunca vea un
-- número obsoleto. La app también lo actualiza al escribir; tener las dos vías
-- es deliberado, porque quien edite la tabla a mano desde Supabase no va a
-- acordarse de recalcular.

create or replace function sync_fixed_charge() returns trigger as $$
declare
  pid text := coalesce(new.period_id, old.period_id);
begin
  update periods
     set fixed_charge = coalesce((select sum(amount) from period_charges where period_id = pid), 0)
   where id = pid;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_sync_fixed_charge on period_charges;
create trigger trg_sync_fixed_charge
  after insert or update or delete on period_charges
  for each row execute function sync_fixed_charge();

-- Cuadrar lo que ya está, por si algún período quedó descalzado.
update periods p
   set fixed_charge = coalesce((select sum(amount) from period_charges c where c.period_id = p.id), p.fixed_charge)
 where exists (select 1 from period_charges c where c.period_id = p.id);


-- ── Verificación ────────────────────────────────────────────────────────────
select p.label,
       p.fixed_charge                                as total_periodo,
       (select count(*) from period_charges c
         where c.period_id = p.id)                   as cargos,
       (select count(*) from charge_exemptions e
         where e.period_id = p.id)                   as exenciones
  from periods p
 order by p.active desc, p.created_at desc;
