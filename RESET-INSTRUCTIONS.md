# Reiniciar para el piloto MVP

**Cuándo:** una sola vez, antes del piloto que parte el viernes 2 de octubre de 2026.
Deja la base con un solo período (el MVP) y los saldos reales de partida que informó Ruby.

> El botón **🔄 Reset Demo** del panel se eliminó. Ponía todos los saldos en 0 con un clic,
> y desde el piloto los saldos son reales. Además estaba roto (buscaba un período `P_DEMO`
> que no es el activo).

## Pasos

1. Supabase → **SQL Editor** → nueva consulta.
2. Pega `db/RESET-inicio-piloto-mvp.sql`.
3. Ejecuta **solo el PASO 1** (la primera consulta). Tiene que salir un período activo con
   «MVP» en el nombre y las tres personas: `fabian`, `paty`, `ruby`.
4. Ejecuta el **PASO 2** completo (va en una transacción: si algo falla, no se borra nada;
   y se niega a correr si el período activo no es el MVP o falta alguna de las tres).
5. Ejecuta el **PASO 3** para comprobar.
6. Recién después, ejecuta `db/migrations/013_saldos_atomicos_y_borradores.sql`.
7. En el panel: **Período → Modificar fechas** (apertura viernes 2 de octubre, cierre, etc.).

## Qué se borra y qué no

| Se borra | No se toca |
|---|---|
| Períodos anteriores | Familias (nombres, correos, PIN) |
| Todos los pedidos y carritos | Comisiones de cada familia |
| Faltantes y extras | Proveedores |
| Órdenes de compra | Productos, precios e historial de precios |
| Bodega, reservas y mermas | Cargos fijos del período MVP |
| Todo el flujo de caja | Registro de actividad |
| Fechas del período MVP (se ponen de nuevo) | |

## Saldos que quedan

| Familia | Saldo |
|---|---|
| Fabián González | +$3.650 a favor |
| Patricia Vila | +$2.250 a favor |
| Ruby Parraguez | −$3.200 pendiente |
| Todas las demás | $0 |

Queda escrito en **Actividad** por qué cambiaron.
