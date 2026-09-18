// ─── UNIDADES: FORMATO DE VENTA, NO UNIDAD DE MEDIDA ─────────────────────────
//
// `products.unit` **no** es una unidad de medida: es el FORMATO DE VENTA, y
// `price` es el precio de ese formato. "500 gr" significa «bolsa de medio kilo»
// y el precio es el de la bolsa, no el del gramo. Confundir las dos cosas es el
// error que hace que alguien divida un precio por mil.
//
// Hay 24 variantes de texto libre para lo que son cinco unidades canónicas:
//
//   18 "500 gr"     4 "1 Kg"      1 "25 gr"      1 "200 un"
//   17 "Kg"         2 "5 lt"      1 "330 ml"     1 "24 rollos"
//   12 "un"         2 "1 lt"      1 "270 ml"     1 "Caja 3 un"
//    9 "100 gr"     2 "250 gr"    1 "200 gr"     1 "500 cc"
//                                 1 "150 gr"     1 "350 gr"
//                                 1 "120 gr"     1 "60 ml"
//                                 1 "50 gr"      1 "30 ml"
//                                 1 "3 lt"       1 "Kilo"
//
// ── Qué rompe y qué NO rompe este desorden ──────────────────────────────────
//
// NO rompe el consolidado por proveedor: agrupa por producto, y cada producto
// arrastra su propio formato. Vale aclararlo porque es la conclusión intuitiva
// y es falsa, y arreglar algo que no está roto cuesta igual que arreglar algo
// que sí.
//
// Sí rompe tres cosas: la legibilidad de la orden que sale hacia afuera
// ("Kg" y "Kilo" y "1 Kg" son lo mismo y el proveedor lee tres), el cálculo de
// peso total por proveedor, y el emparejamiento automático al importar precios.
//
// ── Por qué `unit` se conserva tal cual ─────────────────────────────────────
//
// La normalización AGREGA dos columnas (`format_qty`, `format_unit`) y no
// reescribe `unit`. Dos razones:
//
//   1. "24 rollos" canonizado es "24 un", y eso pierde información real: quien
//      recibe la caja necesita saber que son rollos. Lo mismo "Caja 3 un".
//      La etiqueta que lee una persona y la que usa una cuenta son distintas.
//
//   2. `sealed_orders.items` tiene el formato congelado dentro. Reescribir
//      `unit` haría que un pedido viejo y el maestro dijeran cosas distintas
//      del mismo producto, que es exactamente lo que la foto en JSONB evita.

export const CANONICAS = {
  gr: { label: 'gr', nombre: 'gramos',      tipo: 'peso',     enBase: 1,    base: 'gr' },
  kg: { label: 'kg', nombre: 'kilos',       tipo: 'peso',     enBase: 1000, base: 'gr' },
  ml: { label: 'ml', nombre: 'mililitros',  tipo: 'volumen',  enBase: 1,    base: 'ml' },
  lt: { label: 'lt', nombre: 'litros',      tipo: 'volumen',  enBase: 1000, base: 'ml' },
  un: { label: 'un', nombre: 'unidades',    tipo: 'conteo',   enBase: 1,    base: 'un' },
};

// Sinónimos que aparecen en los datos reales, más los que van a aparecer.
// `cc` es mililitros; `rollos`, `caja`, `bolsa`, `paquete` y `docena` son
// envases, y un envase se cuenta: su unidad canónica es `un`.
const SINONIMOS = {
  gr: 'gr', g: 'gr', grs: 'gr', gramo: 'gr', gramos: 'gr',
  kg: 'kg', k: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogramo: 'kg', kilogramos: 'kg',
  ml: 'ml', cc: 'ml', mililitro: 'ml', mililitros: 'ml',
  lt: 'lt', l: 'lt', lts: 'lt', litro: 'lt', litros: 'lt',
  un: 'un', u: 'un', uni: 'un', unid: 'un', unidad: 'un', unidades: 'un',
  rollo: 'un', rollos: 'un',
  caja: 'un', cajas: 'un',
  bolsa: 'un', bolsas: 'un',
  paquete: 'un', paquetes: 'un', paq: 'un',
  frasco: 'un', frascos: 'un',
  bandeja: 'un', bandejas: 'un',
  atado: 'un', atados: 'un',
  malla: 'un', mallas: 'un',
  pan: 'un', panes: 'un',
  docena: 'un',
};

const sinAcentos = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Interpreta el texto libre. Devuelve { qty, unit, confianza, texto }.
//
//   confianza 'alta'   el texto trae número y unidad reconocible ("500 gr")
//             'media'  trae unidad sin número: se asume 1 ("Kg" → 1 kg)
//             'baja'   hay que adivinar, o no se pudo
//
// La confianza importa: normalizar 82 productos a mano es una tarde, y
// normalizarlos mal es un precio dividido por mil. Lo que la función no está
// segura de entender lo dice, para que una persona lo revise en vez de que se
// aplique en silencio.
export function interpretarFormato(texto) {
  const t = sinAcentos(texto).trim();
  if (!t) return { qty: null, unit: null, confianza: 'baja', texto: texto || '', motivo: 'vacío' };

  // "docena" sin número son 12, y es el único caso donde la palabra trae la
  // cantidad adentro.
  if (/\bdocena\b/.test(t)) return { qty: 12, unit: 'un', confianza: 'alta', texto };

  // Números (enteros o decimales, con coma o punto). El número puede venir
  // después de la palabra ("Caja 3 un"), así que se buscan todos.
  const numeros = (t.match(/\d+(?:[.,]\d+)?/g) || []).map(n => parseFloat(n.replace(',', '.')));
  const qty = numeros.length ? numeros[0] : null;

  // Unidades reconocibles en el texto, en orden de aparición. Se recorren todas
  // porque la unidad puede no ser la última palabra: "Caja 3 un" y "24 rollos"
  // ponen la palabra en lados distintos.
  const unidades = t.split(/[^a-z]+/).filter(Boolean).map(w => SINONIMOS[w]).filter(Boolean);
  const canonicas = [...new Set(unidades)];
  const unit = canonicas.length ? unidades[0] : null;

  // Dos unidades canónicas distintas, o dos números, es un formato compuesto:
  // "3 bandejas de 500 gr" son tres envases de medio kilo. Quedarse con el
  // primer par daría "3 un" —cierto a medias y sin el peso— con toda la
  // seguridad del mundo. Una respuesta confiada y equivocada es peor que no
  // responder: nadie la va a ir a revisar.
  if (canonicas.length > 1 || numeros.length > 1) {
    return {
      qty, unit, confianza: 'baja', texto,
      motivo: 'formato compuesto (' + canonicas.join(' y ') + '): decide una persona',
    };
  }

  if (unit && qty != null) return { qty, unit, confianza: 'alta', texto };

  // Unidad sin número: "Kg" es un kilo, "un" es una unidad. Es la convención
  // que los 17 "Kg" y los 12 "un" del maestro ya asumen.
  if (unit && qty == null) return { qty: 1, unit, confianza: 'media', texto, motivo: 'sin número, se asume 1' };

  // Número sin unidad: no se adivina si son gramos o unidades. Un "500" suelto
  // podrían ser 500 gramos de harina o 500 unidades de bolsa, y equivocarse
  // cambia el precio por kilo en tres órdenes de magnitud.
  if (!unit && qty != null) return { qty, unit: null, confianza: 'baja', texto, motivo: 'no se reconoce la unidad' };

  return { qty: null, unit: null, confianza: 'baja', texto, motivo: 'no se reconoce el formato' };
}

// Etiqueta canónica, para la orden que sale hacia el proveedor: ahí conviene
// que "Kg", "Kilo" y "1 Kg" se lean igual.
export function formatoCanonico(qty, unit) {
  if (qty == null || !unit || !CANONICAS[unit]) return null;
  const n = Number.isInteger(qty) ? qty : String(qty).replace('.', ',');
  return n + ' ' + CANONICAS[unit].label;
}

// Cuánto pesa (en gramos) o cuánto ocupa (en mililitros) una cantidad de
// formatos. Devuelve null cuando la unidad se cuenta y no se pesa: sumar
// unidades a gramos daría un número que parece válido y no significa nada.
export function enBase(qty, unit, cantidadFormatos = 1) {
  const c = CANONICAS[unit];
  if (!c || qty == null) return null;
  if (c.tipo === 'conteo') return null;
  return { valor: qty * c.enBase * cantidadFormatos, base: c.base, tipo: c.tipo };
}

// Peso total de una lista de líneas, por tipo. Es lo que el plan pedía para
// poder calcular el peso que se le compra a cada proveedor.
//
// Devuelve también `sinPeso`: cuántas líneas no se pueden pesar. Un total de
// peso que calla lo que dejó fuera es un total en el que no se puede confiar.
export function pesoTotal(lineas) {
  let gr = 0, ml = 0, sinPeso = 0, sinFormato = 0;
  (lineas || []).forEach(l => {
    const qty = l.format_qty != null ? Number(l.format_qty) : null;
    const unit = l.format_unit || null;
    if (qty == null || !unit) { sinFormato++; return; }
    const r = enBase(qty, unit, Number(l.cantidad) || 1);
    if (!r) { sinPeso++; return; }
    if (r.base === 'gr') gr += r.valor; else ml += r.valor;
  });
  return { gr, ml, kg: gr / 1000, lt: ml / 1000, sinPeso, sinFormato };
}

// Lee un producto y devuelve su formato estructurado, cayendo a interpretar
// `unit` si las columnas de la migración 008 no existen todavía.
export function formatoDe(producto) {
  if (!producto) return { qty: null, unit: null, confianza: 'baja' };
  if (producto.format_qty != null && producto.format_unit) {
    return { qty: Number(producto.format_qty), unit: producto.format_unit, confianza: 'alta', texto: producto.unit };
  }
  return interpretarFormato(producto.unit);
}

// Propuesta de normalización para todo el maestro, agrupada por lo que hay que
// revisar y lo que no. La pantalla la muestra y una persona decide.
export function planDeNormalizacion(productos = []) {
  const listos = [];       // ya tienen format_qty/format_unit correctos
  const automaticos = [];  // se interpretan con confianza alta
  const revisar = [];      // confianza media o baja: los mira una persona

  productos.forEach(p => {
    const yaTiene = p.format_qty != null && p.format_unit;
    const i = interpretarFormato(p.unit);

    if (yaTiene && Number(p.format_qty) === i.qty && p.format_unit === i.unit) {
      listos.push({ producto: p, ...i });
      return;
    }
    if (i.confianza === 'alta') automaticos.push({ producto: p, ...i });
    else revisar.push({ producto: p, ...i });
  });

  return { listos, automaticos, revisar };
}
