-- ─────────────────────────────────────────────────────────────────────────────
-- Fase 2 — AUTENTICACIÓN REAL: RLS encendido
--
-- Cierra los dos hallazgos críticos de la revisión del 12-sep-2026:
--
--   1. El panel admin estaba abierto a internet.
--   2. La base era legible Y ESCRIBIBLE sin autenticación. Verificado de nuevo
--      el 18-sep-2026 desde fuera de la aplicación: las diecisiete familias con
--      sus correos y saldos se descargaban con un solo comando.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- ANTES DE EJECUTAR ESTO — leer completo, en este orden
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Esta migración es la única de toda la fase que puede dejar a la cooperativa
-- sin poder trabajar. No es reversible con un clic: hay que volver a apagar RLS
-- tabla por tabla. Los cuatro pasos van en este orden y ninguno se salta.
--
-- PASO 1 · Configurar dos variables en Vercel (Settings → Environment
--          Variables), **sin** prefijo REACT_APP_:
--
--          SUPABASE_JWT_SECRET
--            Supabase → Project Settings → API (o JWT Keys) → JWT Secret.
--            Con esto /api/login firma la sesión. Sin esto, nadie ve nada
--            después de entrar.
--
--          SUPABASE_SERVICE_ROLE_KEY
--            Supabase → Project Settings → API → service_role.
--            Con esto el servidor puede verificar PIN y armar la pantalla de
--            ingreso. Sin esto, no se puede ni entrar.
--
--          El prefijo REACT_APP_ incrustaría ambas en el JavaScript público. Con
--          el secreto JWT ahí, cualquiera se emite un token de administrador;
--          con la clave de servicio ahí, RLS deja de servir para nada — sería
--          PEOR que no haberlo encendido, porque parecería protegido.
--
-- PASO 2 · Desplegar la aplicación con esas variables ya puestas.
--
--          Y ACÁ VA LA PRUEBA QUE AHORRA LA TARDE MALA. Con RLS todavía
--          apagado, entrar y trabajar normalmente ya demuestra que Supabase
--          ACEPTA el token firmado: si la firma no le sirviera, PostgREST
--          respondería 401 a cada consulta y la aplicación se caería de
--          inmediato, no después. Así se separa el riesgo en dos:
--
--            · Si después de desplegar todo funciona igual → la firma vale, y
--              el paso 4 es seguro.
--            · Si sale la franja roja diciendo que Supabase rechazó la sesión →
--              el secreto no corresponde, o el proyecto firma con claves
--              asimétricas y el secreto HS256 ya no vale. **No ejecutar el paso
--              4 hasta resolverlo**, porque con RLS encendido y sin firma
--              válida nadie puede trabajar.
--
--          `/api/estado` dice si las dos variables están puestas
--          (`sesionFirmada` y `claveDeServicio`), sin revelar su valor.
--
-- PASO 3 · Asignarle PIN a toda cuenta con perfil de panel. Al 18-sep-2026 hay
--          12 con perfil y solo 2 con PIN: las otras 10 no van a poder entrar.
--          El panel las lista en rojo en la pestaña Familias. Fabián y Ruby
--          tienen PIN, así que pueden entrar a ponerlos.
--
--          Correr esta consulta para verlas:
--            select name, roles from families
--             where pin_hash is null
--               and exists (select 1 from unnest(roles) r where r <> 'familia');
--
-- PASO 4 · Recién entonces, ejecutar esto.
--
-- ── Cómo volver atrás si algo sale mal ──────────────────────────────────────
--
-- Al final del archivo, comentado, está el bloque que apaga RLS en todas las
-- tablas. Deja el sistema como estaba: abierto, pero funcionando.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- CÓMO FUNCIONA
-- ═════════════════════════════════════════════════════════════════════════════
--
-- `/api/login` verifica el PIN con scrypt y emite un JWT HS256 firmado con el
-- secreto del proyecto. El navegador lo manda en cada consulta y las políticas
-- de acá leen sus claims.
--
-- ── Por qué NO se usa auth.uid() ────────────────────────────────────────────
--
-- `auth.uid()` de Supabase hace `(claims->>'sub')::uuid`, y los `families.id`
-- de esta base son TEXT ('fabian', '1757...'), no UUID: el casteo reventaría en
-- cada consulta. Las políticas leen `auth.jwt() ->> 'family_id'`, que es texto.
--
-- ── Por qué los perfiles vienen en el token y no de la tabla ────────────────
--
-- Una política que consultara `families.roles` para decidir si alguien puede
-- leer `families` se muerde la cola: necesita leer la tabla que está
-- protegiendo. Los perfiles van firmados dentro del token, los pone el servidor
-- al verificar el PIN, y el navegador no puede alterarlos sin romper la firma.
--
-- ── Qué NO protege esto ─────────────────────────────────────────────────────
--
-- Un token válido de una comisión permite todo lo que esa comisión puede hacer,
-- incluso saltándose la interfaz. Eso es correcto: son socias de confianza con
-- una credencial verificada. Lo que se cierra es el acceso de QUIEN NO TIENE
-- credencial, que es el problema real de un sitio publicado.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── Funciones auxiliares ────────────────────────────────────────────────────
--
-- En el esquema público y con `security definer` para que puedan leer los claims
-- sin depender de permisos del llamador. `stable` permite a Postgres evaluarlas
-- una vez por consulta en vez de una vez por fila: con 82 productos y 17
-- familias da lo mismo, con tres años de histórico no.

create or replace function coop_family_id() returns text
language sql stable security definer set search_path = public as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'family_id', '');
$$;

create or replace function coop_roles() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(
    array(select jsonb_array_elements_text(
      coalesce(current_setting('request.jwt.claims', true)::jsonb -> 'roles', '[]'::jsonb)
    )),
    '{}'::text[]
  );
$$;

-- ¿Tiene este perfil? `admin` abre todo, igual que en la interfaz.
create or replace function coop_tiene(rol text) returns boolean
language sql stable security definer set search_path = public as $$
  select 'admin' = any(coop_roles()) or rol = any(coop_roles());
$$;

-- ¿Hay una sesión firmada, cualquiera que sea?
create or replace function coop_autenticado() returns boolean
language sql stable security definer set search_path = public as $$
  select coop_family_id() is not null;
$$;

-- ¿Puede operar el ciclo? Son los perfiles que mueven datos de la cooperativa,
-- a diferencia de una familia que solo maneja lo suyo.
create or replace function coop_comision() returns boolean
language sql stable security definer set search_path = public as $$
  select coop_roles() && array['admin','proveedores','recepcion','retiro','contable'];
$$;

-- ¿La fila que la familia quiere dejar conserva todo lo que no le corresponde
-- cambiar?
--
-- Tiene que ser una función `security definer` y no una subconsulta dentro de la
-- política: una subconsulta a `families` dentro de una política DE `families` se
-- muerde la cola y Postgres aborta con «infinite recursion detected in policy».
-- Como `security definer` corre con los permisos del dueño de la tabla, que está
-- exento de RLS, la lectura no vuelve a pasar por la política.
create or replace function coop_conserva_lo_ajeno(
  nuevo_roles text[], nuevo_role text, nuevo_pin text, nuevo_balance integer
) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from families f
     where f.id = coop_family_id()
       and f.roles    is not distinct from nuevo_roles
       and f.role     is not distinct from nuevo_role
       and f.pin_hash is not distinct from nuevo_pin
       and f.balance  is not distinct from nuevo_balance
  );
$$;

grant execute on function coop_family_id, coop_roles, coop_tiene, coop_autenticado,
                          coop_comision, coop_conserva_lo_ajeno
  to anon, authenticated;


-- ── families ───────────────────────────────────────────────────────────────
--
-- La tabla más sensible: correos y saldos de las diecisiete familias.
--
-- Nadie sin sesión lee nada. La pantalla de ingreso no consulta esta tabla:
-- usa /api/portada, que corre con la clave de servicio y devuelve solo nombres,
-- iniciales y si cada uno tiene PIN.
--
-- Una familia se ve a sí misma. Y ve a las demás también, porque la aplicación
-- necesita nombres para mostrar quién pidió qué en el consolidado y en el
-- retiro. Eso ya era así y es coherente con una cooperativa de barrio donde
-- todas se conocen; lo que cambia es que ahora hay que estar adentro.
--
-- Escribir su propio saldo NO: eso lo hace Administración o Balance Contable.
-- Antes cualquiera podía editarse el saldo desde la consola del navegador.

alter table families enable row level security;

drop policy if exists families_leer on families;
create policy families_leer on families
  for select using (coop_autenticado());

-- Una familia puede corregir sus correos. **Su saldo no**, y eso es lo más
-- importante de esta migración después de cerrar la lectura: hasta ahora
-- cualquier socia podía ponerse el saldo en cero desde la consola del navegador
-- y nadie se habría enterado.
--
-- Los perfiles y el PIN tampoco: asignarse Administración a sí misma sería
-- saltarse todo lo demás de este archivo.
drop policy if exists families_editar_propio on families;
create policy families_editar_propio on families
  for update using (id = coop_family_id())
  with check (
    id = coop_family_id()
    and coop_conserva_lo_ajeno(roles, role, pin_hash, balance)
  );

drop policy if exists families_admin on families;
create policy families_admin on families
  for all using (coop_tiene('admin') or coop_tiene('contable'))
  with check (coop_tiene('admin') or coop_tiene('contable'));


-- ── Catálogo: products, providers ──────────────────────────────────────────
--
-- Todas las socias leen el catálogo: es lo que necesitan para pedir. Escribir
-- el maestro es de la Comisión Proveedores.
--
-- `providers` incluye correos y notas de los proveedores, así que tampoco sale
-- al público: era parte de lo que se descargaba sin credencial.

alter table products enable row level security;
drop policy if exists products_leer on products;
create policy products_leer on products for select using (coop_autenticado());
drop policy if exists products_escribir on products;
create policy products_escribir on products
  for all using (coop_tiene('proveedores')) with check (coop_tiene('proveedores'));

alter table providers enable row level security;
drop policy if exists providers_leer on providers;
create policy providers_leer on providers for select using (coop_autenticado());
drop policy if exists providers_escribir on providers;
create policy providers_escribir on providers
  for all using (coop_tiene('proveedores')) with check (coop_tiene('proveedores'));


-- ── periods, period_charges, charge_exemptions ─────────────────────────────
--
-- Las fechas y los cargos los ve todo el mundo: la familia tiene que saber
-- hasta cuándo puede pedir y por qué se le cobra. Cambiarlos es de
-- Administración, y los cargos también de Balance Contable.

alter table periods enable row level security;
drop policy if exists periods_leer on periods;
create policy periods_leer on periods for select using (coop_autenticado());
drop policy if exists periods_escribir on periods;
create policy periods_escribir on periods
  for all using (coop_tiene('admin')) with check (coop_tiene('admin'));

do $$ begin
  if to_regclass('public.period_charges') is not null then
    execute 'alter table period_charges enable row level security';
    execute 'drop policy if exists charges_leer on period_charges';
    execute 'create policy charges_leer on period_charges for select using (coop_autenticado())';
    execute 'drop policy if exists charges_escribir on period_charges';
    execute 'create policy charges_escribir on period_charges for all using (coop_tiene(''contable'')) with check (coop_tiene(''contable''))';
  end if;

  if to_regclass('public.charge_exemptions') is not null then
    execute 'alter table charge_exemptions enable row level security';
    execute 'drop policy if exists exempt_leer on charge_exemptions';
    execute 'create policy exempt_leer on charge_exemptions for select using (coop_autenticado())';
    execute 'drop policy if exists exempt_escribir on charge_exemptions';
    execute 'create policy exempt_escribir on charge_exemptions for all using (coop_tiene(''contable'')) with check (coop_tiene(''contable''))';
  end if;
end $$;


-- ── sealed_orders ──────────────────────────────────────────────────────────
--
-- Una familia solo escribe SU pedido. Antes cualquiera podía sellar, modificar
-- o borrar el pedido de otra desde la consola del navegador.
--
-- Leer los de todas sí: el consolidado, las órdenes de compra y el retiro se
-- construyen sobre el conjunto. Marcar retirado y cobrar es de las comisiones.

alter table sealed_orders enable row level security;

drop policy if exists ordenes_leer on sealed_orders;
create policy ordenes_leer on sealed_orders for select using (coop_autenticado());

drop policy if exists ordenes_familia on sealed_orders;
create policy ordenes_familia on sealed_orders
  for insert with check (family_id = coop_family_id());

drop policy if exists ordenes_familia_borrar on sealed_orders;
create policy ordenes_familia_borrar on sealed_orders
  -- Solo mientras no esté retirado: "Modificar" borra la fila y vuelve a
  -- sellar, y eso no puede ocurrir después de que la caja se entregó.
  for delete using (family_id = coop_family_id() and retired is not true);

drop policy if exists ordenes_comision on sealed_orders;
create policy ordenes_comision on sealed_orders
  for all using (coop_comision()) with check (coop_comision());


-- ── order_adjustments ──────────────────────────────────────────────────────
--
-- Una familia registra y borra SUS faltantes y extras, y solo los que ella misma
-- puso (`source = 'familia'`): lo que anotó el proveedor o la comisión no se
-- toca. Es la misma regla que `puedeBorrarAjuste` en calculos.js, ahora también
-- en la base.
--
-- La ventana de fechas NO se expresa acá: la Comisión Retiro puede corregir
-- siempre, y meter la fecha en la política dejaría sin válvula un olvido de un
-- día. Ese límite lo pone la interfaz, y es una decisión operativa, no de
-- seguridad.

do $$ begin
  if to_regclass('public.order_adjustments') is null then return; end if;

  execute 'alter table order_adjustments enable row level security';

  execute 'drop policy if exists ajustes_leer on order_adjustments';
  execute 'create policy ajustes_leer on order_adjustments for select using (coop_autenticado())';

  execute 'drop policy if exists ajustes_familia_crear on order_adjustments';
  execute 'create policy ajustes_familia_crear on order_adjustments
             for insert with check (family_id = coop_family_id() and source = ''familia'')';

  execute 'drop policy if exists ajustes_familia_borrar on order_adjustments';
  execute 'create policy ajustes_familia_borrar on order_adjustments
             for delete using (family_id = coop_family_id() and source = ''familia'')';

  execute 'drop policy if exists ajustes_comision on order_adjustments';
  execute 'create policy ajustes_comision on order_adjustments
             for all using (coop_tiene(''retiro'') or coop_tiene(''recepcion'') or coop_tiene(''contable''))
             with check (coop_tiene(''retiro'') or coop_tiene(''recepcion'') or coop_tiene(''contable''))';
end $$;


-- ── purchase_orders ────────────────────────────────────────────────────────
--
-- OJO, esta es distinta a todas: el proveedor confirma su orden **sin estar
-- autenticado**, desde el enlace con token secreto que le llegó por correo. Esa
-- confirmación la escribe `/api/confirmar` con la clave de servicio, que se
-- salta RLS — por eso la política pública puede negar todo sin romper el flujo.
--
-- Lo que no puede pasar es que las órdenes queden legibles para cualquiera:
-- contienen los precios y las cantidades que la cooperativa le compra a cada
-- proveedor, y un proveedor no debe ver lo de otro.

alter table purchase_orders enable row level security;
drop policy if exists oc_leer on purchase_orders;
create policy oc_leer on purchase_orders for select using (coop_autenticado());
drop policy if exists oc_escribir on purchase_orders;
create policy oc_escribir on purchase_orders
  for all using (coop_tiene('proveedores')) with check (coop_tiene('proveedores'));


-- ── cash_flow, bodega, bodega_assignments, bodega_bajas ────────────────────
--
-- El flujo de caja es de Balance Contable. La bodega la trabajan Recepción y
-- Retiro, y las familias necesitan leerla para reservar.

alter table cash_flow enable row level security;

-- Una familia ve los movimientos que la afectan a ella. El flujo completo de la
-- cooperativa es de Balance Contable.
drop policy if exists caja_leer on cash_flow;
create policy caja_leer on cash_flow
  for select using (coop_tiene('contable') or family_id = coop_family_id());

drop policy if exists caja_escribir on cash_flow;
create policy caja_escribir on cash_flow
  for all using (coop_tiene('contable')) with check (coop_tiene('contable'));

-- Registrar una merma en bodega **genera un egreso**, y eso lo hace Recepción o
-- Retiro, no Balance Contable. Con solo la política de arriba, la merma se
-- guardaría y la pérdida no llegaría nunca a la caja — que es exactamente lo
-- que la etapa 7 vino a arreglar.
--
-- Se les permite solo lo que ese flujo necesita: crear el egreso, y borrarlo si
-- se deshace la baja. El borrado está acotado a las filas que nacieron de una
-- baja (`id` empieza con 'baja-', como las nombra `addBaja`), así que no pueden
-- borrar un pago de una familia ni una compra a un proveedor.
drop policy if exists caja_bodega_crear on cash_flow;
create policy caja_bodega_crear on cash_flow
  for insert with check (coop_tiene('recepcion') or coop_tiene('retiro'));

drop policy if exists caja_bodega_borrar on cash_flow;
create policy caja_bodega_borrar on cash_flow
  for delete using (
    id like 'baja-%' and (coop_tiene('recepcion') or coop_tiene('retiro'))
  );

-- El stock y las bajas los manejan Recepción y Retiro. Las familias solo leen:
-- lo necesitan para ver qué hay disponible para reservar.
do $$
declare
  t text;
begin
  foreach t in array array['bodega','bodega_bajas'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_leer', t);
    execute format('create policy %I on %I for select using (coop_autenticado())', t || '_leer', t);
    execute format('drop policy if exists %I on %I', t || '_escribir', t);
    execute format(
      'create policy %I on %I for all using (coop_tiene(''recepcion'') or coop_tiene(''retiro'')) '
      'with check (coop_tiene(''recepcion'') or coop_tiene(''retiro''))', t || '_escribir', t);
  end loop;
end $$;

-- `bodega_assignments` es la excepción y hay que tratarla aparte: una FAMILIA
-- reserva de la bodega por su cuenta, desde su propia vista. Con la política de
-- arriba —solo Recepción y Retiro escriben— reservar habría dejado de
-- funcionar para las diecisiete familias.
--
-- Puede crear y cancelar solo SUS reservas. El cargo al saldo lo aplica el
-- trigger de más abajo, así que no necesita tocar `families`.
do $$ begin
  if to_regclass('public.bodega_assignments') is null then return; end if;

  execute 'alter table bodega_assignments enable row level security';

  execute 'drop policy if exists asig_leer on bodega_assignments';
  execute 'create policy asig_leer on bodega_assignments for select using (coop_autenticado())';

  execute 'drop policy if exists asig_familia_crear on bodega_assignments';
  execute 'create policy asig_familia_crear on bodega_assignments
             for insert with check (family_id = coop_family_id())';

  execute 'drop policy if exists asig_familia_borrar on bodega_assignments';
  execute 'create policy asig_familia_borrar on bodega_assignments
             for delete using (family_id = coop_family_id())';

  execute 'drop policy if exists asig_comision on bodega_assignments';
  execute 'create policy asig_comision on bodega_assignments
             for all using (coop_tiene(''recepcion'') or coop_tiene(''retiro''))
             with check (coop_tiene(''recepcion'') or coop_tiene(''retiro''))';
end $$;


-- ── El saldo de una reserva de bodega lo mueve la base, no el navegador ────
--
-- Una familia puede reservar de la bodega, y eso le carga el monto a su saldo.
-- Hasta ahora ese cargo lo escribía el navegador: leía el saldo, le restaba y lo
-- sobrescribía. Con la política de arriba —la familia no puede tocar su saldo—
-- esa escritura queda rechazada, y sin reemplazo la reserva dejaría de cobrarse.
--
-- El reemplazo es un trigger, y es mejor que lo que había por dos razones:
--
--   1. Es la base la que aplica el cargo, así que la familia no necesita —ni
--      puede— escribir su propio saldo.
--   2. `balance = balance - x` en el servidor es atómico. El camino anterior era
--      leer-modificar-escribir desde el cliente: dos personas asignando a la vez
--      perdían un cargo sin aviso. Es uno de los ocho lugares con ese patrón que
--      anota la deuda técnica; éste queda cerrado.
--
-- La aplicación se da cuenta sola de si el trigger existe: después de insertar
-- vuelve a leer el saldo, y si no se movió aplica el cargo como antes. Así
-- funciona igual con esta migración corrida o sin ella, y nunca cobra dos veces.

create or replace function coop_cargar_asignacion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update families set balance = coalesce(balance, 0) - coalesce(new.total_value, 0)
     where id = new.family_id;
  elsif tg_op = 'DELETE' then
    update families set balance = coalesce(balance, 0) + coalesce(old.total_value, 0)
     where id = old.family_id;
  end if;
  return null;
end $$;

do $$ begin
  if to_regclass('public.bodega_assignments') is not null then
    execute 'drop trigger if exists trg_cargar_asignacion on bodega_assignments';
    execute 'create trigger trg_cargar_asignacion
               after insert or delete on bodega_assignments
               for each row execute function coop_cargar_asignacion()';
  end if;
end $$;


-- ── admin_logs, price_history ──────────────────────────────────────────────
--
-- El registro de actividad es de Administración. Y **nadie lo borra**: un log
-- que se puede borrar no sirve para auditar, así que no hay política de delete
-- ni de update. Solo insertar y leer.

alter table admin_logs enable row level security;
drop policy if exists logs_leer on admin_logs;
create policy logs_leer on admin_logs for select using (coop_tiene('admin'));
drop policy if exists logs_crear on admin_logs;
create policy logs_crear on admin_logs for insert with check (coop_comision());

do $$ begin
  if to_regclass('public.price_history') is not null then
    execute 'alter table price_history enable row level security';
    execute 'drop policy if exists precios_leer on price_history';
    execute 'create policy precios_leer on price_history for select using (coop_autenticado())';
    execute 'drop policy if exists precios_crear on price_history';
    execute 'create policy precios_crear on price_history for insert with check (coop_tiene(''proveedores''))';
    -- La reversión de una importación necesita poder leer y reescribir precios,
    -- no borrar el historial: la reversión deja su propia fila.
  end if;
end $$;


-- ── inventory y movements ──────────────────────────────────────────────────
--
-- Vacías y sin ningún llamador (verificado el 18-sep-2026). Se les enciende RLS
-- sin ninguna política: quedan cerradas a todo el mundo. No se borran acá porque
-- borrar tablas es irreversible y no urge; lo que urge es que no sean una puerta
-- abierta olvidada.

do $$
declare
  t text;
begin
  foreach t in array array['inventory','movements'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;


-- ── Verificación ────────────────────────────────────────────────────────────
--
-- Toda tabla de `public` debe aparecer con rls = true. Si alguna dice false,
-- esa es una puerta que sigue abierta.
select c.relname                    as tabla,
       c.relrowsecurity             as rls,
       count(p.polname)             as politicas
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policy p on p.polrelid = c.oid
 where n.nspname = 'public' and c.relkind = 'r'
 group by c.relname, c.relrowsecurity
 order by c.relrowsecurity, c.relname;


-- ═════════════════════════════════════════════════════════════════════════════
-- VOLVER ATRÁS — solo si algo salió mal y hay que operar ya
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Deja el sistema como estaba: abierto a internet, pero funcionando. Es una
-- decisión de emergencia, no una alternativa: mientras esté así, cualquiera con
-- la URL se descarga los correos y saldos de las diecisiete familias.
--
-- do $$
-- declare t text;
-- begin
--   foreach t in array array[
--     'families','products','providers','periods','period_charges',
--     'charge_exemptions','sealed_orders','order_adjustments','purchase_orders',
--     'cash_flow','bodega','bodega_assignments','bodega_bajas','admin_logs',
--     'price_history','inventory','movements'
--   ] loop
--     if to_regclass('public.' || t) is not null then
--       execute format('alter table %I disable row level security', t);
--     end if;
--   end loop;
-- end $$;
