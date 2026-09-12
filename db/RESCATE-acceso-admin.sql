-- ─────────────────────────────────────────────────────────────────────────────
-- RESCATE — recuperar el acceso de administrador
--
-- Úsalo si NINGÚN administrador puede entrar: PIN olvidado, o alguien quedó
-- encerrado fuera. Se ejecuta en Supabase → SQL Editor.
--
-- Por qué hace falta: el PIN se guarda cifrado y cifrar requiere el servidor,
-- así que no se puede "poner un PIN" desde SQL escribiéndolo en claro. Lo que sí
-- se puede es QUITARLO y volver a entrar sin él para asignar uno nuevo desde el
-- panel.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── Opción A (la habitual): degradar temporalmente a Familia ────────────────
-- Un admin sin PIN no puede entrar, pero una familia sin PIN sí. Se baja el rol,
-- se entra, y desde el panel de otro admin se vuelve a subir.
--
-- OJO: esto solo sirve si queda OTRO administrador que pueda devolverte el rol.

-- update families set role = 'familia' where id = 'fabian';


-- ─── Opción B: quitar el PIN y abrir el acceso directo ───────────────────────
-- Deja al administrador sin PIN Y lo pasa a familia, para poder entrar. Después,
-- ya adentro, hay que volver a ponerse rol admin y asignarse un PIN nuevo.
--
-- Mientras esto esté aplicado, CUALQUIERA que abra el sitio puede entrar con esa
-- cuenta. Hazlo y revierte el mismo día.

-- update families
--    set pin_hash = null, pin = null, pin_set_at = null, role = 'familia'
--  where id = 'fabian';

-- ...entrar al sitio, y luego devolverle el rol:
-- update families set role = 'admin' where id = 'fabian';
-- ...y asignarle un PIN nuevo desde el panel (Familias → Asignar PIN).


-- ─── Opción C: crear un administrador de emergencia ──────────────────────────
-- Sin PIN, para entrar una sola vez. BORRARLO apenas se recupere el acceso.

-- insert into families (id, name, initials, balance, role, email)
-- values ('rescate', 'Acceso de rescate', 'AR', 0, 'familia', 'rescate@local');
-- ...entrar con esa cuenta, promoverla a admin desde otro admin, o bien:
-- update families set role = 'admin' where id = 'rescate';
-- ...y al terminar:
-- delete from families where id = 'rescate';


-- ─── Diagnóstico: quién puede entrar hoy ─────────────────────────────────────
select
  name,
  role,
  (pin_hash is not null)                    as tiene_pin,
  case
    when role = 'admin' and pin_hash is null then 'BLOQUEADO — admin sin PIN'
    when pin_hash is not null                then 'entra con PIN'
    else                                          'entra sin PIN'
  end as estado,
  last_login_at
from families
order by role, name;
