# Fase 2 — Estado, decisiones y pendientes

Cooperativa de Consumo Responsable **Quilpueblo**.
Última actualización: 6 de septiembre de 2026.

---

## 1. Qué está funcionando

### Etapa 1 — Proveedores como entidad ✅

Antes el proveedor era texto libre dentro de cada producto. Eso hacía imposible
mandarle un correo (no había dirección) y permitía que un tipeo partiera un
proveedor en dos (`Mundo novo` vs `Mundo Novo`).

- Tabla `providers`: nombre, correo, contacto, teléfono, notas, `is_member`, `active`.
- Los 13 proveedores migrados; los 82 productos vinculados por `products.provider_id`.
- `products.provider` (texto) **se conserva y se mantiene sincronizado**: el catálogo
  de las familias busca por ese texto y los pedidos ya sellados lo tienen congelado
  dentro de `sealed_orders.items`. Renombrar un proveedor propaga el cambio.
- Pestaña **Proveedores** en el panel admin. No se puede borrar un proveedor con
  productos asociados; se desactiva.
- El maestro de productos elige proveedor con un buscador (no un `<select>`, porque
  la lista va a crecer).
- `families.email2`: segundo correo de notificación. **No son credenciales** — el
  acceso sigue siendo nombre + PIN.

Migración: `db/migrations/001_providers_y_correos.sql`

### Etapa 2 — Consolidado y órdenes de compra ✅

- Pestaña **Consolidado**: agrupa todos los pedidos sellados por proveedor y
  producto. Muestra cuánto comprarle a cada uno, con el desglose de qué familia
  pidió qué.
- Botón **Enviar orden de compra** → función serverless → Brevo → correo al
  proveedor con enlace de confirmación.
- El proveedor confirma producto por producto: completo / parcial / no tengo, más
  una nota libre. La respuesta se ve en el panel.

Migración: `db/migrations/002_ordenes_de_compra.sql`

---

## 2. Decisiones de arquitectura (y por qué)

**Los proveedores no tienen cuenta.** Reciben un enlace con token secreto. Esto
evitó tener que migrar a Supabase Auth + RLS: como no entran actores externos a la
aplicación, todos los usuarios siguen siendo socios de confianza.

**La página de confirmación es HTML plano servido por `api/confirmar.js`, no parte
del bundle de React.** Deliberado: el bundle contiene la clave pública de Supabase.
Si el proveedor cargara la app, podría extraerla y llegar a los datos de las
familias. Así lo único que su enlace le concede es su propia orden.

**La clave de Brevo vive solo en el servidor.** Variable `BREVO_API_KEY` en Vercel,
**sin** prefijo `REACT_APP_` — ese prefijo la incrustaría en el JavaScript público.

**Las líneas de una orden son una foto en JSONB**, igual que `sealed_orders.items`.
Si después cambia un precio o una familia modifica su pedido, la orden que el
proveedor recibió por correo debe seguir diciendo lo mismo.

**Los totales se recalculan en el servidor.** `api/enviar-orden.js` nunca confía en
los montos que manda el navegador.

**Modo prueba (`CORREO_PRUEBAS`).** Mientras la variable exista, toda orden se
desvía a esa dirección y llega marcada como prueba. El panel muestra el estado
*antes* de enviar, para que nadie dispare un correo real creyendo que ensaya.

**Los roles son múltiples por familia**, no por persona: `role` pasa de valor único
a lista. Perfiles acordados: **Admin**, **Proveedores**, **Recepción-Retiro**,
**Balance Contable**, **Familia**.

---

## 3. La decisión pendiente que bloquea la Etapa 3

Aparecieron **dos conceptos distintos** que el plan original confundía en uno:

| | Cuándo | Qué corresponde |
|---|---|---|
| **No confirmado** | El proveedor avisa antes de la entrega que no tiene el producto | **Bajar el pedido**: la familia no debería pagarlo nunca |
| **Faltante en retiro** | Estaba en la lista, se pagó, no llegó a la caja (o llegó en mal estado) | **Saldo a favor** para el próximo período |
| **Extra** | La familia agrega algo en el retiro, sin pagar | **Saldo en contra** para el próximo período |

Cuál de los dos primeros aplica depende de **cuándo pagan las familias**:

- El flujo actual de la cooperativa (paso 05 del PDF) tiene el pago **antes** de que
  salga la orden de compra. Con eso, todo es saldo a favor.
- La intención declarada al pedir el correo de OC era **confirmar antes de que la
  gente pague**. Con eso, la mayoría de los faltantes desaparece porque el pedido
  sale ya corregido.

**Sin resolver esto, la Etapa 3 no se puede diseñar.** Es la primera pregunta de la
próxima sesión.

---

## 4. Etapas siguientes

### Etapa 3 — Faltantes y extras (bloqueada por lo anterior)

Tabla única de ajustes contra un pedido sellado, con campo de tipo. Alimenta los
saldos con trazabilidad: hoy los saldos se editan a mano y **no queda registro de
por qué cambió un saldo** — que es exactamente lo que el perfil Balance Contable
necesita para cruzar con los comprobantes de transferencia.

Del flujo de la cooperativa (paso 07 y 08):
- **Las familias registran sus propios faltantes y extras**; la Comisión
  Recepción-Retiro supervisa y corrige. Son dos permisos sobre la misma tabla.
- Los extras tienen **estado de pago**, no son solo "impagos".
- Hay una **ventana de gracia** post-retiro ("margen para ajustes finales desde el
  hogar") con fecha límite, después de la cual se congela. Requiere un campo de
  fecha nuevo en `periods`.
- Lo que el proveedor marcó como no disponible debería **precargarse** como
  faltante, para no tipearlo dos veces.

### Etapa 4 — Perfiles múltiples

`role` pasa de texto a lista. Cinco perfiles combinables, rotativos por período.

### Etapa 5 — Reportes Excel

Consolidado por familia, por proveedor, de faltantes, de extras, stock de bodega,
cantidad de familias. **Deben seguir disponibles para períodos cerrados**: se leen
de las tablas vivas filtrando por `period_id`, no del resumen JSON que se guarda al
cerrar (que es un extracto parcial).

### Etapa 6 — Carga masiva de precios + normalización de unidades

Importar planillas por proveedor o un consolidado.

Sobre las unidades: `unit` es el **formato de venta**, no una unidad de medida.
"500 gr" significa bolsa de medio kilo y `price` es el precio de esa bolsa. Hay **24
variantes de texto libre** para lo que son 5 unidades canónicas.

**Corrección importante:** este desorden **no rompe** el consolidado por proveedor
—agrupa por producto, y cada producto arrastra su propio formato— pero sí afecta la
legibilidad de la orden que sale hacia afuera, impide calcular peso total por
proveedor, y rompe el emparejamiento automático al importar precios.

Propuesta: separar en `format_qty` (número) + `format_unit` (canónica: `gr`, `kg`,
`ml`, `lt`, `un`). `500 cc` → `500 ml`. `Kg`/`1 Kg`/`Kilo` → `1 kg`.

### Etapa 7 — Mermas, regalos y sobrantes en bodega (nuevo, 6-sep-2026)

Marcar producto que **no se vendió**: mal estado, vencimiento, o regalado.

No basta con descontarlo del stock: una merma **es pérdida de dinero de la
cooperativa** y debe aparecer en el flujo de caja. Un regalo es una decisión
deliberada, no un descuido, y conviene distinguirlos en los reportes.

Engancha con el paso 08 del flujo: *"identificación y reporte de sobrantes a la
Comisión de Proveedores"*.

Nota: `supabaseClient.js` ya tiene funciones para tablas `inventory` y `movements`
que **nadie llama** — código muerto de un intento anterior. Revisar si se
reaprovechan antes de crear tablas nuevas.

---

## 5. Sustitución de productos — decidido: no construir por ahora

El proveedor podría querer ofrecer otro producto en vez del que no tiene.

**El problema no es el lado del proveedor, es quién acepta el cambio en nombre de
las familias.** Si El Granero ofrece arroz integral en vez de blanco a otro precio,
alguien decide por las 15 familias que lo pidieron. Eso es una negociación, no un
formulario.

**Decisión:** al marcar "No tengo", se le ofrece un campo de texto opcional *"¿puedes
ofrecer algo en su lugar?"*. La comisión lo lee y resuelve por WhatsApp, como hoy. El
sistema **registra** la excepción sin pretender resolverla.

Si con el uso resulta frecuente, la versión acotada sería mostrarle **solo los
productos de su propio catálogo** como alternativa (el sistema ya sabe cuáles son
por `provider_id`), con aprobación de la comisión. Nunca el maestro completo: eso
rompería la garantía de que un proveedor no ve datos de otros.

---

## 6. Pendientes operativos (no de código)

- [ ] **12 correos de proveedores.** Solo El Granero tiene uno, y es la dirección de
      pruebas `cristopher.caroca.g@gmail.com`. Sin correo, el botón de enviar orden
      queda deshabilitado.
- [ ] **¿"Balance Contable" es quinta comisión o parte de Administrativa?** Se decidió
      que es un rol nuevo: hoy la cooperativa no lleva flujo de caja en su planilla.
- [ ] **¿La Comisión Recepción es gente distinta de la de Retiro?** Por ahora fundidas
      en un solo perfil "Recepción-Retiro".
- [ ] **Dominio propio para el correo.** Brevo advierte (DKIM/DMARC) porque se envía
      desde `@gmail.com`: Brevo no puede firmar en nombre de un dominio que no es
      suyo. Funciona para pruebas, pero hacia proveedores con casillas corporativas
      una parte va a caer en spam. La solución cuesta ~$10.000–15.000 CLP/año, así que
      **es decisión de la cooperativa**, no técnica.
- [ ] **Apagar el modo prueba** (borrar `CORREO_PRUEBAS` en Vercel) cuando se quiera
      enviar de verdad.

---

## 7. Restricción permanente

**Ninguna mejora puede aumentar los costos.** Todo cabe en planes gratuitos: Vercel
Hobby, Supabase free, Brevo free (300 correos/día, ~9.000 al mes).

Dos riesgos conocidos y aceptados:
- Vercel Hobby prohíbe uso comercial en sus términos; una cooperativa es caso gris.
  La salida sería migrar de hosting, no pagar.
- Los proyectos Supabase gratuitos **se pausan tras 7 días sin actividad**. Con uso
  mensual por ciclos, puede pasar entre períodos. Se reactiva con un clic.

---

## 8. Deuda técnica conocida

- **Sin autenticación real.** El PIN se guarda en texto plano, la tabla de familias
  completa se descarga al navegador, y los permisos son un `if` en React. Tolerable
  porque todos los usuarios son socios de confianza; dejaría de serlo si algún día
  entran externos.
- **Saldos con read-modify-write desde el cliente.** Se calculan como
  `(fam.balance || 0) ± monto` y se sobrescriben. Dos admins simultáneos pierden un
  ajuste. `handleClosePeriod` cobra en un loop sin idempotencia: si falla a la mitad,
  quedan familias cobradas y otras no.
- **Pedidos sellados duplicados, y el consolidado los oculta.** Verificado el
  6-sep-2026: la familia `ale` tiene **3** `sealed_orders` en `P109` — dos idénticas
  de \$9.360 selladas con un minuto de diferencia (03:27 y 03:28) y una de \$16.360
  esa misma tarde. Nada en la base impide sellar dos veces el mismo período.

  Lo relevante: `App.js` construye `sealed` como un mapa `family_id → orden`
  (`orders.forEach(o => { map[o.family_id] = o })`), así que **de las tres solo
  sobrevive la última que devuelva Supabase, y cuál es depende del orden de la
  consulta**. El consolidado y las órdenes de compra heredan ese sesgo: podrían
  estar comprando según un pedido antiguo sin avisar a nadie.

  P109 está cerrado, así que no afecta al período activo, pero el camino que lo
  produjo sigue abierto. Falta una restricción de unicidad en
  `(period_id, family_id)` y decidir qué hacer con las tres filas históricas.
- Aviso de ESLint preexistente en `App.js:300` (`cart` en las dependencias de un
  `useMemo`). Por eso el build usa `CI=false`.
