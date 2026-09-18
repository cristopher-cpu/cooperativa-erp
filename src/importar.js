// ─── IMPORTAR PRECIOS DESDE UNA PLANILLA ─────────────────────────────────────
//
// Los proveedores mandan listas de precios en Excel, y hoy alguien las escribe
// a mano en el maestro, producto por producto. Ochenta y dos productos, todos
// los ciclos, con el riesgo de tipeo que eso implica.
//
// ── Por qué se pega el contenido y no se sube el .xlsx ──────────────────────
//
// Leer un .xlsx exige descomprimir (inflate), y eso es mucho más código que
// escribirlo: escribir un ZIP sin comprimir es legal, leer uno comprimido no
// es opcional. Serían cientos de líneas o una librería de 400 KB.
//
// Lo que se hace en su lugar aprovecha algo que ya funciona: al copiar celdas
// de Excel, el portapapeles lleva el contenido separado por tabuladores. Pegar
// en un cuadro de texto es UN paso —seleccionar, Ctrl+C, Ctrl+V— contra
// «guardar como, elegir formato, buscar el archivo». Y además acepta CSV, para
// cuando el proveedor manda el archivo directamente.
//
// El precio de esta decisión es que no se leen varias hojas de un mismo
// archivo. Los proveedores mandan una lista, no un libro.
//
// ── El emparejamiento nunca se aplica solo ──────────────────────────────────
//
// Cambiar precios en masa es la operación más peligrosa del sistema: un error
// se multiplica por ochenta y dos y se descubre cuando las familias ya pidieron.
// Este archivo solo PROPONE. Cada línea sale clasificada y la pantalla obliga a
// ver el resumen antes de escribir nada.

import { interpretarFormato } from './unidades';

const normalizar = (s) => String(s == null ? '' : s)
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

// ── Números en formato chileno ──────────────────────────────────────────────
//
// "$1.234" son mil doscientos treinta y cuatro, no uno con veintitrés. Es el
// error más caro posible acá: leer un precio mil veces más chico y cobrarlo.
//
// La regla: el punto es separador de miles y la coma es decimal, salvo cuando
// hay un solo separador seguido de exactamente tres dígitos, que en un precio
// en pesos siempre es el de miles ("1.500" y "1,500" son ambos mil quinientos).
export function parsearPrecio(texto) {
  if (texto == null) return null;
  let t = String(texto).replace(/\$|\s|CLP|clp/g, '').trim();
  if (!t) return null;
  if (!/[\d]/.test(t)) return null;

  const puntos = (t.match(/\./g) || []).length;
  const comas = (t.match(/,/g) || []).length;

  if (puntos && comas) {
    // Los dos presentes: el último que aparece es el decimal.
    const ultimoPunto = t.lastIndexOf('.');
    const ultimaComa = t.lastIndexOf(',');
    if (ultimaComa > ultimoPunto) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
  } else if (comas) {
    const partes = t.split(',');
    // "1,500" en una lista de precios chilena es mil quinientos.
    t = (partes.length === 2 && partes[1].length === 3)
      ? partes.join('')
      : t.replace(',', '.');
  } else if (puntos) {
    const partes = t.split('.');
    t = (partes.length === 2 && partes[1].length === 3) || partes.length > 2
      ? partes.join('')
      : t;
  }

  const n = parseFloat(t);
  if (!isFinite(n) || n < 0) return null;
  // Los precios de la cooperativa son enteros en pesos. No hay centavos.
  return Math.round(n);
}

// ── Separar el texto pegado en filas y columnas ─────────────────────────────
//
// El separador se detecta contando: el que aparezca de forma más parecida en
// todas las líneas es el correcto. Un nombre de producto puede contener una
// coma ("Arroz, grano largo") y arruinaría una detección que solo cuente.
export function detectarSeparador(texto) {
  const lineas = texto.split(/\r?\n/).filter(l => l.trim()).slice(0, 20);
  if (!lineas.length) return '\t';

  const candidatos = ['\t', ';', ',', '|'];
  let mejor = '\t', mejorPuntaje = -1;

  candidatos.forEach(sep => {
    const cuentas = lineas.map(l => l.split(sep).length - 1);
    const total = cuentas.reduce((a, b) => a + b, 0);
    if (total === 0) return;
    // Consistencia: en una tabla real todas las filas tienen el mismo número
    // de separadores. Se premia el que más se repita.
    const moda = cuentas.reduce((acc, c) => { acc[c] = (acc[c] || 0) + 1; return acc; }, {});
    const masComun = Math.max(...Object.values(moda));
    const puntaje = masComun * 10 + total / lineas.length;
    if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = sep; }
  });

  return mejor;
}

// Divide respetando comillas, que es cómo un CSV protege una coma dentro de un
// campo. Sin esto, "Arroz, grano largo";1500 se parte en tres columnas.
function partirLinea(linea, sep) {
  const campos = [];
  let actual = '', dentro = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      // Dos comillas seguidas dentro de un campo son una comilla literal.
      if (dentro && linea[i + 1] === '"') { actual += '"'; i++; }
      else dentro = !dentro;
    } else if (c === sep && !dentro) {
      campos.push(actual); actual = '';
    } else {
      actual += c;
    }
  }
  campos.push(actual);
  return campos.map(c => c.trim());
}

// ── Qué columna es cada cosa ────────────────────────────────────────────────
//
// Se adivina por el encabezado si lo hay, y si no por el contenido: la columna
// con más celdas que parecen precio es el precio.
const PISTAS = {
  nombre: ['producto', 'nombre', 'descripcion', 'detalle', 'item', 'articulo', 'glosa'],
  precio: ['precio', 'valor', 'monto', 'costo', 'neto', 'clp', 'p. unitario', 'precio unitario'],
  formato: ['formato', 'unidad', 'medida', 'envase', 'presentacion', 'contenido', 'kg', 'peso'],
};

function detectarColumnas(filas) {
  if (!filas.length) return { nombre: 0, precio: 1, formato: null, tieneEncabezado: false };

  const primera = filas[0].map(normalizar);
  const coincide = (celda, pistas) => pistas.some(p => celda === p || celda.includes(p));

  let nombre = primera.findIndex(c => coincide(c, PISTAS.nombre));
  let precio = primera.findIndex(c => coincide(c, PISTAS.precio));
  let formato = primera.findIndex(c => coincide(c, PISTAS.formato));

  // Un encabezado de verdad tiene que nombrar al menos producto y precio. Una
  // fila de datos cuya primera celda diga "Arroz" no lo es.
  const tieneEncabezado = nombre >= 0 && precio >= 0;

  if (!tieneEncabezado) {
    const cuerpo = filas.slice(0, 15);
    const anchos = Math.max(...cuerpo.map(f => f.length));

    // La columna de precios es la que tiene más celdas parseables como número.
    let mejorPrecio = -1, mejorCuenta = 0;
    for (let c = 0; c < anchos; c++) {
      const cuenta = cuerpo.filter(f => parsearPrecio(f[c]) != null).length;
      if (cuenta > mejorCuenta) { mejorCuenta = cuenta; mejorPrecio = c; }
    }
    precio = mejorPrecio >= 0 ? mejorPrecio : 1;

    // El nombre es la primera columna con texto que no sea un número.
    let mejorNombre = -1, mejorTexto = 0;
    for (let c = 0; c < anchos; c++) {
      if (c === precio) continue;
      const cuenta = cuerpo.filter(f => f[c] && !/^[\d.,$\s]+$/.test(f[c])).length;
      if (cuenta > mejorTexto) { mejorTexto = cuenta; mejorNombre = c; }
    }
    nombre = mejorNombre >= 0 ? mejorNombre : 0;
    formato = null;
  }

  return { nombre, precio, formato: formato >= 0 ? formato : null, tieneEncabezado };
}

// ── Emparejar con el maestro ────────────────────────────────────────────────
//
// Tres niveles, de más a menos seguro:
//
//   exacto      el nombre normalizado coincide con uno y solo uno
//   sugerido    coincide por contención o por todas sus palabras, y es único
//   ambiguo     coinciden varios: la pantalla pide elegir
//   sin_match   ninguno
//
// Nunca se elige entre varios candidatos por puntaje. Cuando "Arroz" empareja
// con "Arroz grano largo" y "Arroz integral", adivinar es elegir a cuál de las
// dos se le cambia el precio, y esa apuesta la tiene que hacer una persona.
export function emparejar(nombreTexto, productos, filtroProveedorId = null) {
  const q = normalizar(nombreTexto);
  if (!q) return { tipo: 'sin_match', candidatos: [] };

  const universo = filtroProveedorId
    ? productos.filter(p => p.provider_id === filtroProveedorId)
    : productos;

  const exactos = universo.filter(p => normalizar(p.name) === q);
  if (exactos.length === 1) return { tipo: 'exacto', producto: exactos[0], candidatos: exactos };
  if (exactos.length > 1) return { tipo: 'ambiguo', candidatos: exactos };

  // Contención en cualquier dirección: "Arroz Integral 1kg" contra
  // "Arroz Integral", y al revés.
  const contiene = universo.filter(p => {
    const n = normalizar(p.name);
    return n.includes(q) || q.includes(n);
  });
  if (contiene.length === 1) return { tipo: 'sugerido', producto: contiene[0], candidatos: contiene, por: 'contención' };
  if (contiene.length > 1) return { tipo: 'ambiguo', candidatos: contiene.slice(0, 8) };

  // Todas las palabras de lo pegado aparecen en el nombre del producto.
  const palabras = q.split(' ').filter(w => w.length > 2);
  if (palabras.length) {
    const porPalabras = universo.filter(p => {
      const n = normalizar(p.name);
      return palabras.every(w => n.includes(w));
    });
    if (porPalabras.length === 1) return { tipo: 'sugerido', producto: porPalabras[0], candidatos: porPalabras, por: 'palabras' };
    if (porPalabras.length > 1) return { tipo: 'ambiguo', candidatos: porPalabras.slice(0, 8) };
  }

  return { tipo: 'sin_match', candidatos: [] };
}

// ── El plan de importación ──────────────────────────────────────────────────
//
// Recibe el texto pegado y devuelve una línea por fila, ya clasificada. No
// escribe nada: es lo que la pantalla muestra para que alguien lo apruebe.
export function planDeImportacion({ texto, productos = [], proveedorId = null }) {
  const sep = detectarSeparador(texto || '');
  const lineasCrudas = String(texto || '').split(/\r?\n/).filter(l => l.trim());
  const filas = lineasCrudas.map(l => partirLinea(l, sep));
  const cols = detectarColumnas(filas);

  const datos = cols.tieneEncabezado ? filas.slice(1) : filas;

  const lineas = datos.map((f, i) => {
    const nombreTexto = (f[cols.nombre] || '').trim();
    const precioTexto = f[cols.precio];
    const precio = parsearPrecio(precioTexto);
    const formatoTexto = cols.formato != null ? (f[cols.formato] || '').trim() : '';

    const base = {
      fila: i + (cols.tieneEncabezado ? 2 : 1),
      nombreTexto, precioTexto, precio, formatoTexto,
      formato: formatoTexto ? interpretarFormato(formatoTexto) : null,
    };

    if (!nombreTexto) return { ...base, estado: 'invalida', motivo: 'sin nombre de producto' };
    if (precio == null) return { ...base, estado: 'invalida', motivo: 'el precio no se entiende: "' + (precioTexto || '') + '"' };

    const m = emparejar(nombreTexto, productos, proveedorId);

    if (m.tipo === 'sin_match') return { ...base, estado: 'sin_match', candidatos: [] };
    if (m.tipo === 'ambiguo') return { ...base, estado: 'ambiguo', candidatos: m.candidatos };

    const prod = m.producto;
    const cambia = Number(prod.price) !== precio;
    return {
      ...base,
      estado: cambia ? (m.tipo === 'exacto' ? 'cambia' : 'cambia_sugerido') : 'igual',
      producto: prod,
      precioAnterior: Number(prod.price) || 0,
      candidatos: m.candidatos,
      por: m.por,
    };
  });

  return { separador: sep, columnas: cols, lineas, totalFilas: datos.length };
}

// Un cambio de precio muy grande casi siempre es un error de lectura o de
// columna, no una subida real. Avisar cuáles son es más útil que un total:
// la cooperativa sabe si el aceite subió 40%, y nadie sabe si subió 4.000%.
export function cambiosSospechosos(lineas, factor = 3) {
  return lineas.filter(l => {
    if (l.estado !== 'cambia' && l.estado !== 'cambia_sugerido') return false;
    const antes = l.precioAnterior;
    if (!antes) return false;
    const r = l.precio / antes;
    return r >= factor || r <= 1 / factor;
  });
}

export const RESUMEN_ESTADOS = {
  cambia:          { label: 'Cambia de precio',      color: '#1565c0', bg: '#e3f2fd', aplica: true },
  cambia_sugerido: { label: 'Cambia — revisar match', color: '#e65100', bg: '#fff3e0', aplica: true },
  igual:           { label: 'Sin cambios',           color: '#2e7d32', bg: '#e8f5e9', aplica: false },
  ambiguo:         { label: 'Varios productos posibles', color: '#6a1b9a', bg: '#f3e5f5', aplica: false },
  sin_match:       { label: 'No está en el maestro',  color: '#c62828', bg: '#ffebee', aplica: false },
  invalida:        { label: 'No se pudo leer',        color: '#455a64', bg: '#eceff1', aplica: false },
};
