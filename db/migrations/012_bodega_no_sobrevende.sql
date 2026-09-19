-- ─────────────────────────────────────────────────────────────────────────────
-- 012 — LA BODEGA NO SE PUEDE SOBREVENDER
--
-- Idempotente. No borra datos.
--
-- ── El problema ─────────────────────────────────────────────────────────────
--
-- Hasta ahora, «¿queda stock?» lo comprobaba el navegador, contra la copia de
-- los datos que ese navegador tenía cargada. Con dos personas reservando el
-- último kilo al mismo tiempo, las dos ven «queda 1», las dos aprietan, y
-- quedan 2 reservados de 1 que había.
--
-- No es un error de la pantalla: es que la pregunta está hecha en el lugar
-- equivocado. Un navegador no puede saber lo que otro navegador está haciendo
-- en ese mismo segundo. La única que ve todo a la vez es la base.
--
-- ── Por qué un trigger y no una restricción (`check`) ───────────────────────
--
-- Una restricción solo puede mirar la fila que se está insertando. Acá la
-- respuesta depende de **la suma de las otras filas**: lo ya asignado a otras
-- familias y lo dado de baja por merma. Eso exige consultar, y consultar al
-- insertar es lo que hace un trigger.
--
-- ── Por qué `for update` ────────────────────────────────────────────────────
--
-- Es la parte que de verdad cierra el problema, y es fácil de omitir.
--
-- Sin él, dos inserciones simultáneas ejecutarían el trigger a la vez, las dos
-- leerían el mismo total de reservas —ninguna ve la de la otra, que todavía no
-- confirmó— y las dos pasarían la comprobación. Sería el mismo error de antes,
-- solo que movido de sitio.
--
-- `select ... for update` sobre la fila de `bodega` hace que la segunda espere
-- a que la primera termine. Recién entonces suma, y ahí sí ve la reserva de la
-- otra. La espera dura milisegundos y solo afecta a quienes reservan el MISMO
-- producto.
--
-- ── Qué NO hace ─────────────────────────────────────────────────────────────
--
-- No cambia el cálculo del saldo: eso lo sigue haciendo el trigger de la
-- migración 010. Este solo decide si la reserva se acepta o se rechaza.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function coop_validar_asignacion() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  en_bodega   numeric;
  ya_asignado numeric;
  de_baja     numeric;
  disponible  numeric;
  producto    text;
  formato     text;
begin
  if coalesce(new.quantity, 0) <= 0 then
    raise exception 'La cantidad a reservar tiene que ser mayor que cero.'
      using errcode = 'check_violation';
  end if;

  -- `for update` bloquea esta fila de bodega hasta el final de la transacción:
  -- es lo que impide que dos reservas simultáneas del mismo producto se crucen.
  select b.quantity, b.product_name, b.unit
    into en_bodega, producto, formato
    from bodega b
   where b.id = new.bodega_id
     for update;

  if not found then
    raise exception 'Ese producto ya no está en la bodega.'
      using errcode = 'foreign_key_violation';
  end if;

  select coalesce(sum(a.quantity), 0) into ya_asignado
    from bodega_assignments a
   where a.bodega_id = new.bodega_id
     and a.id is distinct from new.id;   -- por si algún día se actualiza una fila

  -- Lo dado de baja por merma, regalo o devolución tampoco está disponible.
  -- La tabla puede no existir todavía (migración 009), y en ese caso no resta.
  if to_regclass('public.bodega_bajas') is not null then
    execute 'select coalesce(sum(quantity), 0) from bodega_bajas where bodega_id = $1'
       into de_baja using new.bodega_id;
  else
    de_baja := 0;
  end if;

  disponible := coalesce(en_bodega, 0) - coalesce(ya_asignado, 0) - coalesce(de_baja, 0);

  if new.quantity > disponible then
    -- El mensaje lo lee una persona en la pantalla, así que dice el número que
    -- necesita saber, no el nombre de una tabla.
    raise exception 'Solo quedan % % de % en la bodega. Alguien más alcanzó a reservar antes; ajusta la cantidad.',
      trim(to_char(disponible, 'FM999999990.99')), coalesce(formato, ''), coalesce(producto, 'ese producto')
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_validar_asignacion on bodega_assignments;
create trigger trg_validar_asignacion
  before insert on bodega_assignments
  for each row execute function coop_validar_asignacion();


-- ── Verificación ────────────────────────────────────────────────────────────
--
-- `sobrevendido` tiene que ser 0 en todas las filas. Si alguna sale en positivo,
-- es una reserva de más que ya existía ANTES de este trigger: hay que resolverla
-- a mano con la familia, porque el producto ya no está.
select b.product_name                                  as producto,
       b.quantity                                      as en_bodega,
       coalesce(a.asignado, 0)                         as asignado,
       coalesce(x.de_baja, 0)                          as de_baja,
       b.quantity - coalesce(a.asignado, 0) - coalesce(x.de_baja, 0) as disponible,
       greatest(0, coalesce(a.asignado, 0) + coalesce(x.de_baja, 0) - b.quantity) as sobrevendido
  from bodega b
  left join (select bodega_id, sum(quantity) as asignado
               from bodega_assignments group by bodega_id) a on a.bodega_id = b.id
  left join (select bodega_id, sum(quantity) as de_baja
               from bodega_bajas group by bodega_id) x on x.bodega_id = b.id
 order by sobrevendido desc, b.product_name;
