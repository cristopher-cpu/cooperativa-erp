-- 015: permisos explícitos (GRANT) para las tablas de public.
--
-- Desde el 30-oct-2026 Supabase deja de conceder acceso automático de Data API
-- a las tablas nuevas de public. Las tablas existentes conservan sus permisos,
-- pero una reconstrucción del esquema (base nueva, rama de preview,
-- `supabase db reset`) crearía estas tablas sin permisos y la API respondería
-- "permission denied". Por eso el acceso queda escrito en las migraciones.
--
-- Los roles son los mismos que Supabase concede hoy por defecto. El control de
-- qué fila ve cada quien lo siguen haciendo las políticas RLS (migraciones
-- 010, 011 y 013), no estos GRANT.
--
-- Es idempotente: GRANT sobre una tabla existente no cambia nada.

grant select, insert, update, delete on
  admin_logs, bodega, bodega_assignments, bodega_bajas, cash_flow,
  charge_exemptions, families, order_adjustments, order_drafts,
  period_charges, periods, price_history, products, providers,
  purchase_orders, sealed_orders
to anon, authenticated, service_role;

-- Las columnas con identidad o serial (p. ej. bodega.product_id) necesitan
-- usar su secuencia para insertar.
grant usage, select on all sequences in schema public
to anon, authenticated, service_role;
