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

-- ─── PIN inicial para los administradores ───────────────────────────────────
-- Hash scrypt de "7777" calculado fuera de la base: hashear requiere el
-- servidor, no SQL. Cada uno con su propia sal, por eso son distintos.

update families set pin_hash = 'scrypt$16384$8$1$e30c1dd9c8278cdb3643d5ec2ad0da6f$551aabd14046990e3cf4058b6fb140724bfce63168e8865536189a7d52e6e306', pin = null, pin_set_at = now() where id = 'fabian';  -- Fabián González
update families set pin_hash = 'scrypt$16384$8$1$de5093117680ebdfdc94c5ee38887b84$587223cc1f11012238da6d82c4f4e4efde58ae04102502adc522472cf92d3a85', pin = null, pin_set_at = now() where id = 'ruby';  -- Ruby Parraguez

-- Verificación: los dos administradores deben aparecer con PIN configurado.
select id, name, role, (pin_hash is not null) as tiene_pin, pin as texto_plano
  from families where role = 'admin' order by name;
