# Puesta en marcha — paso a paso

Guía para dejar el sistema seguro. **No hace falta ser técnico**: son cinco
pasos, se copian y pegan valores, y cada uno dice cómo comprobar que quedó bien.

Escrito el 18 de septiembre de 2026. Actualizado el 19: la migración `006` ya
está hecha.

> **Regla de oro:** los pasos van en orden y ninguno se salta. El paso 5 es el
> único que puede dejar a la cooperativa sin poder trabajar, y solo se hace si
> el paso 3 salió bien.

---

## Dónde está cada cosa

| | Para qué |
|---|---|
| **Supabase** → supabase.com, tu proyecto | La base de datos. Acá se pegan los archivos `.sql` |
| **Vercel** → vercel.com, proyecto `cooperativa-erp` | Donde vive el sitio. Acá se configuran las dos variables |
| **El sitio** → cooperativa-erp-nu.vercel.app | La aplicación |

---

## PASO 1 · Cuatro archivos SQL (sin riesgo)

Estas cuatro migraciones **solo agregan** columnas y tablas nuevas. No modifican
ni borran nada de lo que ya existe, así que no pueden romper nada.

Mientras falten, el sistema funciona pero avisa en pantalla qué no puede hacer
todavía.

### Cómo se ejecuta un archivo SQL

1. Entra a **supabase.com** y abre tu proyecto.
2. En el menú de la izquierda, **SQL Editor**.
3. Botón **New query**.
4. Abre el archivo en tu computador, **selecciona todo** (Ctrl+A), **copia**
   (Ctrl+C) y **pega** en el recuadro de Supabase (Ctrl+V).
5. Botón **Run** (o Ctrl+Enter).
6. Abajo aparece una tabla con el resultado. **Si no sale nada en rojo, quedó
   bien.** Cada archivo termina con una consulta de verificación que te muestra
   qué quedó configurado.

### Si te pregunta «¿con RLS o sin RLS?» → **sin RLS**

Los archivos `007`, `008` y `009` crean tablas nuevas, y Supabase te va a
preguntar eso. Elige la opción que **no** activa RLS (*"Run without RLS"*).

RLS es «quién puede ver qué». La migración `010` —el paso 5 de esta guía— es la
que lo enciende **y además crea las reglas**. Una tabla con RLS encendido y sin
reglas queda cerrada para todo el mundo, incluido el propio sistema: la pantalla
de Flujo de Caja te diría «falta ejecutar la migración 007» aunque la hayas
ejecutado, y te haría buscar un problema que no existe.

No pierdes seguridad al elegir «sin RLS»: hoy todas las tablas están abiertas de
todos modos, y lo sensible —correos y saldos— está en `families`, no en estas.
El paso 5 las cierra todas juntas, con sus reglas.

### En este orden
| Archivo | Qué habilita | Estado |
|---|---|---|
| `db/migrations/006_cierre_pedidos_y_confirmacion_asistida.sql` | Cerrar la ventana de pedidos a mano, y registrar por teléfono lo que dijo un proveedor | ✅ hecha |
| `db/migrations/007_cargos_multiples_y_exenciones.sql` | Varios cargos fijos con nombre, y eximir familias | pendiente |
| `db/migrations/008_formato_de_venta.sql` | Importar listas de precios, y el peso por proveedor | pendiente |
| `db/migrations/009_mermas_regalos_sobrantes.sql` | Registrar mermas, regalos y sobrantes de bodega | pendiente |

Los archivos están en la carpeta `db/migrations` del proyecto. Si preferís
abrirlos desde GitHub: github.com/cristopher-cpu/cooperativa-erp → carpeta `db`
→ `migrations`.

**Para comprobar que quedaron:** entra al panel. Deberían desaparecer los avisos
amarillos que decían «falta ejecutar la migración…», y en **Flujo de Caja**
tendrías que poder agregar cargos fijos con nombre.

---

## PASO 2 · Las dos variables en Vercel

Acá empieza la parte de seguridad. Son dos valores que se copian de Supabase y
se pegan en Vercel.

> ⚠️ **Nunca** les pongas `REACT_APP_` delante del nombre. Ese prefijo hace que
> el valor quede a la vista de cualquiera que abra el sitio, y con estos dos
> valores a la vista la seguridad no serviría de nada.

### 2.a · Copiar los valores desde Supabase

1. En Supabase, abajo a la izquierda: **Project Settings** (el engranaje).
2. Entra a **API Keys** (en proyectos más antiguos dice solo **API**).
3. Busca **`service_role`**. Tiene un botón para revelarla y copiarla.
   Es una cadena larguísima. **Cópiala.**
   - *Este valor es la llave maestra de tu base.* No lo pegues en un correo, ni
     en WhatsApp, ni en un documento compartido.
4. Busca **JWT Secret**. Puede estar en la misma página, o en una pestaña
   llamada **JWT Keys**. Revélalo y **cópialo**.
   - **Si no encuentras el JWT Secret en ninguna parte**, para acá y avísame:
     significa que tu proyecto usa otro sistema de firma y hay que cambiar el
     enfoque. Es el único punto de esta guía que podría no aplicar.

### 2.b · Pegarlos en Vercel

1. Entra a **vercel.com**, abre el proyecto **cooperativa-erp**.
2. Arriba: **Settings** → en el menú izquierdo, **Environment Variables**.
3. Agrega la primera:
   - **Key** (nombre): `SUPABASE_SERVICE_ROLE_KEY`
   - **Value** (valor): lo que copiaste de `service_role`
   - Deja marcados los tres ambientes (Production, Preview, Development)
   - **Save**
4. Agrega la segunda igual:
   - **Key**: `SUPABASE_JWT_SECRET`
   - **Value**: lo que copiaste de JWT Secret
   - **Save**

### 2.c · Volver a publicar — esto es fácil de olvidar

**Vercel no aplica las variables nuevas al sitio que ya está publicado.** Hay
que publicarlo de nuevo:

1. Arriba: pestaña **Deployments**.
2. En el primero de la lista (el más nuevo), el botón **⋯** a la derecha.
3. **Redeploy** → confirmar **Redeploy**.
4. Espera 1 o 2 minutos hasta que diga **Ready**.

### 2.d · Comprobar que llegaron

Abre esta dirección en el navegador:

```
https://cooperativa-erp-nu.vercel.app/api/estado
```

Vas a ver un texto con datos. Busca estas dos partes:

- `"sesionFirmada":true`
- `"claveDeServicio":true`

**Las dos tienen que decir `true`.** Si alguna dice `false`, o el nombre de la
variable quedó mal escrito, o falta el paso 2.c.

---

## PASO 3 · La prueba que evita el problema grande

Este paso no cambia nada. Solo comprueba que la base acepta la credencial que el
sistema le está mandando. **Es el más importante de la guía.**

1. Abre el sitio y **entra con tu cuenta y tu PIN**, como siempre.
2. Navega un rato: mira Pedidos, Consolidado, Familias, Flujo de Caja.

### Resultado A — todo funciona igual que siempre ✅

La credencial sirve. **Puedes continuar al paso 4.**

### Resultado B — aparece una franja roja arriba ❌

Va a decir algo como *«Supabase rechazó la sesión firmada»*, y las pantallas van
a salir vacías.

**No sigas al paso 5.** Significa que el JWT Secret no corresponde, o que tu
proyecto firma de otra manera.

**Cómo volver atrás en 2 minutos:**

1. Vercel → **Settings** → **Environment Variables**.
2. Al lado de `SUPABASE_JWT_SECRET`, el botón **⋯** → **Remove**.
3. **Deployments** → **⋯** del primero → **Redeploy**.
4. En un par de minutos el sitio vuelve a funcionar como antes.

Después avísame y lo resolvemos.

---

## PASO 4 · Los PIN que faltan

Hay **12 cuentas con perfil de comisión y solo 2 tienen PIN**. Las otras 10 no
van a poder entrar al panel una vez hecho el paso 5. (Sí pueden hacer pedidos
como familia; lo que no pueden es abrir el panel.)

Fabián y Ruby tienen PIN, así que pueden entrar a asignar los demás.

1. Entra al panel → pestaña **Familias**.
2. Arriba sale un recuadro rojo con **la lista de quiénes faltan**.
3. En la fila de cada una, el botón **🔒**.
4. Escribe un PIN de 4 a 8 dígitos y guarda.
   - No acepta dígitos repetidos (`1111`) ni seguidos (`1234`).
5. **Avísale a cada persona su PIN.** Por teléfono o en persona, no por correo.

Quedan pendientes: Alison Canales, Carla Leiva, Cinthya, Claudia Ruz, Inés
Tealdo, Macarena Freire, Mercedes y José, Natalia Foncea, Patricia Vallejos y
Patricia Vila.

> **También hay que cambiar el PIN `7777`** de Fabián y Ruby, que se puso para
> poder probar y es público en el repositorio.

**Para comprobar:** el recuadro rojo de la pestaña Familias desaparece cuando no
queda ninguna.

---

## PASO 5 · Cerrar la base

Solo si el paso 3 dio **Resultado A** y el paso 4 está terminado.

1. Supabase → **SQL Editor** → **New query**.
2. Copia y pega **todo** el archivo `db/migrations/010_rls_y_sesiones.sql`.
3. **Run**.
4. Abajo aparece una tabla con todas las tablas de la base y una columna `rls`.
   **Todas tienen que decir `true`.** Si alguna dice `false`, esa quedó abierta
   y hay que revisarla.

### Comprobar que quedó cerrada

Entra al sitio, haz un pedido de prueba, márcalo, entra al panel. Si todo
funciona, quedó bien.

### Si algo salió mal

Al final del archivo `010` hay un bloque comentado (las líneas que empiezan con
`--`) que **apaga la protección** y deja todo como estaba. Para usarlo: cópialo
en el SQL Editor, bórrale los `-- ` del comienzo de cada línea, y ejecútalo.

Es una **salida de emergencia**, no una alternativa: mientras esté así,
cualquiera con la dirección del sitio puede leer los correos y los saldos de las
17 familias.

---

## Resumen

| | Riesgo | Se puede deshacer |
|---|---|---|
| 1 · Cuatro archivos SQL | Ninguno — solo agregan | No hace falta |
| 2 · Variables en Vercel | Bajo | Sí, quitándolas y republicando |
| 3 · Probar | Ninguno — no cambia nada | — |
| 4 · Los PIN | Ninguno | Sí, desde el panel |
| 5 · Cerrar la base | **El único alto** | Sí, con el bloque del final del archivo |

**Mientras el paso 5 no esté hecho, la base sigue abierta a internet.** El panel
te lo va a recordar con una franja amarilla en cada sesión, a propósito: es para
que no se quede así sin que nadie se dé cuenta.
