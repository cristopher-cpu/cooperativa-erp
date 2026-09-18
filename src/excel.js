// ─── ESCRITOR DE XLSX, SIN DEPENDENCIAS ──────────────────────────────────────
//
// Genera un archivo .xlsx de verdad —varias hojas, encabezados en negrita,
// montos con formato de peso chileno— construyendo el ZIP a mano.
//
// ── Por qué no una librería ─────────────────────────────────────────────────
//
// `xlsx` pesa ~400 KB y esta app entera son 179 KB. Sumarle una librería más
// grande que el producto, para escribir seis planillas de diecisiete filas, es
// pagar con el tiempo de carga de cada socia en un celular. Tampoco sirve un
// CSV: los reportes tienen varias hojas, y seis archivos sueltos es exactamente
// lo que la cooperativa ya hace a mano y vino a dejar de hacer.
//
// ── Por qué el ZIP va sin comprimir ─────────────────────────────────────────
//
// El método 0 del formato ZIP («stored») guarda los bytes tal cual, así que no
// hace falta implementar deflate. El precio es un archivo más grande, y con los
// volúmenes reales de la cooperativa —82 productos, 17 familias— eso son unas
// decenas de kilobytes. Comprimir a cambio de trescientas líneas de código que
// nadie va a poder revisar no es un buen trato.
//
// Si algún día los reportes crecieran a megabytes, acá es donde habría que
// mirar: la estructura del ZIP ya está, solo cambiaría el método de cada entrada.

// ── CRC-32, que el formato ZIP exige por entrada ────────────────────────────
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const utf8 = (s) => new TextEncoder().encode(s);

// ── ZIP mínimo ──────────────────────────────────────────────────────────────
//
// Tres piezas por archivo: cabecera local + datos, y una entrada en el
// directorio central al final, más el registro de cierre. Todo little-endian.
function crearZip(archivos) {
  const partes = [];
  const central = [];
  let offset = 0;

  const u16 = (n) => [n & 0xFF, (n >>> 8) & 0xFF];
  const u32 = (n) => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];

  // Fecha y hora en formato DOS, que es lo que el ZIP guarda. Con ceros el
  // archivo abre igual pero el explorador de Windows muestra una fecha inválida,
  // y en una carpeta con doce reportes la fecha es cómo se distinguen.
  const ahora = new Date();
  const horaDos = (ahora.getHours() << 11) | (ahora.getMinutes() << 5) | (ahora.getSeconds() >> 1);
  const fechaDos = ((ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate();

  archivos.forEach(({ nombre, contenido }) => {
    const datos = utf8(contenido);
    const nom = utf8(nombre);
    const crc = crc32(datos);

    // Cabecera local: 30 bytes fijos y después el nombre.
    const cabecera = [
      ...u32(0x04034b50),         // firma
      ...u16(20),                 // versión necesaria para extraer
      ...u16(0x0800),             // bit 11: nombres en UTF-8
      ...u16(0),                  // método 0 = sin comprimir
      ...u16(horaDos), ...u16(fechaDos),
      ...u32(crc),
      ...u32(datos.length),       // tamaño comprimido
      ...u32(datos.length),       // tamaño original (iguales: no hay compresión)
      ...u16(nom.length),
      ...u16(0),                  // sin campos extra
    ];

    partes.push(new Uint8Array(cabecera), nom, datos);

    // Entrada del directorio central: 46 bytes fijos y después el nombre.
    //
    // Los 46 se cuentan. La primera versión de esto se quedó 2 bytes corta —se
    // había fundido «atributos internos» con «atributos externos»— y el archivo
    // resultante lo rechazaba cualquier lector con un error sobre el número de
    // entradas, que no dice nada de dónde está el problema. Si hay que tocar
    // esta lista, contar los desplazamientos de nuevo.
    central.push([
      ...u32(0x02014b50),         //  0  firma
      ...u16(20),                 //  4  versión con que se creó
      ...u16(20),                 //  6  versión necesaria
      ...u16(0x0800),             //  8  banderas
      ...u16(0),                  // 10  método
      ...u16(horaDos),            // 12  hora
      ...u16(fechaDos),           // 14  fecha
      ...u32(crc),                // 16
      ...u32(datos.length),       // 20  comprimido
      ...u32(datos.length),       // 24  original
      ...u16(nom.length),         // 28  largo del nombre
      ...u16(0),                  // 30  largo de campos extra
      ...u16(0),                  // 32  largo del comentario
      ...u16(0),                  // 34  disco donde empieza
      ...u16(0),                  // 36  atributos internos
      ...u32(0),                  // 38  atributos externos
      ...u32(offset),             // 42  dónde está su cabecera local
      ...Array.from(nom),         // 46
    ]);

    offset += cabecera.length + nom.length + datos.length;
  });

  const dirPlano = central.flat();
  const cierre = [
    ...u32(0x06054b50),
    ...u16(0), ...u16(0),
    ...u16(archivos.length), ...u16(archivos.length),
    ...u32(dirPlano.length),
    ...u32(offset),
    ...u16(0),
  ];

  return new Blob(
    [...partes, new Uint8Array(dirPlano), new Uint8Array(cierre)],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  );
}

// ── XML de la planilla ──────────────────────────────────────────────────────

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  // Excel rechaza el archivo completo si aparece un carácter de control que el
  // XML 1.0 no admite. Un nombre de producto pegado desde un PDF puede traerlos.
  // eslint-disable-next-line no-control-regex
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

// Índice de columna a letra: 0 → A, 26 → AA.
function letraCol(n) {
  let s = '';
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Estilos. Cuatro, y cada uno está por una razón:
//   0  normal
//   1  encabezado en negrita sobre fondo verde
//   2  monto en pesos, sin decimales y con separador de miles
//   3  total en negrita, también en pesos
const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0"/></numFmts>
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF1B5E20"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8F5E9"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// Una celda. `v` puede ser número, texto, o { v, clp: true } para un monto.
//
// Los textos van como `inlineStr` en vez de la tabla de cadenas compartidas:
// duplica algunos bytes, y a cambio no hay que mantener un índice global
// coherente entre hojas, que es donde estos escritores suelen romperse.
function celda(ref, valor, estilo) {
  const s = estilo ? ` s="${estilo}"` : '';
  if (valor == null || valor === '') return `<c r="${ref}"${s}/>`;
  if (typeof valor === 'number') {
    if (!isFinite(valor)) return `<c r="${ref}"${s}/>`;
    return `<c r="${ref}"${s}><v>${valor}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${esc(valor)}</t></is></c>`;
}

// Una hoja.
//
//   nombre     lo que se ve en la pestaña de abajo
//   columnas   [{ t: 'Título', w: 22, clp: true }]
//   filas      arrays de valores, en el orden de las columnas
//   totales    fila final opcional, en negrita
function hojaXml({ columnas, filas, totales }) {
  const cols = columnas.map((c, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${c.w || 16}" customWidth="1"/>`).join('');

  const encabezado = '<row r="1">' +
    columnas.map((c, i) => celda(letraCol(i) + '1', c.t, 1)).join('') + '</row>';

  const cuerpo = filas.map((fila, r) => {
    const n = r + 2;
    return `<row r="${n}">` + columnas.map((c, i) => {
      const v = fila[i];
      // Un monto vacío se deja vacío en vez de escribir $0: un cero afirma que
      // no se cobró nada, y una celda sin dato dice que no hay dato.
      const estilo = c.clp && typeof v === 'number' ? 2 : 0;
      return celda(letraCol(i) + n, v, estilo);
    }).join('') + '</row>';
  }).join('');

  const pie = totales
    ? `<row r="${filas.length + 2}">` + columnas.map((c, i) => {
        const v = totales[i];
        return celda(letraCol(i) + (filas.length + 2), v, typeof v === 'number' && c.clp ? 3 : 1);
      }).join('') + '</row>'
    : '';

  // `autoFilter` y el panel congelado: con diecisiete familias no hace falta,
  // con tres años de histórico sí, y quien abra el archivo no tiene por qué
  // saber activarlos.
  const rango = 'A1:' + letraCol(columnas.length - 1) + (filas.length + 1);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols>
<sheetData>${encabezado}${cuerpo}${pie}</sheetData>
${filas.length ? `<autoFilter ref="${rango}"/>` : ''}
</worksheet>`;
}

// Excel no acepta : \ / ? * [ ] en el nombre de una pestaña, ni más de 31
// caracteres. Un nombre inválido no da error: abre el archivo como dañado.
function nombreHoja(n, usados) {
  let base = String(n).replace(/[:\\/?*[\]]/g, '-').slice(0, 31).trim() || 'Hoja';
  let nombre = base, i = 2;
  while (usados.has(nombre)) {
    const sufijo = ' (' + i++ + ')';
    nombre = base.slice(0, 31 - sufijo.length) + sufijo;
  }
  usados.add(nombre);
  return nombre;
}

// ── La función que se usa desde fuera ───────────────────────────────────────
//
// `hojas` es [{ nombre, columnas, filas, totales }]. Devuelve un Blob listo
// para descargar.
export function construirXlsx(hojas) {
  const usados = new Set();
  const conNombre = hojas.map(h => ({ ...h, nombre: nombreHoja(h.nombre, usados) }));

  const archivos = [
    {
      nombre: '[Content_Types].xml',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${conNombre.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`,
    },
    {
      nombre: '_rels/.rels',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      nombre: 'xl/workbook.xml',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
${conNombre.map((h, i) => `<sheet name="${esc(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('\n')}
</sheets>
</workbook>`,
    },
    {
      nombre: 'xl/_rels/workbook.xml.rels',
      contenido: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${conNombre.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { nombre: 'xl/styles.xml', contenido: ESTILOS },
    ...conNombre.map((h, i) => ({
      nombre: `xl/worksheets/sheet${i + 1}.xml`,
      contenido: hojaXml(h),
    })),
  ];

  return crearZip(archivos);
}

// Dispara la descarga. `revokeObjectURL` no es opcional: sin él cada reporte
// generado queda en memoria hasta recargar la página.
export function descargar(blob, nombreArchivo) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function descargarXlsx(hojas, nombreArchivo) {
  descargar(construirXlsx(hojas), nombreArchivo);
}
