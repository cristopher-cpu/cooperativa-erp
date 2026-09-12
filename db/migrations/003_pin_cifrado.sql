-- ─────────────────────────────────────────────────────────────────────────────
-- Fase 2 · Parche de seguridad mínimo — PIN cifrado y verificado en el servidor
--
-- Seguro de re-ejecutar. No borra datos.
--
-- Problema que resuelve: hoy families.pin guarda el PIN en texto plano, y
-- getFamilies() hace select('*'), así que TODOS los PIN viajan al navegador de
-- cualquiera que abra el sitio. La comparación además ocurre en el cliente
-- (App.js), donde no protege nada.
--
-- Después de esta migración el PIN vive cifrado en pin_hash, se verifica en
-- /api/login, y la columna pin (texto plano) deja de usarse.
--
-- OJO: esto NO reemplaza a RLS. Mientras RLS siga apagado, cualquiera con la
-- clave pública puede leer y escribir las tablas saltándose la aplicación. Esto
-- cierra el acceso por la interfaz, no el acceso directo a la base.
-- ─────────────────────────────────────────────────────────────────────────────

alter table families add column if not exists pin_hash text;

-- Rastro para detectar fuerza bruta y para poder bloquear si algún día hace falta.
alter table families add column if not exists pin_set_at    timestamptz;
alter table families add column if not exists last_login_at timestamptz;

-- Si hubiera PIN en texto plano, queda a la vista para migrarlo a mano desde el
-- panel. No se migra automáticamente: hashear requiere el servidor, no SQL.
select
  count(*) filter (where pin is not null)      as con_pin_texto_plano,
  count(*) filter (where pin_hash is not null) as con_pin_cifrado,
  count(*) filter (where role = 'admin')       as administradores,
  count(*)                                     as total_familias
from families;
