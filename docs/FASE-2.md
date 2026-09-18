# Fase 2 — Estado, decisiones y pendientes

Cooperativa de Consumo Responsable **Quilpueblo**.
Última actualización: 18 de septiembre de 2026 (etapas 4c a 7 y autenticación real).

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

### Etapa 4c — Lo que salió de probar el flujo con cargos reales ✅ (18-sep-2026)

Seis hallazgos de una sesión de prueba. Tres eran bugs, tres eran funcionalidad
que faltaba.

**1. Se podía marcar un retiro con descuentos del proveedor sin aplicar.**
El proveedor ya había avisado que no traía un producto y Retiros dejaba marcar
la entrega igual: el descuento vivía solo en la pestaña Faltantes y Extras, y si
nadie pasaba por ahí primero se le cobraba a la familia algo que nunca llegó.

`pendientesDeConfirmacion()` y `puedeMarcarRetiro()` pasaron a `calculos.js`
—antes el cálculo estaba dentro del componente de Faltantes y la otra pantalla no
podía verlo— y Retiros ahora bloquea el botón, muestra qué falta descontar y
ofrece descontarlo desde la misma fila.

Se bloquea **solo** el caso inequívoco (*"no lo trae"*: nadie lo recibe, un clic
lo resuelve). Una entrega **parcial** advierte pero no bloquea: repartir quién se
queda sin su parte es una decisión de la cooperativa, y esa conversación no puede
ocurrir con la fila de familias esperando en la puerta.

**2. Un retiro marcado por error no se podía deshacer.** No es cosmético: el
retiro le abre a la familia la ventana para reclamar faltantes
(`ventanaAjustes`), así que marcarlo en la familia equivocada le da por entregada
una caja que sigue en bodega. `unmarkRetired()` con confirmación, y queda escrito
en Actividad quién lo deshizo.

**3. Asignar un perfil no llegaba al usuario.** El panel escribía `roles` en la
base correctamente; el problema estaba en `api/login.js`: `familiaPublica()` no
devolvía `roles`, y como se entra con lo que responde el servidor y no con la
fila que el navegador ya tenía, `rolesDe()` caía al respaldo de `role` —que solo
distingue `admin` de `familia` y no sabe nada de las otras cuatro comisiones—.
Una familia marcada como Retiro o Balance Contable entraba a la vista de familia.

De paso apareció un agujero: la exigencia de PIN se medía con
`role === 'admin'`, y una socia con Balance Contable tiene `role === 'familia'`.
Podía ver saldos y flujo de caja de toda la cooperativa **sin credencial**. Ahora
se mide por lo que la cuenta puede VER (`entraAlPanel`), no por la etiqueta que
le quedó de cuando los roles eran uno solo.

Consecuencia operativa: **asignar un perfil del panel a una familia sin PIN la
deja fuera hasta que se le configure uno.** El panel avisa antes de asignarlo.

**4. Buscador de productos con coincidencias de texto.** Elegir entre 82
productos en un `<select>` obliga a recorrer la lista entera, y el maestro va a
crecer. `src/Buscador.js` busca sin acentos y por palabras en cualquier orden
("integral arroz" encuentra "Arroz integral"), resalta la coincidencia, y se
maneja con flechas y Enter.

El patrón ya existía **dos veces** copiado (proveedor en Productos, producto en
Bodega) con diferencias entre las copias. Está una sola vez y se usa en los tres
lugares. Para un faltante muestra *cuánto pidió esta familia* en vez del precio:
es el techo de lo que se le puede marcar.

**5. El flujo de caja no mostraba lo que el período implica.** Solo listaba los
movimientos que alguien tipeó a mano: se marcaba un retiro con cargos incluidos y
el flujo seguía en cero.

`ResumenDelPeriodo` muestra **separadas** dos cifras que no hay que mezclar: lo
que el período debería recaudar según los pedidos, y lo que está registrado como
ingreso. La diferencia es lo que queda por cobrar. Juntarlas en un número sería
exactamente lo que impide cuadrar contra los comprobantes de transferencia.

No inventa movimientos ni crea columnas: todo se deriva de tablas que ya existen.
Cada fila dice de dónde sale, porque una cifra sin procedencia no se puede
defender en una asamblea. El saldo anterior va aparte a propósito: baja lo que
hay que cobrar este mes, pero no es plata que entró este mes.

**6. Cargos fijos múltiples, con exenciones por familia.**

El cargo era un número: $4.000 igual para todas, sin nombre. Ahora son varios con
nombre propio y motivo, y una familia puede estar eximida de alguno.

Eximir es mover plata de la cooperativa, así que **el motivo es obligatorio** y
queda firmado con quién lo concedió — el mismo criterio que la migración 004 fijó
para los ajustes. Solo Administración y Balance Contable pueden conceder o quitar
exenciones; los demás perfiles las ven.

Decisión de diseño: **los cargos son por período**, no una lista permanente. Un
período cerrado tiene que seguir diciendo lo que decía; si fueran globales con un
monto vigente, subir la cuota en noviembre reescribiría lo que se cobró en
septiembre y el cierre de septiembre dejaría de cuadrar con sus comprobantes.
Misma lógica que `sealed_orders.items`. El costo es tipearlos cada mes, y se paga
copiándolos del período anterior al crear uno nuevo. **Las exenciones no se
copian**: arrastrarlas en silencio significaría que una familia deja de pagar
durante meses sin que nadie lo vuelva a decidir.

Consecuencia en el código: `cargo` (escalar, que viajaba a veinte lugares) pasó a
ser el objeto `cargos`, con `de(familyId)` y `desgloseDe(familyId)`. Pasar el
número obligaría a cada pantalla a decidir por su cuenta si aplicar una exención,
y dos pantallas mostrarían cuentas distintas de la misma familia.

`periods.fixed_charge` **no se elimina**: un trigger lo mantiene sincronizado con
la suma de los cargos, igual que `families.role` quedó sincronizado con `roles` en
la 005. Si el trigger y las filas se descalzan, el panel lo dice en voz alta en
vez de cobrar cero en silencio.

Migración: `007_cargos_multiples_y_exenciones.sql`. Si no se ejecuta, se sigue
cobrando el cargo único que ya estaba y el panel explica qué falta.

**Lo que esto dejó a la vista, y que ya se resolvió:** `ResumenDelPeriodo` cuenta
a las familias administradoras (usa `rolesDe(f).includes('familia')`, que es lo
correcto: también piden), mientras el bucle de cobro de `handleClosePeriod` usaba
`f.role === 'familia'` y las omitía. La discrepancia estaba escondida y acá pasó
a verse como una diferencia entre lo que debería recaudar y lo que se cobra.

**La cooperativa lo decidió el 18-sep-2026: todas iguales, compran y pagan en
tiempo y forma.** Las dos cifras ahora salen de la misma lista. Ver §8.

### Etapa 5 — Reportes Excel ✅ (18-sep-2026)

Cinco planillas, de cualquier período, activo o cerrado: consolidado por familia
(con el detalle línea por línea), por proveedor, faltantes y extras, stock de
bodega y padrón de familias. Más un botón que las descarga todas en un archivo,
que es lo que se manda por correo a fin de ciclo.

Se leen las tablas vivas filtrando `period_id`, **no** `periods.summary`: ese
resumen tiene los totales por familia pero no las líneas, ni los faltantes, ni la
bodega. Así un período cerrado da el mismo detalle que el activo.

Cada archivo abre con una hoja de **portada** que dice de qué período es, qué
cargos tenía, qué exenciones había y cuándo se generó. Sin eso, dos reportes en
la misma carpeta son indistinguibles.

**Límite que no se puede resolver leyendo mejor.** En un período cerrado, las
columnas de saldo muestran el saldo de *hoy*: `families.balance` es un solo
número que se va actualizando, no una serie. La cifra que manda ahí es
**Cobrado al cerrar** (`sealed_orders.charged_amount`), que quedó escrita en el
pedido ese día. El reporte lo advierte en la portada y el panel también.

**Sin dependencias nuevas.** `xlsx` pesa ~400 KB y la app entera son ~187:
sumar una librería más grande que el producto, para escribir planillas de
diecisiete filas, se paga con el tiempo de carga de cada socia en un celular.
`src/excel.js` arma el ZIP a mano con método 0 (sin comprimir), que evita tener
que implementar deflate; con los volúmenes reales eso son decenas de KB.

Verificado abriendo el archivo generado en Excel 16: hojas, nombres saneados y
deduplicados, encabezados en negrita, montos con formato chileno, autofiltro,
acentos y escapes XML. La primera versión del directorio central del ZIP estaba
**2 bytes corta** —se habían fundido «atributos internos» con «atributos
externos»— y ningún lector la aceptaba, con un mensaje de error que no decía
nada del problema real. Los 46 bytes van comentados uno por uno.

### Etapa 6 — Carga masiva de precios + normalización de unidades ✅ (18-sep-2026)

Sobre las unidades: `unit` es el **formato de venta**, no una unidad de medida.
"500 gr" significa bolsa de medio kilo y `price` es el precio de esa bolsa. Hay
**24 variantes de texto libre** para lo que son 5 unidades canónicas.

**Corrección que se mantiene:** este desorden **no rompe** el consolidado por
proveedor —agrupa por producto, y cada producto arrastra su propio formato— pero
sí afecta la legibilidad de la orden que sale hacia afuera, impide calcular peso
total por proveedor, y rompe el emparejamiento al importar precios.

**Lo construido: se AGREGAN `format_qty` + `format_unit`, y `unit` no se toca.**

Cambió respecto de la propuesta original, que hablaba de "separar". No se
reescribe `unit` por dos razones que pesan:

1. "24 rollos" canonizado es "24 un", y eso pierde información real: quien
   recibe la caja necesita saber que son rollos. Lo mismo "Caja 3 un". La
   etiqueta que lee una persona y la que usa una cuenta no son la misma cosa.
2. `sealed_orders.items` tiene el formato congelado adentro. Reescribir `unit`
   haría que un pedido viejo y el maestro dijeran cosas distintas del mismo
   producto — justo lo que la foto en JSONB existe para evitar.

De los 24 formatos reales, **21 se interpretan sin ambigüedad**. Los otros 3
son `Kg`, `Kilo` y `un`, que no traen número: se asume 1 y se marcan como
revisables. Un formato compuesto como "3 bandejas de 500 gr" se marca de
confianza **baja** a propósito: la primera versión del parser devolvía "3 un"
con toda la seguridad del mundo, tirando el peso en silencio. Una respuesta
confiada y equivocada es peor que no responder, porque nadie la va a ir a
revisar. La normalización se aprueba desde el panel, nunca en la migración.

**Dónde se cobra el beneficio** (si no, la etapa estaría a medio entregar):
- La orden al proveedor ahora dice `1 kg` para los tres casos, y conserva el
  paréntesis solo cuando aporta: `24 un (24 rollos)`. Una etiqueta que solo
  repite la unidad de medida no se muestra dos veces.
- El consolidado muestra **peso y volumen por proveedor**, y dice cuántas líneas
  quedaron fuera: un peso que calla lo que no pudo sumar es un peso en el que no
  se puede confiar.

**La importación de precios: se pega, no se sube un .xlsx.** Leer un .xlsx exige
descomprimir (inflate), que es mucho más código que escribirlo. En cambio, al
copiar celdas de Excel el portapapeles ya lleva el contenido separado por
tabuladores: seleccionar y pegar es un paso contra «guardar como, elegir formato,
buscar el archivo». También acepta CSV.

Nada se aplica solo. Cada fila sale clasificada —cambia, igual, empate,
no está en el maestro, no se pudo leer— y los empates se resuelven en la misma
pantalla con el buscador. Filtrar por proveedor baja mucho la ambigüedad:
"Arroz" empareja con cuatro productos en el maestro completo y con uno en el
catálogo de un proveedor. **Nunca se elige entre candidatos por puntaje:**
adivinar es decidir a cuál producto se le cambia el precio, y esa apuesta la
tiene que hacer una persona.

Tres defensas que valen más que la comodidad:
- **Precios en formato chileno.** `$1.234` son mil doscientos treinta y cuatro,
  no uno con veintitrés. Es el error más caro posible: leer un precio mil veces
  más chico y cobrarlo.
- **Cambios sospechosos.** Un cambio de más de 3× se destaca aparte. Casi siempre
  es una columna mal leída: la cooperativa sabe si el aceite subió 40%, y nadie
  sabe si subió 4.000%.
- **`price_history` y deshacer la importación completa.** Sin vuelta atrás nadie
  se atreve a cambiar ochenta precios de una vez. La reversión salta los
  productos que alguien cambió a mano después: ese cambio es más nuevo y pisarlo
  sería descartar una decisión posterior sin avisar.

Migración: `008_formato_de_venta.sql`. Agrega las dos columnas con restricción a
las cinco canónicas, y `price_history`. No interpreta el texto: un parser en SQL
sería un parser peor, porque no puede pedir confirmación.

### Etapa 7 — Mermas, regalos y sobrantes en bodega ✅ (18-sep-2026)

Del paso 08 del flujo: «identificación y reporte de sobrantes a la Comisión de
Proveedores».

**Por qué no basta con bajar el stock.** Restarle 3 kilos al ítem de bodega deja
el inventario correcto y la contabilidad ciega. Una merma **es plata que la
cooperativa perdió**: compró el producto, lo pagó al proveedor y no lo vendió.
Si solo se descuenta el stock, el flujo de caja del período cuadra sin haber
registrado nunca esa pérdida, y Balance Contable no tiene de dónde explicar el
descalce. Por eso cada baja con motivo que cuesta plata **genera un egreso en
`cash_flow`**, y borrar la baja borra ese egreso.

**Cinco motivos, y la distinción no es decorativa:**

| Motivo | Qué es | ¿Cuesta plata? |
|---|---|---|
| `merma` | Se echó a perder, se rompió, se venció | Sí — pérdida involuntaria |
| `regalo` | Se donó o se regaló | Sí — pérdida **deliberada** |
| `consumo` | Se usó en una actividad de la cooperativa | Sí — gasto con propósito |
| `devolucion` | Se le devolvió al proveedor | **No**: la plata vuelve o nunca se pagó |
| `ajuste` | La cuenta física no cuadraba | **No**: es corrección de registro |

Mezclar merma con regalo hace que la cooperativa parezca descuidada cuando en
realidad fue generosa, y al revés: esconde una merma real detrás de una
decisión. Son dos conversaciones distintas en la asamblea.

**El motivo escrito es obligatorio.** Una merma sin explicación es un número que
nadie puede defender, y es justo el número que va a generar preguntas.

**Efecto secundario que era un bug.** `getRemaining` solo restaba las
asignaciones, así que un producto que se echó a perder seguía apareciendo como
disponible para reservar — y alguien lo iba a reservar. Ahora restan las tres
cosas: asignado, dado de baja, y nada más (`disponibleEnBodega`).

**Resuelto: qué hacer con `inventory` y `movements`.** El plan pedía revisar si
se reaprovechaban antes de crear tablas nuevas. Verificado contra el respaldo el
18-sep-2026: **cero filas en ambas y ningún llamador en toda la aplicación**.
Reaprovecharlas parecía ahorro y no lo era: `movements` no tiene `period_id`
—y acá todo se contabiliza por período— ni campo de motivo, ni vínculo con el
ítem de bodega del que se descuenta. Habría que alterarlas hasta dejarlas
irreconocibles conservando el nombre de un diseño que no era para esto. **Las
funciones muertas se eliminaron** y se creó `bodega_bajas`.

Migración: `009_mermas_regalos_sobrantes.sql`. Si no se ejecuta, el resto de
bodega funciona igual y el botón de dar de baja queda deshabilitado con el aviso.

El reporte de bodega trae una hoja **Mermas y sobrantes** cuyo total es la
pérdida *real*: sumar las devoluciones y los ajustes daría una pérdida inflada.

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
- ~~**A las familias administradoras no se les cobra al cerrar el período.**~~
  **RESUELTO el 18-sep-2026 por decisión de la cooperativa: todas iguales,
  compran y pagan en tiempo y forma.**

  Qué pasaba: `AdminPeriodo` armaba su lista con
  `families.filter(f => f.role === 'familia')`, y `role` se sincroniza en
  'admin' para quien administra, así que las administradoras quedaban fuera de
  **todas** las listas del panel —pedidos, retiros, saldos— y del bucle que
  descuenta al cerrar. Pedían, se les compraba, y no se les descontaba. El
  resumen del cierre sí sumaba sus pedidos al total recaudado, de modo que el
  cierre nunca cuadraba con lo cobrado.

  Se cambió a `rolesDe(f).includes('familia')` en los tres lugares:
  `App.js` (la lista `na` que alimenta todo el panel), `AdminComponents.js`
  (`AdminPeriodo`, que es donde la lista se convierte en plata) y la analítica
  —que contaba 14 familias donde hay 17 e inflaba todos los promedios por
  familia—. Administrar es un perfil que **se suma** al de socia, no uno que lo
  reemplaza.

  **No hubo deuda histórica que reconciliar.** Verificado contra la base el
  18-sep-2026: existen 3 pedidos sellados en total, los tres en el período
  activo («Prueba MVP») y ninguno con `charged_at`, porque ese período todavía
  no se ha cerrado. Los períodos anteriores no tienen pedidos. Así que el
  cambio aplica desde el primer cierre y no deja nada pendiente de cobrar hacia
  atrás.
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

### Los dos críticos — RESUELTOS en código, PENDIENTE ejecutar (18-sep-2026)

Los dos hallazgos eran, textualmente:

1. **El panel admin abierto a internet.** Quien abriera la URL entraba como
   administrador y podía editar saldos, cerrar períodos y cambiar roles.
2. **La base legible Y ESCRIBIBLE sin autenticación.** Clave pública en el
   bundle y RLS apagado.

**Verificado de nuevo el 18-sep-2026, desde fuera de la aplicación:** el
hallazgo 2 seguía vivo — `families`, `products`, `periods` y `sealed_orders` se
descargaban con un comando. Del hallazgo 1, el estado había mejorado sin que el
documento lo registrara: la migración 003 ya estaba corrida y 3 de las 17
familias tenían PIN, no cero.

#### Qué se construyó

**Decisión: se conserva nombre + PIN, con sesión firmada.** Cambiar a correo +
contraseña habría obligado a capacitar de nuevo a diecisiete familias. En vez de
eso, `/api/login` verifica el PIN con scrypt y emite un **JWT HS256 firmado con
el secreto del propio proyecto Supabase**. La base lo valida igual que si lo
hubiera emitido Supabase Auth: la garantía criptográfica es la misma, y no hubo
que reescribir las cincuenta funciones de datos del navegador.

Piezas:

- `api/_lib/sesion.js` — emite y verifica el token. Sin librerías: un JWT HS256
  son tres pedazos en base64url y un HMAC-SHA256, y `crypto` de Node lo hace.
  Los perfiles viajan **dentro** del token, firmados, así que el navegador no
  puede mentir sobre sus propios permisos.
- `api/portada.js` — resuelve el huevo-y-gallina: para entrar hay que elegir su
  nombre de una lista, y con RLS encendido nadie sin sesión puede leer
  `families`. Devuelve **solo** nombres, iniciales y si cada uno tiene PIN. Ni
  correos, ni saldos, ni `pin_hash`, ni fechas de último acceso.
- `App.js` carga en **dos fases**: la portada antes de entrar, todo lo demás
  después y con el token puesto. Antes, abrir la URL bastaba para descargarse la
  cooperativa completa.
- El token vive **solo en memoria**: no en localStorage. Varias socias usan el
  computador de la casa o del centro comunitario, y la sesión de una no debe
  seguir abierta para la siguiente persona que se siente. Recargar obliga a
  entrar de nuevo, que es lo que ya pasaba.

**Migración `010_rls_y_sesiones.sql`** enciende RLS en todas las tablas con
políticas por perfil. No se usa `auth.uid()`: hace `(claims->>'sub')::uuid` y
los `families.id` de esta base son TEXT, así que reventaría. Las políticas leen
`auth.jwt() ->> 'family_id'`.

#### Tres huecos que aparecieron al escribir las políticas

Ninguno era visible antes, y los tres se habrían descubierto en producción:

- **`/api/set-pin` no verificaba quién llamaba.** Su propio comentario decía que
  daba igual «mientras RLS siga apagado». Con RLS encendido dejaba de dar igual
  en el peor sentido: usa la clave de servicio, así que sería la única puerta
  abierta, y quien pudiera llamarla **se asignaría el PIN de una administradora
  y entraría como ella**. Ahora exige sesión, y solo Administración toca el PIN
  de otra persona.
- **`/api/enviar-orden` tampoco.** Manda correos reales a los trece proveedores.
  Ahora exige el perfil Proveedores.
- **Una familia podía ponerse el saldo en cero** desde la consola del navegador.
  La política se lo prohíbe. Eso rompía la reserva de bodega, que cargaba el
  saldo desde el cliente, así que ese cargo pasó a un **trigger** — que además
  es atómico y cierra uno de los ocho lugares con lectura-modificación-escritura
  que anota §8.

#### Qué falta ejecutar, en este orden

La migración 010 es la única de toda la fase que puede dejar a la cooperativa
sin poder trabajar. El orden está en el encabezado del archivo y se resume así:

1. Configurar en Vercel, **sin** prefijo `REACT_APP_`: `SUPABASE_JWT_SECRET` y
   `SUPABASE_SERVICE_ROLE_KEY`. Con ese prefijo se incrustarían en el
   JavaScript público, y la clave de servicio ahí haría que RLS no sirviera para
   nada — peor que no encenderlo, porque parecería protegido.
2. Desplegar. **Y probar antes de seguir:** con RLS todavía apagado, si se entra
   y se trabaja normalmente, es que Supabase acepta el token firmado. Si la
   firma no le sirviera, PostgREST responde 401 a todo y la aplicación se cae de
   inmediato — sale una franja roja diciéndolo con nombre. El riesgo real es que
   este proyecto usa el formato de clave nuevo (`sb_publishable_...`) y algunos
   proyectos así firman con claves asimétricas, donde el secreto HS256 ya no
   vale. **Este paso lo revela sin arriesgar nada.**
3. **Asignar PIN a las 10 cuentas con perfil de panel que no lo tienen.** Al
   18-sep-2026 hay 12 con perfil y 2 con PIN (Fabián y Ruby, que sí pueden
   entrar a ponerlos). El panel las lista en rojo en la pestaña Familias.
4. Recién entonces ejecutar `010_rls_y_sesiones.sql`.

Al final del archivo, comentado, está el bloque que **apaga RLS** en todas las
tablas si hay que operar ya. Es una salida de emergencia, no una alternativa.

#### Qué NO protege esto, dicho claramente

Un token válido de una comisión permite todo lo que esa comisión puede hacer,
incluso saltándose la interfaz. Es correcto: son socias de confianza con una
credencial verificada. Lo que se cierra es el acceso de **quien no tiene
credencial**, que es el problema de un sitio publicado.

Y el PIN sigue siendo un PIN: 4 a 8 dígitos. `/api/login` limita a 8 intentos
por 10 minutos y el hash es scrypt con costo alto, pero nunca va a ser tan
fuerte como una contraseña. Es el compromiso aceptado para que las socias no
tengan que recordar credenciales.

### Abierto — 🟠 alto

3. **El cierre de período cobra antes de cerrar y sin vuelta atrás**
   (`AdminComponents.js`, `handleClosePeriod`). Si el cierre falla, las familias
   ya quedaron cobradas y el período sigue abierto: **reintentar cobra dos
   veces**. El bucle tampoco maneja errores por familia, así que puede dejar a
   unas cobradas y a otras no, en silencio. Arreglo propuesto: columna
   `charged_at` en `sealed_orders` para que el cobro sea idempotente y el
   reintento salte lo ya cobrado.

### Abierto — 🟡 medio

4. **Saldos con lectura-modificación-escritura en 7 lugares** (eran 8). Todos
   calculan `(saldo || 0) ± monto` en el navegador y sobrescriben. Dos personas
   operando a la vez pierden un ajuste sin aviso. El de las **reservas de
   bodega** se cerró el 18-sep-2026: lo aplica un trigger en la base, que es
   atómico, porque RLS le prohíbe a una familia escribir su propio saldo y hubo
   que reemplazarlo. Los otros siete siguen igual, y el mismo patrón —un trigger
   o una función en la base— sirve para todos.
5. **Las reservas de bodega pueden sobrevender.** El stock disponible se calcula
   desde el estado local; dos familias reservando a la vez ven ambas stock. El
   *cargo* ya es atómico (punto 4), la *validación de stock* todavía no: falta
   moverla a la base, por ejemplo con una restricción o un trigger que rechace
   la asignación si excede lo disponible.
   Sí se corrigió que lo dado de baja por merma cuente como no disponible
   (`disponibleEnBodega`): antes un producto que se echó a perder seguía
   apareciendo para reservar.
6. ~~**El resumen del cierre no cuadra con lo cobrado.**~~ **RESUELTO el
   18-sep-2026.** `totalValue` sumaba los pedidos de todas y el bucle de cobro
   solo recorría a las que tenían `role === 'familia'`, así que las
   administradoras entraban en el total recaudado y no en el cobro. Las dos
   cifras ahora salen de la misma lista (`rolesDe(f).includes('familia')`), que
   incluye a las socias de comisión. Ver §8.
