-- ─────────────────────────────────────────────────────────────────────────────
-- Fase 2 · Etapa 4 — Perfiles múltiples por familia
--
-- Seguro de re-ejecutar. No borra datos.
--
-- Hasta ahora `role` era un solo valor: 'admin' o 'familia'. La cooperativa
-- trabaja por comisiones rotativas, y una misma familia puede estar en dos a la
-- vez (Retiro y Balance Contable, por ejemplo). Por eso el rol pasa de ser un
-- valor único a una lista.
--
-- La columna `role` NO se elimina: se mantiene sincronizada con 'admin' o
-- 'familia' para no romper nada de lo que ya la lee. Se podrá quitar cuando todo
-- el código use `roles`.
--
-- Los seis perfiles:
--   admin        Comisión Administrativa — acceso a todo
--   proveedores  Contacta proveedores, arma y envía órdenes de compra
--   recepcion    Recibe la mercadería del proveedor y la organiza
--   retiro       Entrega a las familias, registra faltantes y extras
--   contable     Flujo de caja, cruce de transferencias, pagos a proveedores
--   familia      Base: todos lo tienen, solo hace pedidos
--
-- Recepción y Retiro son SEPARADOS a pedido de la cooperativa: son dos acciones
-- en días distintos y, aunque a veces las haga la misma gente, por naturaleza
-- espacio-temporal pueden cambiar las personas.
--
-- OJO: esto organiza el acceso, no lo protege. Mientras RLS siga apagado, los
-- perfiles determinan qué se MUESTRA, no qué se puede hacer.
-- ─────────────────────────────────────────────────────────────────────────────

alter table families add column if not exists roles text[] not null default '{}';

-- Migrar lo que ya existe: quien era admin conserva admin, y todos son familia.
-- Solo toca las filas que aún no tienen roles, para poder re-ejecutar sin pisar
-- asignaciones hechas después desde el panel.
update families
   set roles = case
                 when role = 'admin' then array['admin', 'familia']
                 else array['familia']
               end
 where roles = '{}' or roles is null;

create index if not exists idx_families_roles on families using gin (roles);


-- ── Verificación ────────────────────────────────────────────────────────────
select name, role, roles
  from families
 order by array_length(roles, 1) desc nulls last, name;
