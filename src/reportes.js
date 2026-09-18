// ─── REPORTES ────────────────────────────────────────────────────────────────
//
// Funciones puras: reciben los datos de un período y devuelven hojas listas
// para `construirXlsx`. Sin React y sin Supabase, por la misma razón que
// `calculos.js`: un reporte que calcula por su cuenta termina diciendo una cifra
// distinta de la que muestra la pantalla, y entonces nadie sabe cuál creer.
//
// Todo lo que sea plata sale de `cuentaDeFamilia` y de `construirCargos`. Si
// mañana cambia la aritmética, cambia en un lugar y los reportes la siguen.
//
// ── Por qué se leen las tablas vivas y no el resumen del cierre ─────────────
//
// `periods.summary` es un extracto parcial que se guarda al cerrar: tiene los
// totales por familia pero no las líneas, ni los faltantes, ni la bodega. Los
// reportes se arman filtrando `period_id` en las tablas de siempre, así que un
// período cerrado da exactamente el mismo detalle que el activo.

import {
  clp, parseItems, cuentaDeFamilia, ajustesPorFamilia, resumenBajas, MOTIVOS_BAJA,
} from './calculos';
import { rolesDe, PERFILES } from './perfiles';

const fecha = (d) => d ? new Date(d).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const fechaHora = (d) => d ? new Date(d).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const si = (b) => b ? 'Sí' : 'No';

// Quién cuenta como familia que pide. Por perfiles y no por `role`: una socia
// con Balance Contable tiene `role === 'familia'` por compatibilidad, pero una
// con Administración no, y también pide.
const familiasQuePiden = (families) =>
  (families || []).filter(f => rolesDe(f).includes('familia'))
                  .slice().sort((a, b) => a.name.localeCompare(b.name));

// ── 1. Consolidado por familia ──────────────────────────────────────────────
//
// Una fila por familia, con una columna por cada cargo fijo del período. Las
// columnas dinámicas existen porque el sentido del reporte es poder rendir: un
// total de cargos sin desglose obliga a abrir el sistema para entenderlo, y este
// archivo tiene que servir sin el sistema al lado.
export function reporteFamilias({ period, families, sealed, ajustes, cargos }) {
  const fams = familiasQuePiden(families);
  const porFam = ajustesPorFamilia(ajustes);

  const colsCargos = cargos.lista.map(c => ({ t: c.name, w: 15, clp: true }));

  const columnas = [
    { t: 'Familia', w: 26 },
    { t: 'Pidió', w: 8 },
    { t: 'Retirado', w: 10 },
    { t: 'Productos', w: 14, clp: true },
    ...colsCargos,
    { t: 'No confirmados', w: 15, clp: true },
    { t: 'Faltantes', w: 13, clp: true },
    { t: 'Extras', w: 12, clp: true },
    { t: 'Total del período', w: 17, clp: true },
    { t: 'Saldo anterior', w: 15, clp: true },
    { t: 'A pagar', w: 14, clp: true },
    { t: 'Queda a favor', w: 15, clp: true },
    // Lo único que es un hecho y no un cálculo de ahora: cuánto se le descontó
    // de verdad al cerrar. En un período cerrado esta columna manda sobre las
    // anteriores, porque `families.balance` es el saldo de HOY y no el que la
    // familia traía entonces. Ver la nota de la portada.
    { t: 'Cobrado al cerrar', w: 16, clp: true },
  ];

  const acumulado = new Array(columnas.length).fill(null);
  const filas = fams.map(f => {
    const ord = sealed[f.id];
    const cuenta = cuentaDeFamilia({
      ord, ajustes: porFam.get(f.id) || [], cargo: cargos.de(f.id), saldo: f.balance || 0,
    });
    const desglose = cargos.desgloseDe(f.id);

    const fila = [
      f.name,
      si(!!ord),
      ord ? si(!!ord.retired) : '',
      ord ? cuenta.subtotal : null,
      // Una familia eximida muestra la celda vacía, no un cero: el cero diría
      // que el cargo se aplicó y salió en cero.
      ...desglose.map(c => (ord && !c.exenta) ? c.amount : null),
      cuenta.noConfirmados || null,
      cuenta.faltantes || null,
      cuenta.extras || null,
      cuenta.delPeriodo || null,
      (f.balance || 0) || null,
      cuenta.aPagar || null,
      cuenta.quedaAFavor || null,
      (ord && ord.charged_amount != null) ? Number(ord.charged_amount) : null,
    ];

    fila.forEach((v, i) => {
      if (typeof v === 'number') acumulado[i] = (acumulado[i] || 0) + v;
    });
    return fila;
  });

  const totales = acumulado.slice();
  totales[0] = 'TOTAL (' + fams.length + ' familias)';
  totales[1] = '';
  totales[2] = '';

  // Segunda hoja: el detalle línea por línea. Es el que se imprime para armar
  // las cajas, y sin él el consolidado por familia no sirve en la bodega.
  const detalle = [];
  fams.forEach(f => {
    const ord = sealed[f.id];
    if (!ord) return;
    parseItems(ord).filter(i => Number(i.qty) > 0).forEach(i => {
      detalle.push([f.name, i.n, i.u || '', Number(i.qty), Number(i.p) || 0, (Number(i.p) || 0) * Number(i.qty)]);
    });
  });

  return [
    {
      nombre: 'Por familia',
      columnas, filas, totales,
    },
    {
      nombre: 'Detalle de pedidos',
      columnas: [
        { t: 'Familia', w: 26 }, { t: 'Producto', w: 34 }, { t: 'Formato', w: 12 },
        { t: 'Cantidad', w: 10 }, { t: 'Precio unitario', w: 15, clp: true }, { t: 'Monto', w: 14, clp: true },
      ],
      filas: detalle,
      totales: ['TOTAL', '', '', null, null, detalle.reduce((s, r) => s + r[5], 0)],
    },
  ];
}

// ── 2. Consolidado por proveedor ────────────────────────────────────────────
//
// Cuánto hay que comprarle a cada uno. Se arma desde los pedidos sellados, no
// desde las órdenes de compra ya enviadas: las órdenes son una foto de lo que se
// pidió ese día, y el reporte tiene que reflejar el pedido actual.
export function reporteProveedores({ period, families, sealed, products, providers, purchaseOrders = [] }) {
  const fams = familiasQuePiden(families);
  const prodPorId = new Map((products || []).map(p => [p.id, p]));
  const provPorId = new Map((providers || []).map(p => [p.id, p]));

  // producto → { prod, qty, familias: Map<familyId, qty> }
  const agrupado = new Map();
  fams.forEach(f => {
    const ord = sealed[f.id];
    if (!ord) return;
    parseItems(ord).filter(i => Number(i.qty) > 0).forEach(i => {
      if (!agrupado.has(i.id)) agrupado.set(i.id, { item: i, qty: 0, familias: new Map() });
      const a = agrupado.get(i.id);
      a.qty += Number(i.qty);
      a.familias.set(f.name, (a.familias.get(f.name) || 0) + Number(i.qty));
    });
  });

  // Qué respondió el proveedor de cada línea, para no tener que cruzarlo a mano.
  const confirmado = new Map();
  purchaseOrders.filter(o => o.status === 'confirmada').forEach(o => {
    (o.lines || []).forEach(l => {
      if (l.product_id == null) return;
      confirmado.set(l.product_id, {
        qty: l.confirmed_qty != null ? Number(l.confirmed_qty) : (l.available === false ? 0 : null),
        disponible: l.available,
        fuente: o.confirmed_source === 'comision' ? 'Registrado por la comisión' : 'Respondió el proveedor',
      });
    });
  });

  const filas = [];
  Array.from(agrupado.values()).forEach(({ item, qty, familias }) => {
    const prod = prodPorId.get(item.id);
    const prov = prod && prod.provider_id ? provPorId.get(prod.provider_id) : null;
    const conf = confirmado.get(item.id);
    filas.push([
      (prov && prov.name) || item.pv || (prod && prod.provider) || 'Sin proveedor',
      item.n,
      item.u || '',
      qty,
      Number(item.p) || 0,
      (Number(item.p) || 0) * qty,
      conf ? (conf.qty == null ? 'Confirmado' : conf.qty === 0 ? 'No lo trae' : conf.qty < qty ? 'Parcial: ' + conf.qty : 'Confirmado') : 'Sin respuesta',
      conf ? conf.fuente : '',
      Array.from(familias.entries()).map(([n, q]) => n + ' (' + q + ')').join(', '),
    ]);
  });
  filas.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));

  // Resumen: una fila por proveedor, que es lo que se mira para saber a quién
  // hay que pagarle cuánto.
  const porProv = new Map();
  filas.forEach(r => {
    if (!porProv.has(r[0])) porProv.set(r[0], { productos: 0, monto: 0 });
    const a = porProv.get(r[0]);
    a.productos++;
    a.monto += r[5];
  });

  const resumen = Array.from(porProv.entries())
    .map(([nombre, a]) => {
      const prov = (providers || []).find(p => p.name === nombre);
      return [nombre, prov ? si(!!prov.is_member) : '', (prov && prov.email) || '', a.productos, a.monto];
    })
    .sort((a, b) => b[4] - a[4]);

  return [
    {
      nombre: 'Resumen proveedores',
      columnas: [
        { t: 'Proveedor', w: 28 }, { t: 'Es socio', w: 10 }, { t: 'Correo', w: 30 },
        { t: 'Productos', w: 11 }, { t: 'Monto a comprar', w: 17, clp: true },
      ],
      filas: resumen,
      totales: ['TOTAL', '', '', resumen.reduce((s, r) => s + r[3], 0), resumen.reduce((s, r) => s + r[4], 0)],
    },
    {
      nombre: 'Detalle por producto',
      columnas: [
        { t: 'Proveedor', w: 26 }, { t: 'Producto', w: 34 }, { t: 'Formato', w: 12 },
        { t: 'Cantidad total', w: 13 }, { t: 'Precio unitario', w: 15, clp: true },
        { t: 'Monto', w: 14, clp: true }, { t: 'Respuesta', w: 16 }, { t: 'Origen respuesta', w: 24 },
        { t: 'Quién lo pidió', w: 60 },
      ],
      filas,
      totales: ['TOTAL', '', '', null, null, filas.reduce((s, r) => s + r[5], 0), '', '', ''],
    },
  ];
}

// ── 3 y 4. Faltantes y extras ───────────────────────────────────────────────
//
// Van en el mismo archivo pero en hojas separadas. Son dos conversaciones
// distintas: los faltantes se reclaman al proveedor y los extras se cobran a la
// familia.
export function reporteAjustes({ period, families, ajustes, products, providers }) {
  const famPorId = new Map((families || []).map(f => [f.id, f]));
  const prodPorId = new Map((products || []).map(p => [p.id, p]));
  const provPorId = new Map((providers || []).map(p => [p.id, p]));

  const proveedorDe = (productId) => {
    const p = prodPorId.get(productId);
    if (!p) return '';
    const prov = p.provider_id ? provPorId.get(p.provider_id) : null;
    return (prov && prov.name) || p.provider || '';
  };

  const origen = (a) => a.source === 'proveedor' ? 'Lo avisó el proveedor'
    : a.source === 'familia' ? 'Lo registró la familia'
    : 'Lo registró la comisión';

  const filaBase = (a) => [
    (famPorId.get(a.family_id) || {}).name || a.family_id,
    a.product_name,
    proveedorDe(a.product_id),
    a.unit || '',
    Number(a.qty) || 0,
    Number(a.unit_price) || 0,
    Math.abs(Number(a.amount) || 0),
    origen(a),
    a.note || '',
    fechaHora(a.created_at),
  ];

  const colsBase = [
    { t: 'Familia', w: 24 }, { t: 'Producto', w: 32 }, { t: 'Proveedor', w: 22 },
    { t: 'Formato', w: 11 }, { t: 'Cantidad', w: 10 }, { t: 'Precio unitario', w: 14, clp: true },
    { t: 'Monto', w: 13, clp: true }, { t: 'Origen', w: 24 }, { t: 'Nota', w: 40 },
    { t: 'Registrado', w: 18 },
  ];

  const hoja = (tipo, nombre) => {
    const filas = (ajustes || []).filter(a => a.type === tipo).map(filaBase);
    return {
      nombre,
      columnas: colsBase,
      filas,
      totales: ['TOTAL (' + filas.length + ')', '', '', '', null, null,
                filas.reduce((s, r) => s + r[6], 0), '', '', ''],
    };
  };

  const extras = (ajustes || []).filter(a => a.type === 'extra');
  const hojaExtras = {
    nombre: 'Extras',
    columnas: [...colsBase.slice(0, 7), { t: 'Pagado', w: 10 }, ...colsBase.slice(7)],
    filas: extras.map(a => {
      const f = filaBase(a);
      return [...f.slice(0, 7), si(!!a.paid), ...f.slice(7)];
    }),
    totales: ['TOTAL (' + extras.length + ')', '', '', '', null, null,
              extras.reduce((s, a) => s + Math.abs(Number(a.amount) || 0), 0),
              // Lo que de verdad importa del total de extras es cuánto queda por
              // cobrar, no cuánto se llevaron.
              'Por cobrar: ' + clp(extras.filter(a => !a.paid).reduce((s, a) => s + Math.abs(Number(a.amount) || 0), 0)),
              '', '', ''],
  };

  return [
    hoja('no_confirmado', 'No confirmados'),
    hoja('faltante', 'Faltantes'),
    hojaExtras,
  ];
}

// ── 5. Stock de bodega ──────────────────────────────────────────────────────
export function reporteBodega({ period, families, bodega = [], asignaciones = [], bajas = [] }) {
  const famPorId = new Map((families || []).map(f => [f.id, f]));

  const sumaDe = (lista, itemId) => lista
    .filter(x => String(x.bodega_id) === String(itemId))
    .reduce((s, x) => s + (Number(x.quantity) || 0), 0);

  const filas = bodega.map(it => {
    const asignado = sumaDe(asignaciones, it.id);
    // Lo dado de baja también resta. Un producto que se echó a perder no está
    // disponible, y contarlo como tal es el error que hace que alguien lo
    // reserve.
    const deBaja = sumaDe(bajas, it.id);
    const disponible = (Number(it.quantity) || 0) - asignado - deBaja;
    return [
      it.product_name, it.provider || '', it.unit || '',
      Number(it.quantity) || 0, asignado, deBaja, disponible,
      Number(it.price) || 0,
      (Number(it.price) || 0) * (Number(it.quantity) || 0),
      (Number(it.price) || 0) * disponible,
      fecha(it.created_at),
    ];
  });

  const asignadas = asignaciones.map(a => {
    const it = bodega.find(b => String(b.id) === String(a.bodega_id));
    return [
      (famPorId.get(a.family_id) || {}).name || a.family_id,
      (it && it.product_name) || a.product_name || '',
      Number(a.quantity) || 0,
      Number(a.total_value) || 0,
      fechaHora(a.created_at),
    ];
  }).sort((x, y) => String(x[0]).localeCompare(String(y[0])));

  // Las bajas. Merma y regalo van en la misma hoja pero con el motivo a la
  // vista, y la columna que dice si costó plata separa la pérdida real de lo
  // que solo salió del stock.
  const res = resumenBajas(bajas);
  const filasBajas = bajas.map(b => {
    const cfg = MOTIVOS_BAJA[b.reason] || {};
    return [
      cfg.label || b.reason,
      b.product_name,
      b.unit || '',
      Number(b.quantity) || 0,
      Number(b.unit_price) || 0,
      Number(b.amount) || 0,
      cfg.cuestaPlata ? 'Sí' : 'No',
      b.note || '',
      b.created_by_name || '',
      fechaHora(b.created_at),
    ];
  }).sort((x, y) => String(x[0]).localeCompare(String(y[0])) || String(x[1]).localeCompare(String(y[1])));

  const hojas = [
    {
      nombre: 'Stock en bodega',
      columnas: [
        { t: 'Producto', w: 32 }, { t: 'Proveedor', w: 22 }, { t: 'Formato', w: 11 },
        { t: 'En bodega', w: 11 }, { t: 'Asignado', w: 11 }, { t: 'De baja', w: 10 },
        { t: 'Disponible', w: 11 },
        { t: 'Precio unitario', w: 14, clp: true }, { t: 'Valor total', w: 14, clp: true },
        { t: 'Valor disponible', w: 15, clp: true }, { t: 'Ingresado', w: 13 },
      ],
      filas,
      totales: ['TOTAL (' + filas.length + ' ítems)', '', '',
                filas.reduce((s, r) => s + r[3], 0),
                filas.reduce((s, r) => s + r[4], 0),
                filas.reduce((s, r) => s + r[5], 0),
                filas.reduce((s, r) => s + r[6], 0),
                null,
                filas.reduce((s, r) => s + r[8], 0),
                filas.reduce((s, r) => s + r[9], 0), ''],
    },
    {
      nombre: 'Asignaciones',
      columnas: [
        { t: 'Familia', w: 26 }, { t: 'Producto', w: 32 }, { t: 'Cantidad', w: 10 },
        { t: 'Monto', w: 14, clp: true }, { t: 'Cuándo', w: 18 },
      ],
      filas: asignadas,
      totales: ['TOTAL (' + asignadas.length + ')', '', null, asignadas.reduce((s, r) => s + r[3], 0), ''],
    },
  ];

  if (filasBajas.length) {
    hojas.push({
      nombre: 'Mermas y sobrantes',
      columnas: [
        { t: 'Motivo', w: 24 }, { t: 'Producto', w: 32 }, { t: 'Formato', w: 11 },
        { t: 'Cantidad', w: 10 }, { t: 'Precio unitario', w: 14, clp: true },
        { t: 'Valor', w: 14, clp: true }, { t: '¿Es pérdida?', w: 13 },
        { t: 'Qué pasó', w: 44 }, { t: 'Lo anotó', w: 22 }, { t: 'Cuándo', w: 18 },
      ],
      filas: filasBajas,
      // El total que importa es la pérdida real, no la suma de todo: las
      // devoluciones y los ajustes de inventario salieron del stock pero no
      // costaron plata, y sumarlos daría una pérdida inflada.
      totales: ['PÉRDIDA REAL (merma + regalo + consumo)', '', '', null, null,
                res.perdida, '', 'Sin costo: ' + clp(res.sinCosto), '', ''],
    });
  }

  return hojas;
}

// ── 6. Las familias ─────────────────────────────────────────────────────────
//
// El padrón: quién es socia, con qué perfiles, con qué correos y qué saldo.
// Se usa para las convocatorias y para revisar los correos antes del Go Live.
export function reporteFamiliasPadron({ families }) {
  const todas = (families || []).slice().sort((a, b) => a.name.localeCompare(b.name));

  const filas = todas.map(f => [
    f.name,
    f.initials || '',
    f.email || '',
    f.email2 || '',
    rolesDe(f).filter(r => PERFILES[r]).map(r => PERFILES[r].corto).join(', '),
    si(!!f.pin_set_at),
    f.last_login_at ? fechaHora(f.last_login_at) : 'Nunca',
    Number(f.balance) || 0,
    fecha(f.created_at),
  ]);

  // Cuántas hay de cada perfil. Es la pregunta de "cantidad de familias" que
  // pedía el plan, y contada por perfil sirve para saber si alguna comisión
  // quedó sin nadie al rotar.
  const conteos = Object.entries(PERFILES).map(([id, cfg]) => [
    cfg.label,
    todas.filter(f => rolesDe(f).includes(id)).length,
    todas.filter(f => rolesDe(f).includes(id)).map(f => f.name).join(', '),
  ]);

  // Un correo repetido entre familias significa que una no va a recibir sus
  // avisos, y es justo lo que hay que revisar antes del Go Live.
  const correos = new Map();
  todas.forEach(f => {
    [f.email, f.email2].filter(Boolean).forEach(e => {
      const k = e.toLowerCase().trim();
      correos.set(k, [...(correos.get(k) || []), f.name]);
    });
  });
  const repetidos = Array.from(correos.entries())
    .filter(([, quienes]) => quienes.length > 1)
    .map(([correo, quienes]) => [correo, quienes.length, quienes.join(', ')]);

  const hojas = [
    {
      nombre: 'Padrón de familias',
      columnas: [
        { t: 'Familia', w: 28 }, { t: 'Iniciales', w: 10 }, { t: 'Correo principal', w: 30 },
        { t: 'Segundo correo', w: 30 }, { t: 'Perfiles', w: 34 }, { t: 'Tiene PIN', w: 10 },
        { t: 'Último acceso', w: 18 }, { t: 'Saldo', w: 14, clp: true }, { t: 'Desde', w: 13 },
      ],
      filas,
      totales: ['TOTAL: ' + todas.length + ' familias', '', '', '', '', '', '',
                filas.reduce((s, r) => s + r[7], 0), ''],
    },
    {
      nombre: 'Familias por perfil',
      columnas: [{ t: 'Perfil', w: 26 }, { t: 'Cuántas', w: 10 }, { t: 'Quiénes', w: 70 }],
      filas: conteos,
    },
  ];

  if (repetidos.length) {
    hojas.push({
      nombre: 'Correos repetidos',
      columnas: [{ t: 'Correo', w: 34 }, { t: 'Cuántas familias', w: 16 }, { t: 'Quiénes', w: 60 }],
      filas: repetidos,
    });
  }

  return hojas;
}

// ── Hoja de portada ─────────────────────────────────────────────────────────
//
// Un archivo que se archiva y se abre meses después tiene que decir de qué
// período es y cuándo se generó. Sin esto, dos reportes del mismo nombre en una
// carpeta son indistinguibles.
export function hojaPortada({ period, cargos, quien, titulo }) {
  const filas = [
    ['Reporte', titulo],
    ['Período', period.label + (period.month ? ' · ' + period.month : '')],
    ['Estado del período', period.active ? 'Activo' : 'Cerrado el ' + fecha(period.closed_at)],
    ['Pedidos abren', fecha(period.date_from)],
    ['Pedidos cierran', fecha(period.date_to)],
    ['Entrega', fecha(period.date_delivery)],
    ['Límite confirmación proveedores', fecha(period.date_confirm_until)],
    ['Límite de ajustes de las familias', fecha(period.date_adjust_until)],
    ['', ''],
    ['Cargos fijos del período', cargos.lista.length ? '' : 'Ninguno'],
    ...cargos.lista.map(c => ['   ' + c.name, clp(c.amount) + (c.note ? ' — ' + c.note : '')]),
    ['   Total por familia', clp(cargos.total)],
    ['', ''],
    ...(cargos.exenciones.length ? [['Exenciones vigentes', String(cargos.exenciones.length)]] : []),
    ...cargos.exenciones.map(e => {
      const c = cargos.lista.find(x => x.id === e.charge_id);
      return ['   ' + ((c && c.name) || ''), e.reason + (e.granted_by_name ? ' (concedida por ' + e.granted_by_name + ')' : '')];
    }),
    ['', ''],
    ['Generado', fechaHora(new Date())],
    ['Generado por', quien || ''],
    ['', ''],
    ['Fuente de los datos', 'Tablas vivas filtrando por period_id, no el resumen del cierre.'],
    ['', 'Un período cerrado da el mismo detalle que el activo.'],
    ...(period.active ? [] : [
      ['', ''],
      ['OJO — período cerrado', 'Las columnas de saldo muestran el saldo de HOY, no el que la familia'],
      ['', 'traía cuando este período se cerró: families.balance es un solo número que'],
      ['', 'se va actualizando. Para saber qué se cobró de verdad, la columna que'],
      ['', 'manda es "Cobrado al cerrar", que quedó escrita en el pedido ese día.'],
    ]),
  ];

  return {
    nombre: 'Portada',
    columnas: [{ t: 'Dato', w: 36 }, { t: 'Valor', w: 64 }],
    filas,
  };
}

// Nombre de archivo sin caracteres que Windows rechace.
export function nombreArchivo(period, sufijo) {
  const limpio = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-');
  return 'Quilpueblo-' + limpio(period.label) + '-' + sufijo + '.xlsx';
}

// ── El catálogo de reportes ─────────────────────────────────────────────────
//
// Una sola lista, para que la pantalla no tenga que saber qué reporte necesita
// qué datos. `necesita` es lo que hay que haber cargado antes de armarlo: sin
// eso, un reporte vacío parecería un período sin movimiento.
export const REPORTES = [
  {
    id: 'familias',
    titulo: 'Consolidado por familia',
    descripcion: 'Qué debe cada familia, con los cargos desglosados, y el detalle línea por línea de cada pedido.',
    ic: '👥',
    necesita: ['sealed', 'ajustes'],
    hojas: (d) => reporteFamilias(d),
  },
  {
    id: 'proveedores',
    titulo: 'Consolidado por proveedor',
    descripcion: 'Cuánto comprarle a cada proveedor, qué respondió, y qué familia pidió qué.',
    ic: '🚜',
    necesita: ['sealed', 'purchaseOrders'],
    hojas: (d) => reporteProveedores(d),
  },
  {
    id: 'ajustes',
    titulo: 'Faltantes y extras',
    descripcion: 'Lo que el proveedor no trajo, lo que faltó en la caja y lo que las familias se llevaron de más.',
    ic: '⚖️',
    necesita: ['ajustes'],
    hojas: (d) => reporteAjustes(d),
  },
  {
    id: 'bodega',
    titulo: 'Stock de bodega',
    descripcion: 'Qué hay en bodega, cuánto está asignado, cuánto se dio de baja por merma o regalo, y cuánto queda disponible.',
    ic: '🏪',
    necesita: ['bodega'],
    hojas: (d) => reporteBodega(d),
  },
  {
    id: 'padron',
    titulo: 'Padrón de familias',
    descripcion: 'Las socias con sus correos, perfiles y saldos. Incluye el aviso de correos repetidos.',
    ic: '📇',
    necesita: [],
    hojas: (d) => reporteFamiliasPadron(d),
  },
];
