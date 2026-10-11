-- ─────────────────────────────────────────────────────────────────────────────
-- REINICIO PARA EL PILOTO — período MVP con los saldos reales de partida
--
-- Pedido de la cooperativa (reunión del 27-sep-2026 y correo de Ruby):
-- limpiar todo lo de prueba y dejar un solo período, el MVP, con los saldos
-- reales de las tres personas que hacen el piloto desde el viernes 2 de
-- octubre:
--
--     Fabián González   +$3.650   a favor
--     Patricia Vila     +$2.250   a favor
--     Ruby Parraguez    −$3.200   pendiente
--
-- En la base, `balance` positivo = a favor de la familia, negativo = debe.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- QUÉ SE BORRA                         QUÉ NO SE TOCA
-- ═════════════════════════════════════════════════════════════════════════════
--   · Todos los períodos anteriores      · Familias: nombres, correos, PIN
--   · Todos los pedidos                  · Comisiones (perfiles de cada una)
--   · Carritos guardados                 · Proveedores
--   · Faltantes y extras                 · Productos, precios e historial
--   · Órdenes de compra                  · Cargos fijos del período MVP
--   · Bodega, reservas y mermas          · Registro de actividad (auditoría)
--   · Todo el flujo de caja
--   · Los demás saldos quedan en 0
-- ═════════════════════════════════════════════════════════════════════════════
--
-- CÓMO USARLO: Supabase → SQL Editor. Correr el PASO 1 solo, mirar el
-- resultado, y recién entonces el PASO 2 completo.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── PASO 1 · Mirar antes de borrar ──────────────────────────────────────────
--
-- Tiene que salir UN período activo con «MVP» en el nombre, y las tres
-- personas con su id. Si el período activo se llama distinto, o falta alguna
-- de las tres, PARA: el paso 2 se va a negar a correr de todas formas.

select 'periodo activo' as que, id, label as detalle, null::integer as saldo_actual
  from periods where active = true
union all
select 'periodo que se borra', id, label, null from periods where active is not true
union all
select 'persona del piloto', id, name, balance
  from families where id in ('fabian', 'paty', 'ruby')
order by 1, 3;


-- ── PASO 2 · Reiniciar ──────────────────────────────────────────────────────
--
-- En una transacción: si cualquier cosa falla, no se borra nada.

begin;

do $$
declare
  n_activos integer;
  mvp       record;
  faltan    text;
begin
  select count(*) into n_activos from periods where active = true;
  if n_activos <> 1 then
    raise exception 'Hay % períodos activos; tiene que haber exactamente uno (el MVP).', n_activos;
  end if;

  select * into mvp from periods where active = true;
  if mvp.label !~* 'mvp' then
    raise exception 'El período activo se llama "%", no parece el MVP. Revisa antes de seguir.', mvp.label;
  end if;

  select string_agg(x, ', ') into faltan
    from unnest(array['fabian', 'paty', 'ruby']) x
   where not exists (select 1 from families f where f.id = x);
  if faltan is not null then
    raise exception 'No existen estas familias: %. No se reinicia nada.', faltan;
  end if;
end $$;

-- Lo que depende de otra cosa, primero. Se borra TODO (no solo el período
-- activo): los períodos anteriores también se van.
do $$ begin
  if to_regclass('public.bodega_bajas') is not null then execute 'delete from bodega_bajas'; end if;
end $$;
-- Al borrar reservas, el trigger de la 011 devuelve su monto al saldo. No
-- importa: los saldos se escriben a mano al final.
delete from bodega_assignments;
delete from bodega;
do $$ begin
  if to_regclass('public.order_adjustments') is not null then execute 'delete from order_adjustments'; end if;
end $$;
delete from purchase_orders;
delete from cash_flow;
do $$ begin
  if to_regclass('public.order_drafts') is not null then execute 'delete from order_drafts'; end if;
end $$;
delete from sealed_orders;

-- Los cargos y exenciones de los períodos que se van. Los del MVP se quedan.
do $$ begin
  if to_regclass('public.charge_exemptions') is not null then
    execute 'delete from charge_exemptions where period_id not in (select id from periods where active = true)';
  end if;
  if to_regclass('public.period_charges') is not null then
    execute 'delete from period_charges where period_id not in (select id from periods where active = true)';
  end if;
end $$;

delete from periods where active is not true;

-- El MVP queda como recién creado: sin resumen de cierre, sin cierre manual de
-- pedidos y sin fechas. Las fechas las pone la cooperativa en Período → Modificar
-- fechas (apertura el viernes 2 de octubre).
update periods
   set orders_closed_at = null,
       closed_at = null,
       summary = null,
       date_from = null,
       date_to = null,
       date_confirm_until = null,
       date_delivery = null,
       date_adjust_until = null
 where active = true;

-- Saldos: todos en cero, y los tres del piloto con lo que informó Ruby.
update families set balance = 0;
update families set balance =  3650 where id = 'fabian';
update families set balance =  2250 where id = 'paty';
update families set balance = -3200 where id = 'ruby';

-- Que quede escrito por qué cambiaron los saldos. Sin esto, en un mes nadie
-- sabe de dónde salió el −3.200 de Ruby.
insert into admin_logs (id, admin_id, admin_name, action, details)
values (
  'reset-mvp-' || extract(epoch from now())::bigint,
  'sistema', 'Reinicio piloto MVP', 'saldos_iniciales',
  'Reinicio para el piloto: se borraron períodos anteriores, pedidos y flujo de caja. ' ||
  'Saldos de partida según correo de Ruby Parraguez: Fabián González +3.650, ' ||
  'Patricia Vila +2.250, Ruby Parraguez −3.200. El resto de las familias en 0.'
);

commit;


-- ── PASO 3 · Comprobar ──────────────────────────────────────────────────────
--
-- Todo en 0 salvo `periodos` (1) y los tres saldos.

select
  (select count(*) from periods)            as periodos,
  (select label from periods where active)  as periodo_activo,
  (select count(*) from sealed_orders)      as pedidos,
  (select count(*) from order_adjustments)  as faltantes_y_extras,
  (select count(*) from purchase_orders)    as ordenes_de_compra,
  (select count(*) from bodega)             as items_bodega,
  (select count(*) from cash_flow)          as movimientos_caja,
  (select count(*) from families where balance <> 0) as familias_con_saldo;

select id, name, balance from families where balance <> 0 order by name;
