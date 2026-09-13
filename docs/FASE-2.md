# Fase 2 — Estado, decisiones y pendientes

Cooperativa de Consumo Responsable **Quilpueblo**.
Última actualización: 12 de septiembre de 2026 (QA y revisión de seguridad).

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
a lista. Seis perfiles acordados: **Admin**, **Proveedores**, **Recepción**, **Retiro**,
**Balance Contable**, **Familia**.

Recepción y Retiro son perfiles **separados** (decidido 12-sep-2026): son dos
acciones en días distintos —recibir del proveedor, y entregar a las familias— y
aunque a veces las haga la misma gente, por naturaleza espacio-temporal pueden
cambiar las personas.

---

## 3. Momento del pago — decidido

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

### RESUELTO (6-sep-2026): el pago va DESPUÉS de la confirmación

El nuevo orden del ciclo es:

1. Las familias sellan sus pedidos.
2. Cierra el período de pedidos.
3. Sale la orden de compra a cada proveedor.
4. Los proveedores confirman disponibilidad.
5. **El sistema baja del pedido lo no disponible.**
6. Recién entonces se le cobra a la familia, con el monto ya corregido.
7. Entrega y retiro. Ahí siguen apareciendo faltantes y extras reales → saldo.

Esto cambia el paso 05 del flujo documentado de la cooperativa (que junta pedido y
pago) y **hay que avisarlo en las capacitaciones**: las socias están acostumbradas a
transferir al momento de pedir.

Consecuencias de diseño:

- El pedido sellado deja de ser el monto final. Necesita un estado intermedio entre
  "sellado" y "cobrado", y un monto ajustado además del original.
- Hace falta una **fecha de cierre de confirmaciones**: si un proveedor no responde,
  el cobro no puede quedar esperando indefinidamente. Decidir qué se asume por
  defecto al vencer el plazo (¿que sí trae todo, o que no trae nada?).
- Las familias deben poder **ver por qué su monto cambió** antes de pagar, o van a
  desconfiar del número.
- Los faltantes por confirmación (antes de pagar) y los del retiro (ya pagados)
  conviven: son dos tipos distintos de ajuste sobre el mismo pedido.

---

## 4. Etapas siguientes

### Etapa 3 — Faltantes, extras y cobro post-confirmación

Tabla única de ajustes contra un pedido sellado, con campo de tipo. Alimenta los
saldos con trazabilidad: hoy los saldos se editan a mano y **no queda registro de
por qué cambió un saldo** — que es exactamente lo que el perfil Balance Contable
necesita para cruzar con los comprobantes de transferencia.

Del flujo de la cooperativa (paso 07 y 08):
- **Las familias registran sus propios faltantes y extras**; la Comisión
  Retiro supervisa y corrige. Son dos permisos sobre la misma tabla.
- Los extras tienen **estado de pago**, no son solo "impagos".
- Hay una **ventana de gracia** post-retiro ("margen para ajustes finales desde el
  hogar") con fecha límite, después de la cual se congela. Requiere un campo de
  fecha nuevo en `periods`.
- Lo que el proveedor marcó como no disponible debería **precargarse** como
  faltante, para no tipearlo dos veces.

### Etapa 4 — Perfiles múltiples

`role` pasa de texto a lista. Seis perfiles combinables, rotativos por período:
Admin, Proveedores, Recepción, Retiro, Balance Contable, Familia.

### Etapa 4b — La ventana de pedidos y la confirmación asistida ✅ (13-sep-2026)

Cuatro correcciones que salieron de probar el flujo completo.

**1. La orden de compra no sale con los pedidos abiertos.**
Antes era una advertencia que se saltaba con un clic. Ahora el botón está
deshabilitado hasta que la ventana de pedidos se cierre.

Se cierra de dos maneras, y son distintas a propósito:

| | Qué es | Cuándo |
|---|---|---|
| `date_to` | La fecha anunciada a las familias | Se cierra sola al pasar |
| `orders_closed_at` | Cierre explícito de la comisión | Cuando alguien aprieta el botón |
| `closed_at` | Cierre contable del período | Al final de todo, tras cobrar |

Se separó `orders_closed_at` de `date_to` porque adelantar el cierre cambiando
`date_to` borraría la fecha que se le comunicó a las familias — y esa fecha es
un compromiso, no un parámetro. `estadoPedidos()` en `calculos.js` es la única
fuente de verdad: la usan el panel y la vista de familia, así que no pueden
discrepar sobre si se puede pedir o no.

**2. La comisión puede registrar la confirmación por el proveedor.**
Muchos proveedores no van a usar el enlace. Desde el consolidado se anota lo que
dijeron por teléfono, con la misma estructura (completo / parcial / no tiene).

Queda firmado: `confirmed_source` distingue `proveedor` de `comision`, y
`confirmed_by_name` guarda quién lo anotó. **No es cosmético**: el indicador de
cumplimiento cuenta aparte a quien responde solo y a quien hubo que ir a buscar.
Una respuesta de segunda mano vale para operar, pero no dice lo mismo del
proveedor.

La palabra del proveedor no se puede pisar: si él contestó por el enlace, el
botón de registrar desaparece. Solo se puede corregir lo que anotó la comisión.

**3. La familia ve qué dijo el proveedor de cada producto.**
Antes el pedido mostraba "Total a pagar" aunque el proveedor ya hubiera avisado
que no traía la mitad. Ahora cada línea lleva su estado —confirmado, parcial, no
lo trae, esperando, o *se asume que llega* cuando venció el plazo sin respuesta—
y el total advierte cuánto va a bajar cuando la comisión aplique los descuentos.

Se mostró el total real y no el estimado a propósito: el estimado sería inventar
una cifra que todavía nadie registró. Lo honesto es mostrar lo que hoy se cobra y
decir por qué va a cambiar.

**4. Las fechas del período se ven antes de poder editarlas.**
Cinco campos de fecha siempre abiertos invitan a cambiarlos sin querer. Ahora se
muestran en modo lectura, con los días que faltan y para qué sirve cada una, y
hay que apretar **Modificar fechas** para editarlas. Al editar aparece el
recordatorio de que las familias ya las están viendo.

La pestaña Fechas de la familia muestra las cinco (antes solo tres: le faltaban
el límite de confirmación de proveedores y el de ajustes, que son justamente los
que la afectan).

Migración: `006_cierre_pedidos_y_confirmacion_asistida.sql`.
Todo degrada si no se corrió: los pedidos se cierran solos por fecha y las
confirmaciones se guardan sin firma.

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

- [ ] **Correos reales de proveedores: no habrá hasta el Go Live.** Los 13 tienen
      cargado `cristopher.caroca.g@gmail.com` como provisional, para poder probar el
      envío de todos. El panel de Proveedores avisa cuando varios comparten correo,
      justamente para que esto no se pase por alto el día del Go Live.
- [ ] **¿"Balance Contable" es quinta comisión o parte de Administrativa?** Se decidió
      que es un rol nuevo: hoy la cooperativa no lleva flujo de caja en su planilla.
- [x] **Recepción y Retiro son perfiles separados.** Resuelto el 12-sep-2026.
- [ ] **Dominio propio para el correo.** Brevo advierte (DKIM/DMARC) porque se envía
      desde `@gmail.com`: Brevo no puede firmar en nombre de un dominio que no es
      suyo. Funciona para pruebas, pero hacia proveedores con casillas corporativas
      una parte va a caer en spam. La solución cuesta ~$10.000–15.000 CLP/año, así que
      **es decisión de la cooperativa**, no técnica.
- [ ] **PIN 7777 es provisional.** Los dos administradores (Fabián González y
      Ruby Parraguez) comparten el PIN `7777`, puesto para poder probar. El panel
      NO lo aceptaría como PIN nuevo —rechaza dígitos repetidos— porque se escribió
      el hash directo a la base. **Cambiarlo antes del Go Live.**
- [ ] **Ejecutar `db/migrations/003_pin_cifrado.sql`.** Mientras no corra, la
      exigencia de PIN está desactivada y cualquiera entra como administrador.
      /api/login lo detecta solo y se degrada en vez de dejar a todos fuera.
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
- **A las familias administradoras no se les cobra al cerrar el período.**
  Detectado el 13-sep-2026. `AdminPeriodo` arma su lista con
  `families.filter(f => f.role === 'familia')`, y las tres administradoras
  (Fabián, Patricia, Ruby) son socias que también piden. El resumen del cierre
  suma sus pedidos al total recaudado, pero el loop que descuenta saldos las
  omite: **piden, se les compra, y no se les descuenta**.

  Arreglarlo es de una línea ahora que existe `perfiles.js` —
  `rolesDe(f).includes('familia')`, que la migración 005 dejó verdadero para
  todas. No se tocó junto con la etapa 4b porque cambia a quién se le cobra
  plata, y eso lo decide la cooperativa, no el código. Mismo patrón en
  `App.js:1008`, `AdminComponents.js:333` y `AdminComponents.js:1869`.
- El build ya compila limpio con `CI=true` (los dos avisos de `useMemo` en
  `App.js` se corrigieron envolviendo `cart` y `ordItems`). `vercel.json` sigue
  usando `CI=false` para que un aviso nuevo no bote un despliegue en medio de
  las pruebas; conviene endurecerlo antes del Go Live.

---

## 9. QA y revisión de seguridad (12-sep-2026)

Revisión completa de las 4.919 líneas, verificando cada hallazgo contra la base
real y no solo leyendo el código.

### Corregido en esta revisión ✅

- **`unsealOrderLocal` no borraba la fila.** "Modificar" la sacaba del estado de
  React y al re-sellar se insertaba otra con id nuevo, dejando huérfana la
  anterior. Origen de los 3 pedidos de `ale` en `P109`. `unsealOrder()` existía
  desde siempre en `supabaseClient.js` y nadie la llamaba. Como `sealed` es un
  mapa por `family_id`, de varias filas sobrevivía solo la última que devolviera
  Supabase — y sin `ORDER BY`, cuál era resultaba arbitrario. El consolidado y el
  cierre de período leen de ahí: se pudo haber comprado según un pedido viejo o
  cobrado mal. Añadido `ORDER BY sealed_at` como segunda defensa.
- **`/api/enviar-orden` aceptaba el contenido de la orden desde el navegador.**
  Cualquiera podía hacer que la cooperativa le mandara a un proveedor real un
  pedido con productos y precios inventados. Ahora recibe solo `periodId` y
  `providerId` y reconstruye el consolidado desde la base. Los precios salen del
  maestro, nunca de la copia congelada dentro del pedido.
- **`/api/estado` publicaba el correo de pruebas.** Ahora lo enmascara.

### Abierto — 🔴 crítico

1. **El panel admin está abierto a internet.** Ninguna de las 17 familias tiene
   PIN. Quien abra la URL entra como administrador y puede editar saldos, cerrar
   períodos y cambiar roles. No requiere conocimiento técnico.
2. **La base es legible y escribible sin autenticación.** La clave pública va en
   el bundle y RLS está apagado. Verificado desde fuera de la app: se descargan
   las 17 familias con correos y saldos con un solo comando; escribir también
   funciona.

Ambas tienen la misma raíz: no hay autenticación real. El argumento de "todos son
socios de confianza" aplica a *quién usa* el sistema, no a *quién puede llegar*
a él, y el sitio está publicado.

**Costo de arreglarlo: $0.** Supabase Auth es gratis hasta 50.000 usuarios activos
(hay 17), RLS es una función de PostgreSQL ya presente, y los correos de
autenticación pueden salir por el Brevo ya configurado. Lo que cuesta es tiempo y
decidir si se conserva el acceso por nombre + PIN (más trabajo: PIN cifrado,
verificado en servidor, credencial firmada) o se migra a correo + contraseña
(más directo, pero cambia lo que se va a enseñar en las capacitaciones).

### Abierto — 🟠 alto

3. **El cierre de período cobra antes de cerrar y sin vuelta atrás**
   (`AdminComponents.js`, `handleClosePeriod`). Si el cierre falla, las familias
   ya quedaron cobradas y el período sigue abierto: **reintentar cobra dos
   veces**. El bucle tampoco maneja errores por familia, así que puede dejar a
   unas cobradas y a otras no, en silencio. Arreglo propuesto: columna
   `charged_at` en `sealed_orders` para que el cobro sea idempotente y el
   reintento salte lo ya cobrado.

### Abierto — 🟡 medio

4. **Saldos con lectura-modificación-escritura en 8 lugares.** Todos calculan
   `(saldo || 0) ± monto` en el navegador y sobrescriben. Dos personas operando a
   la vez pierden un ajuste sin aviso.
5. **Las reservas de bodega pueden sobrevender.** El stock disponible se calcula
   desde el estado local; dos familias reservando a la vez ven ambas stock.
6. **El resumen del cierre no cuadra con lo cobrado.** `totalValue` incluye el
   pedido propio del admin; el bucle de cobro solo recorre familias.
