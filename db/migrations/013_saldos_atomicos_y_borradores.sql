-- ─────────────────────────────────────────────────────────────────────────────
-- 013 — SALDOS ATÓMICOS, CARRITOS GUARDADOS Y SELLADO AUTOMÁTICO
--
-- Idempotente. No borra datos. Se puede correr antes o después del reinicio
-- del período MVP (db/RESET-inicio-piloto-mvp.sql); el orden recomendado es
-- primero el reinicio y después esta migración, para que el índice único de
-- pedidos no choque con duplicados viejos.
--
-- ── 1 · Por qué los saldos tienen que moverse en la base ────────────────────
--
-- Hasta ahora cada pago, cada cobro al cerrar y cada reverso se calculaba en el
-- navegador: «saldo que tengo en pantalla ± monto», y se sobrescribía. Eso
-- falla aunque trabaje una sola persona: después de cerrar el período la
-- pantalla seguía con los saldos de ANTES del cobro, y el primer pago que se
-- registraba pisaba el cobro completo. La familia quedaba como si no se le
-- hubiera cobrado nunca.
--
-- `balance = balance + delta` en el servidor no tiene ese problema: no importa
-- qué muestre cada pantalla, la suma se hace sobre el valor real.
--
-- ── 2 · Por qué el cobro del cierre es una sola función ─────────────────────
--
-- Cobrar un pedido son dos escrituras: bajar el saldo y marcar el pedido como
-- cobrado. Hechas por separado desde el navegador, si la segunda fallaba el
-- reintento volvía a cobrar. Acá van juntas: o pasan las dos o ninguna, y un
-- pedido ya cobrado no se vuelve a cobrar aunque se llame diez veces.
--
-- ── 3 · Carritos guardados y sellado automático ─────────────────────────────
--
-- El carrito vivía solo en la memoria del navegador: si la familia cerraba la
-- pestaña sin sellar, lo perdía. Y si nunca sellaba, al cierre se quedaba sin
-- pedido. La cooperativa pidió que, llegada la fecha límite, lo que quedó en el
-- carrito se selle solo.
--
-- `order_drafts` guarda el carrito mientras se arma. `coop_sellar_borradores`
-- lo convierte en pedido sellado cuando la ventana de pedidos cerró (por fecha
-- o a mano), con los precios del maestro de ese momento — igual que si la
-- familia hubiera apretado «Sellar».
--
-- La llaman tres lugares, y cualquiera de ellos basta:
--   · el cron diario de Vercel (/api/sellar-vencidos), pasada la medianoche;
--   · el panel, al cerrar los pedidos a mano;
--   · cualquier pantalla que cargue el período y vea los pedidos ya cerrados.
-- Es idempotente: si dos la llaman a la vez, el índice único de pedidos hace
-- que el segundo intento no duplique nada.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── Un pedido por familia y período ─────────────────────────────────────────
--
-- Faltaba desde el principio (ver §8 de docs/FASE-2.md: los tres pedidos de
-- `ale` en P109). Si todavía hay duplicados, NO se crea y se avisa: borrar
-- pedidos para poder crear un índice sería decidir en silencio cuál vale.
do $$ begin
  if exists (
    select 1 from sealed_orders group by period_id, family_id having count(*) > 1
  ) then
    raise notice 'Hay pedidos duplicados (misma familia y período). No se crea el índice único: resuélvelos y vuelve a correr esta migración.';
  else
    execute 'create unique index if not exists idx_sealed_un_pedido
               on sealed_orders(period_id, family_id)';
  end if;
end $$;

-- Para mostrarle a la familia y a la comisión que el pedido lo selló el
-- sistema y no ella.
alter table sealed_orders add column if not exists sealed_auto boolean not null default false;

-- La bodega guardaba solo el NOMBRE del producto. Con el id, el buscador puede
-- avisar «esto también está en bodega» sin adivinar por texto.
alter table bodega add column if not exists product_id integer;


-- ── Mover un saldo ──────────────────────────────────────────────────────────
--
-- Pagos, reversos de pagos y correcciones. Solo Administración y Balance
-- Contable, igual que la política `families_admin`.
create or replace function coop_mover_saldo(p_family_id text, p_delta integer)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  nuevo integer;
begin
  if not (coop_tiene('admin') or coop_tiene('contable')) then
    raise exception 'Solo Administración o Balance Contable pueden mover saldos.'
      using errcode = 'insufficient_privilege';
  end if;

  update families
     set balance = coalesce(balance, 0) + coalesce(p_delta, 0)
   where id = p_family_id
  returning balance into nuevo;

  if not found then
    raise exception 'La familia % no existe.', p_family_id using errcode = 'no_data_found';
  end if;
  return nuevo;
end $$;


-- ── Cobrar un pedido al cerrar el período ───────────────────────────────────
--
-- Devuelve el saldo nuevo, o NULL si el pedido ya estaba cobrado (en cuyo caso
-- no toca nada). El monto lo calcula el panel con `cuentaDeFamilia`, que es la
-- misma cuenta que la familia ve en su pantalla.
create or replace function coop_cobrar_pedido(p_order_id text, p_monto integer)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  fam   text;
  nuevo integer;
begin
  if not (coop_tiene('admin') or coop_tiene('contable')) then
    raise exception 'Solo Administración o Balance Contable pueden cobrar pedidos.'
      using errcode = 'insufficient_privilege';
  end if;

  update sealed_orders
     set charged_at = now(), charged_amount = coalesce(p_monto, 0)
   where id = p_order_id and charged_at is null
  returning family_id into fam;

  if fam is null then
    return null;          -- ya cobrado: el reintento no cobra dos veces
  end if;

  update families
     set balance = coalesce(balance, 0) - coalesce(p_monto, 0)
   where id = fam
  returning balance into nuevo;

  -- Sin familia no hay a quién cobrar: se aborta todo (también la marca de
  -- cobrado), en vez de devolver NULL y que parezca «ya estaba cobrado».
  if not found then
    raise exception 'El pedido % es de la familia %, que no existe.', p_order_id, fam
      using errcode = 'no_data_found';
  end if;

  return nuevo;
end $$;


-- ── Carritos guardados ──────────────────────────────────────────────────────
create table if not exists order_drafts (
  period_id  text not null,
  family_id  text not null,
  -- { "<product_id>": cantidad }. Solo cantidades: los precios se toman del
  -- maestro al sellar, igual que cuando la familia sella a mano.
  items      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (period_id, family_id)
);

alter table order_drafts enable row level security;

-- Cada familia ve y escribe SU carrito. Las comisiones ven todos (el panel
-- avisa quién tiene carrito sin sellar) y pueden escribir el de otra cuando
-- hacen el pedido por ella.
drop policy if exists borradores_leer on order_drafts;
create policy borradores_leer on order_drafts
  for select using (family_id = coop_family_id() or coop_comision());

drop policy if exists borradores_propios on order_drafts;
create policy borradores_propios on order_drafts
  for all using (family_id = coop_family_id() or coop_comision())
  with check (family_id = coop_family_id() or coop_comision());


-- ── Sellar lo que quedó en los carritos ─────────────────────────────────────
--
-- Solo actúa sobre períodos activos cuya ventana de pedidos ya cerró. Mientras
-- las familias puedan pedir no toca nada, así que llamarla de más es inofensivo.
-- «Cerró por fecha» se mide en hora de Chile: la familia leyó «cierra el
-- viernes» y el viernes es suyo hasta la medianoche de acá, no de Greenwich.
--
-- Devuelve cuántos pedidos selló.
create or replace function coop_sellar_borradores(p_period_id text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  per       record;
  d         record;
  v_items   jsonb;
  v_total   numeric;
  v_tipo    text;
  sellados  integer := 0;
  hoy_chile date := (now() at time zone 'America/Santiago')::date;
  es_servicio boolean :=
    coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role';
begin
  if not (coop_autenticado() or es_servicio) then
    raise exception 'Hace falta una sesión para sellar pedidos.' using errcode = 'insufficient_privilege';
  end if;

  -- `items` es text en unas bases y jsonb en otras; se escribe en el tipo que
  -- tenga, para que el pedido quede igual que uno sellado a mano.
  select data_type into v_tipo
    from information_schema.columns
   where table_schema = 'public' and table_name = 'sealed_orders' and column_name = 'items';

  for per in
    select * from periods
     where active = true
       and (p_period_id is null or id = p_period_id)
       and (orders_closed_at is not null or (date_to is not null and hoy_chile > date_to))
  loop
    for d in select * from order_drafts where period_id = per.id loop

      -- Ya tiene pedido (lo selló ella, o lo selló otra llamada): el carrito
      -- sobra.
      if exists (select 1 from sealed_orders s where s.period_id = per.id and s.family_id = d.family_id) then
        delete from order_drafts where period_id = d.period_id and family_id = d.family_id;
        continue;
      end if;

      -- Misma forma que arma el navegador: {id, n, pv, p, u, qty}. Lo que se
      -- quedó sin stock o salió del maestro no se sella: la familia no lo habría
      -- podido agregar hoy.
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'n', p.name, 'pv', p.provider, 'p', p.price, 'u', p.unit,
               'qty', (e.value)::numeric) order by p.name),
             sum(p.price * (e.value)::numeric)
        into v_items, v_total
        from jsonb_each_text(d.items) e
        join products p on p.id::text = e.key
       where e.value ~ '^[0-9]+(\.[0-9]+)?$'
         and (e.value)::numeric > 0
         and coalesce(p.in_stock, true);

      if v_items is not null and jsonb_array_length(v_items) > 0 then
        begin
          if v_tipo in ('jsonb', 'json') then
            execute 'insert into sealed_orders (id, family_id, period_id, total, sealed_at, retired, retired_at, items, sealed_auto)
                     values ($1, $2, $3, $4, now(), false, null, $5, true)'
              using 'auto-' || d.family_id || '-' || extract(epoch from now())::bigint,
                    d.family_id, per.id, round(v_total), v_items;   -- jsonb → json es cast de asignación
          else
            execute 'insert into sealed_orders (id, family_id, period_id, total, sealed_at, retired, retired_at, items, sealed_auto)
                     values ($1, $2, $3, $4, now(), false, null, $5, true)'
              using 'auto-' || d.family_id || '-' || extract(epoch from now())::bigint,
                    d.family_id, per.id, round(v_total), v_items::text;
          end if;
          sellados := sellados + 1;
        exception when unique_violation then
          null;   -- otra llamada lo selló en el mismo instante
        end;
      end if;

      delete from order_drafts where period_id = d.period_id and family_id = d.family_id;
    end loop;
  end loop;

  return sellados;
end $$;

grant execute on function coop_mover_saldo(text, integer),
                          coop_cobrar_pedido(text, integer),
                          coop_sellar_borradores(text)
  to authenticated, service_role;


-- ── Verificación ────────────────────────────────────────────────────────────
select
  (select count(*) from pg_indexes where indexname = 'idx_sealed_un_pedido') as indice_un_pedido,
  to_regclass('public.order_drafts') is not null                             as tabla_borradores,
  (select count(*) from pg_proc where proname in
     ('coop_mover_saldo', 'coop_cobrar_pedido', 'coop_sellar_borradores'))  as funciones_3;
