// ─── ARITMÉTICA DEL PERÍODO ──────────────────────────────────────────────────
//
// Todo el cálculo de cuánto debe una familia vive aquí, en funciones puras, sin
// React ni Supabase. Estaba repartido por media docena de componentes que lo
// recalculaban cada uno a su manera, y esa es exactamente la forma en que dos
// pantallas terminan mostrando cifras distintas del mismo pedido.
//
// ── Convención de signo ─────────────────────────────────────────────────────
//
//   ajuste.amount = cuánto cambia lo que la familia DEBE
//     negativo → debe menos (no llegó / no lo trajeron)
//     positivo → debe más   (se llevó algo extra)
//
//   Total a pagar = pedido.total + cargo fijo + suma(ajustes)
//
// Un solo signo para los tres tipos: así nunca hay que preguntarse si este tipo
// suma o resta. La respuesta está en el dato.

export const TIPOS = {
  no_confirmado: {
    label: 'No confirmado',
    corto: 'No lo trae',
    descripcion: 'El proveedor avisó antes de la entrega que no lo trae',
    signo: -1,
    color: '#e65100',
    bg: '#fff3e0',
    ic: '📭',
  },
  faltante: {
    label: 'Faltante',
    corto: 'Faltó',
    descripcion: 'Estaba en la lista y no llegó a la caja, o llegó en mal estado',
    signo: -1,
    color: '#c62828',
    bg: '#ffebee',
    ic: '❗',
  },
  extra: {
    label: 'Extra',
    corto: 'Extra',
    descripcion: 'Se llevó algo que no estaba en el pedido',
    signo: +1,
    color: '#1565c0',
    bg: '#e3f2fd',
    ic: '➕',
  },
};

export const clp = n => '$' + Math.round(n || 0).toLocaleString('es-CL');

export function parseItems(ord) {
  if (!ord) return [];
  try { return Array.isArray(ord.items) ? ord.items : JSON.parse(ord.items); } catch { return []; }
}

// El monto que corresponde guardar en un ajuste, con el signo ya aplicado.
// Se calcula una vez al crearlo y se guarda: si mañana cambia el precio del
// producto, este ajuste debe seguir valiendo lo mismo.
export function montoAjuste(tipo, qty, unitPrice) {
  const cfg = TIPOS[tipo];
  if (!cfg) return 0;
  const q = Number(qty) || 0;
  const p = Number(unitPrice) || 0;
  return cfg.signo * Math.round(Math.abs(q) * Math.abs(p));
}

// Los extras ya pagados aparte no deben arrastrarse al saldo del período: la
// familia ya puso esa plata, cobrarla otra vez sería cobrar dos veces.
export function ajusteCuenta(adj) {
  if (!adj) return false;
  if (adj.type === 'extra' && adj.paid) return false;
  return true;
}

export function sumaAjustes(ajustes) {
  return (ajustes || []).filter(ajusteCuenta).reduce((s, a) => s + (Number(a.amount) || 0), 0);
}

// El cálculo completo de una familia en un período.
//
//   ord      pedido sellado (o null si no pidió)
//   ajustes  los de esta familia en este período
//   cargo    cargo fijo del período
//   saldo    saldo que traía de antes (positivo = a favor)
export function cuentaDeFamilia({ ord, ajustes = [], cargo = 0, saldo = 0 }) {
  const subtotal = ord ? (Number(ord.total) || 0) : 0;
  const cargoAplicado = ord ? (Number(cargo) || 0) : 0;   // sin pedido no hay cargo fijo

  const propios = ajustes.filter(ajusteCuenta);
  const noConfirmados = propios.filter(a => a.type === 'no_confirmado').reduce((s, a) => s + a.amount, 0);
  const faltantes = propios.filter(a => a.type === 'faltante').reduce((s, a) => s + a.amount, 0);
  const extras = propios.filter(a => a.type === 'extra').reduce((s, a) => s + a.amount, 0);
  const totalAjustes = noConfirmados + faltantes + extras;

  // Lo que cuesta el período, ya corregido. No se deja bajar de cero: si los
  // ajustes superan al pedido, el exceso es saldo a favor, no un cobro negativo.
  const bruto = subtotal + cargoAplicado + totalAjustes;
  const delPeriodo = Math.max(0, bruto);

  // El saldo anterior se aplica contra eso. Positivo = a favor.
  const aPagar = Math.max(0, delPeriodo - saldo);
  const quedaAFavor = Math.max(0, saldo - delPeriodo) + Math.max(0, -bruto);

  return {
    subtotal,
    cargo: cargoAplicado,
    noConfirmados,
    faltantes,
    extras,
    totalAjustes,
    delPeriodo,
    saldoAnterior: saldo,
    aPagar,
    quedaAFavor,
    // Lo que se descuenta del saldo al cerrar el período.
    cargoAlCerrar: delPeriodo,
    tieneAjustes: propios.length > 0,
  };
}

// Agrupa los ajustes por familia, para no filtrar el array entero en cada fila.
export function ajustesPorFamilia(ajustes) {
  const m = new Map();
  (ajustes || []).forEach(a => {
    if (!m.has(a.family_id)) m.set(a.family_id, []);
    m.get(a.family_id).push(a);
  });
  return m;
}

// ── Derivar faltantes desde la confirmación del proveedor ───────────────────
//
// Cuando el proveedor marca "no tengo", el reparto es inequívoco: nadie recibe
// ese producto, así que a cada familia que lo pidió le corresponde un ajuste por
// su cantidad completa.
//
// Cuando marca "parcial" NO se decide automáticamente. Si tres familias pidieron
// 5 kilos y solo llegan 3, quién se queda sin su parte es una decisión de la
// cooperativa, no una fórmula. Esos casos se devuelven aparte para que la
// comisión los reparta a mano.
export function derivarDeConfirmacion({ orden, sealedOrders, period, productos = [] }) {
  const automaticos = [];
  const aRepartir = [];
  if (!orden || orden.status !== 'confirmada') return { automaticos, aRepartir };

  const porProducto = new Map();
  (sealedOrders || []).forEach(ord => {
    parseItems(ord).forEach(item => {
      if (!item || !(Number(item.qty) > 0)) return;
      if (!porProducto.has(item.id)) porProducto.set(item.id, []);
      porProducto.get(item.id).push({ ord, qty: Number(item.qty) });
    });
  });

  (orden.lines || []).forEach(l => {
    const pedidoPor = porProducto.get(l.product_id) || [];
    if (pedidoPor.length === 0) return;

    const prod = productos.find(p => p.id === l.product_id);
    const precio = Number(l.price) || (prod ? Number(prod.price) : 0) || 0;
    const nada = l.available === false || l.confirmed_qty === 0;
    const parcial = !nada && l.confirmed_qty != null && l.confirmed_qty < l.qty;

    if (nada) {
      pedidoPor.forEach(({ ord, qty }) => {
        automaticos.push({
          period_id: period.id,
          family_id: ord.family_id,
          sealed_order_id: ord.id,
          type: 'no_confirmado',
          product_id: l.product_id,
          product_name: l.name,
          unit: l.unit || (prod ? prod.unit : ''),
          qty,
          unit_price: precio,
          amount: montoAjuste('no_confirmado', qty, precio),
          source: 'proveedor',
          note: 'El proveedor ' + orden.provider_name + ' informó que no lo trae',
        });
      });
    } else if (parcial) {
      aRepartir.push({
        product_id: l.product_id,
        product_name: l.name,
        unit: l.unit || '',
        precio,
        pedido: l.qty,
        llegan: l.confirmed_qty,
        faltan: l.qty - l.confirmed_qty,
        proveedor: orden.provider_name,
        familias: pedidoPor.map(({ ord, qty }) => ({ family_id: ord.family_id, sealed_order_id: ord.id, qty })),
      });
    }
  });

  return { automaticos, aRepartir };
}

// ── Ventana de ajustes de la familia ────────────────────────────────────────
//
// Del paso 08 del flujo: hay un "margen para ajustes finales de cada planilla
// desde el hogar". Mucha gente descubre en la casa que le faltó algo.
//
// La ventana es SOLO para las familias. La Comisión Retiro puede corregir
// siempre: el flujo le asigna supervisar el proceso, y sin esa válvula un olvido
// de un día se resuelve por WhatsApp y termina descuadrando el saldo.
//
// Sin fecha límite configurada no se bloquea nada: una configuración incompleta
// no debe dejar a nadie sin poder reclamar.
export function ventanaAjustes(period, ord, ahora = new Date()) {
  if (!ord) {
    return { abierta: false, motivo: 'sin_pedido', texto: 'No tienes pedido en este período.' };
  }

  const entrega = period?.date_delivery ? new Date(period.date_delivery + 'T00:00:00') : null;
  const limite = period?.date_adjust_until ? new Date(period.date_adjust_until + 'T23:59:59') : null;

  // Antes del retiro no hay nada que reclamar: la caja todavía no se abrió.
  const yaRetiro = !!ord.retired || (entrega ? ahora >= entrega : false);
  if (!yaRetiro) {
    return {
      abierta: false,
      motivo: 'antes_entrega',
      texto: entrega
        ? 'Podrás registrar faltantes y extras a partir del retiro (' +
          entrega.toLocaleDateString('es-CL', { day: 'numeric', month: 'long' }) + ').'
        : 'Podrás registrar faltantes y extras después del retiro.',
    };
  }

  if (limite && ahora > limite) {
    return {
      abierta: false,
      motivo: 'cerrada',
      limite,
      texto: 'El plazo para registrar faltantes y extras cerró el ' +
        limite.toLocaleDateString('es-CL', { day: 'numeric', month: 'long' }) +
        '. Si te falta algo por reclamar, habla con la Comisión Retiro.',
    };
  }

  const diasRestantes = limite ? Math.ceil((limite - ahora) / 864e5) : null;
  return {
    abierta: true,
    motivo: 'abierta',
    limite,
    diasRestantes,
    texto: limite
      ? 'Tienes hasta el ' + limite.toLocaleDateString('es-CL', { day: 'numeric', month: 'long' }) +
        ' para registrar faltantes o extras.'
      : 'Puedes registrar faltantes o extras de tu pedido.',
  };
}

// Una familia solo puede borrar lo que ella misma registró, y solo mientras la
// ventana siga abierta. Lo que puso el proveedor o la comisión no se toca.
export function puedeBorrarAjuste(adj, ventana) {
  return !!(adj && adj.source === 'familia' && ventana && ventana.abierta);
}

// ── Cumplimiento de proveedores ─────────────────────────────────────────────
//
// Dos cosas distintas, y conviene no confundirlas:
//
//   PUNTUALIDAD  ¿contestó la orden de compra, y antes de la fecha límite?
//                Es cortesía y orden administrativo.
//
//   PALABRA      de lo que dijo que traía, ¿cuánto llegó de verdad?
//                Es lo que de verdad le cuesta plata y trabajo a la cooperativa:
//                un proveedor que confirma todo y después no aparece hace más
//                daño que uno que avisa a tiempo que no tiene.
//
// La segunda se mide cruzando lo confirmado con los faltantes registrados en el
// retiro sobre productos de ese proveedor. Un faltante después de haber
// confirmado disponibilidad es exactamente una promesa incumplida.
export function metricasProveedores({ providers = [], purchaseOrders = [], adjustments = [], products = [], periods = [] }) {
  const limitePorPeriodo = new Map(periods.map(p => [p.id, p.date_confirm_until || null]));
  const proveedorDeProducto = new Map(products.map(p => [p.id, p.provider_id]));

  // Faltantes del retiro (no los que el propio proveedor avisó) agrupados por
  // proveedor y período: son las promesas que no se cumplieron.
  const faltantesPorProv = new Map();
  adjustments.filter(a => a.type === 'faltante').forEach(a => {
    const pid = proveedorDeProducto.get(a.product_id);
    if (!pid) return;
    const k = pid + '|' + a.period_id;
    faltantesPorProv.set(k, (faltantesPorProv.get(k) || 0) + Math.abs(Number(a.amount) || 0));
  });

  const filas = providers.map(pv => {
    const ordenes = purchaseOrders.filter(o => o.provider_id === pv.id && o.sent_at);
    const confirmadas = ordenes.filter(o => o.status === 'confirmada' && o.confirmed_at);

    // Una respuesta que hubo que ir a buscar por teléfono no es lo mismo que
    // una que el proveedor dio solo. Cuenta como respuesta —la cooperativa sabe
    // qué va a llegar— pero el trabajo lo hizo la comisión, y eso se ve.
    const porComision = confirmadas.filter(o => o.confirmed_source === 'comision').length;
    const porSuCuenta = confirmadas.length - porComision;

    let aTiempo = 0, conLimite = 0, sumaHoras = 0, conHoras = 0;
    confirmadas.forEach(o => {
      const enviado = new Date(o.sent_at);
      const confirmado = new Date(o.confirmed_at);
      if (!isNaN(enviado) && !isNaN(confirmado)) {
        sumaHoras += (confirmado - enviado) / 36e5;
        conHoras++;
      }
      const lim = limitePorPeriodo.get(o.period_id);
      if (lim) {
        conLimite++;
        if (confirmado <= new Date(lim + 'T23:59:59')) aTiempo++;
      }
    });

    // Valor confirmado como disponible: la base contra la que se mide la palabra.
    let valorConfirmado = 0;
    confirmadas.forEach(o => {
      (o.lines || []).forEach(l => {
        const q = l.confirmed_qty != null ? Number(l.confirmed_qty) : (l.available === false ? 0 : Number(l.qty));
        valorConfirmado += Math.round((q || 0) * (Number(l.price) || 0));
      });
    });

    let faltoTrasConfirmar = 0;
    confirmadas.forEach(o => { faltoTrasConfirmar += faltantesPorProv.get(pv.id + '|' + o.period_id) || 0; });

    const pctConfirma = ordenes.length ? Math.round(confirmadas.length / ordenes.length * 100) : null;
    const pctATiempo = conLimite ? Math.round(aTiempo / conLimite * 100) : null;
    const pctPalabra = valorConfirmado > 0
      ? Math.max(0, Math.round((1 - faltoTrasConfirmar / valorConfirmado) * 100))
      : null;

    return {
      id: pv.id,
      name: pv.name,
      is_member: !!pv.is_member,
      enviadas: ordenes.length,
      confirmadas: confirmadas.length,
      porComision,
      porSuCuenta,
      pctAutonomia: confirmadas.length ? Math.round(porSuCuenta / confirmadas.length * 100) : null,
      sinResponder: ordenes.length - confirmadas.length,
      pctConfirma,
      aTiempo,
      conLimite,
      pctATiempo,
      horasPromedio: conHoras ? Math.round(sumaHoras / conHoras * 10) / 10 : null,
      valorConfirmado,
      faltoTrasConfirmar,
      pctPalabra,
    };
  });

  return filas.filter(f => f.enviadas > 0).sort((a, b) => b.enviadas - a.enviadas);
}

// Órdenes cuyo plazo venció sin respuesta.
//
// Decisión de la cooperativa: si nadie contesta, se ASUME QUE TRAE TODO y se
// cobra completo. Insistirle al proveedor por otros medios es trabajo de la
// comisión, no del sistema. Esta función no genera ajustes — solo saca a la luz
// el supuesto, porque un supuesto sobre dinero que nadie ve escrito es el que
// después nadie recuerda haber tomado.
export function ordenesVencidasSinConfirmar(purchaseOrders = [], period, ahora = new Date()) {
  if (!period || !period.date_confirm_until) return [];
  const limite = new Date(period.date_confirm_until + 'T23:59:59');
  if (ahora <= limite) return [];
  return purchaseOrders.filter(o => o.sent_at && o.status !== 'confirmada');
}

// ── Ventana de pedidos ──────────────────────────────────────────────────────
//
// Una sola función decide si las familias pueden pedir y si la orden de compra
// puede salir, porque son la misma pregunta vista desde los dos lados: mientras
// una familia todavía pueda agregar un producto, el consolidado no es final y
// comprarle al proveedor contra él significa comprarle de menos.
//
// Se cierra de dos maneras y ambas valen:
//   · sola, al pasar `date_to` (la fecha que se le anunció a las familias)
//   · a mano, con `orders_closed_at` (la comisión cierra antes o sin fecha puesta)
//
// Nada que ver con cerrar el PERÍODO, que es el corte contable y viene después.
export function estadoPedidos(period, ahora = new Date()) {
  if (!period || !period.active) {
    return { fase: 'sin_periodo', abiertos: false, cerrados: false, texto: 'No hay período activo' };
  }

  const apertura = period.date_from ? new Date(period.date_from + 'T00:00:00') : null;
  const cierre = period.date_to ? new Date(period.date_to + 'T23:59:59') : null;
  const manual = period.orders_closed_at ? new Date(period.orders_closed_at) : null;

  if (manual && !isNaN(manual)) {
    return {
      fase: 'cerrados', abiertos: false, cerrados: true, porFecha: false, cuando: manual,
      texto: 'Pedidos cerrados a mano el ' + manual.toLocaleDateString('es-CL', { day: 'numeric', month: 'long' }),
    };
  }

  if (cierre && ahora > cierre) {
    return {
      fase: 'cerrados', abiertos: false, cerrados: true, porFecha: true, cuando: cierre,
      texto: 'Pedidos cerrados el ' + cierre.toLocaleDateString('es-CL', { day: 'numeric', month: 'long' }),
    };
  }

  if (apertura && ahora < apertura) {
    return {
      fase: 'por_abrir', abiertos: false, cerrados: false, cuando: apertura,
      texto: 'Los pedidos abren el ' + apertura.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }),
    };
  }

  // Sin fecha de cierre no hay nada que espere solo: alguien tiene que cerrar.
  if (!cierre) {
    return {
      fase: 'abiertos', abiertos: true, cerrados: false, sinFecha: true,
      texto: 'Pedidos abiertos, sin fecha de cierre definida',
    };
  }

  // Días de calendario, no horas: faltando 3 días y 12 horas la gente entiende
  // "en 3 días", no "en 4". Math.round absorbe además el cambio de hora.
  const hoy0 = new Date(ahora); hoy0.setHours(0, 0, 0, 0);
  const cierre0 = new Date(period.date_to + 'T00:00:00');
  const dias = Math.round((cierre0 - hoy0) / 864e5);
  return {
    fase: 'abiertos', abiertos: true, cerrados: false, sinFecha: false, cuando: cierre, diasRestantes: dias,
    texto: dias <= 0 ? 'Los pedidos cierran hoy'
      : dias === 1 ? 'Los pedidos cierran mañana'
      : 'Los pedidos cierran en ' + dias + ' días',
  };
}

// ── Qué dijo el proveedor de cada producto ──────────────────────────────────
//
// Traduce las órdenes de compra a un mapa producto → estado, que es como lo
// necesita cualquier pantalla que muestre un pedido. Sin esto, una familia veía
// su "total a pagar" sin enterarse de que el proveedor ya había avisado que no
// traía la mitad.
//
// Estados posibles:
//   sin_orden        · todavía no se le envió orden a ese proveedor
//   esperando        · enviada, dentro del plazo, sin respuesta
//   asumido_completo · venció el plazo sin respuesta → la cooperativa asume que trae todo
//   completo · parcial · no_disponible  · el proveedor (o la comisión) respondió
export function estadoConfirmacionPorProducto(purchaseOrders = [], period = null, ahora = new Date()) {
  const mapa = new Map();
  const limite = period?.date_confirm_until ? new Date(period.date_confirm_until + 'T23:59:59') : null;
  const vencido = limite ? ahora > limite : false;

  (purchaseOrders || [])
    .filter(o => o.sent_at)
    .slice()
    .sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at))  // la más reciente pisa
    .forEach(o => {
      const confirmada = o.status === 'confirmada';
      (o.lines || []).forEach(l => {
        if (l.product_id == null) return;
        let estado;
        if (!confirmada) estado = vencido ? 'asumido_completo' : 'esperando';
        else if (l.available === false || Number(l.confirmed_qty) === 0) estado = 'no_disponible';
        else if (l.confirmed_qty != null && Number(l.confirmed_qty) < Number(l.qty)) estado = 'parcial';
        else estado = 'completo';

        mapa.set(l.product_id, {
          estado,
          proveedor: o.provider_name,
          pedido: Number(l.qty) || 0,
          confirmado: l.confirmed_qty != null ? Number(l.confirmed_qty) : null,
          confirmadoEl: o.confirmed_at || null,
          porComision: o.confirmed_source === 'comision',
          registradoPor: o.confirmed_by_name || null,
          nota: o.provider_note || null,
        });
      });
    });

  return mapa;
}

// Cómo se ve cada estado. En un solo lugar para que la familia y la comisión no
// lean dos colores distintos del mismo hecho.
export const ESTADOS_CONFIRMACION = {
  sin_orden:        { txt: 'Sin pedir al proveedor', corto: 'Sin orden',  color: '#888',    bg: '#f5f5f5', ic: '·' },
  esperando:        { txt: 'Esperando al proveedor', corto: 'Esperando',  color: '#1565c0', bg: '#e3f2fd', ic: '⏳' },
  asumido_completo: { txt: 'Sin respuesta — se asume que llega', corto: 'Se asume', color: '#6a1b9a', bg: '#f3e5f5', ic: '≈' },
  completo:         { txt: 'Confirmado por el proveedor', corto: 'Confirmado', color: '#2e7d32', bg: '#e8f5e9', ic: '✓' },
  parcial:          { txt: 'El proveedor trae solo una parte', corto: 'Parcial', color: '#e65100', bg: '#fff3e0', ic: '≈' },
  no_disponible:    { txt: 'El proveedor no lo trae', corto: 'No lo trae', color: '#c62828', bg: '#ffebee', ic: '✕' },
};

// ── Cargos fijos del período ────────────────────────────────────────────────
//
// El cargo fijo era UN número igual para todas. Ahora son varios, con nombre, y
// una familia puede estar eximida de alguno. Eso convierte "el cargo" en una
// pregunta con parámetro: cuánto le corresponde a ESTA familia.
//
// `construirCargos` devuelve un objeto con todo lo que las pantallas necesitan,
// para que ninguna vuelva a sumar cargos por su cuenta. Antes el cargo viajaba
// como escalar por veinte lugares; si cada uno decidiera aparte si aplicar una
// exención, dos pantallas mostrarían cuentas distintas de la misma familia — que
// es exactamente lo que este archivo existe para impedir.
//
// Degrada solo: si la migración 007 no corrió, `charges` llega vacío y se usa
// `periods.fixed_charge` como un único cargo sin nombre propio. Nadie ve un
// cargo de cero por una tabla que todavía no existe.
export function construirCargos({ charges = null, exemptions = [], period = null } = {}) {
  const legacy = Number(period?.fixed_charge) || 0;
  const faltaMigracion = charges === null;

  // El respaldo solo aplica si la tabla NO existe. Si existe y está vacía, el
  // período no cobra cargos y punto: resucitar `fixed_charge` ahí volvería a
  // cobrar un cargo que alguien acaba de borrar a propósito.
  const lista = faltaMigracion
    ? (legacy !== 0
        ? [{ id: '__legacy__', name: 'Cargo fijo', amount: legacy, note: null, sort: 0, legacy: true }]
        : [])
    : charges.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name));

  // charge_id → Map<family_id, exención>. Un cargo legacy no se puede eximir:
  // no existe como fila, así que no hay a qué colgar la exención.
  const porCargo = new Map();
  exemptions.forEach(e => {
    if (!porCargo.has(e.charge_id)) porCargo.set(e.charge_id, new Map());
    porCargo.get(e.charge_id).set(e.family_id, e);
  });

  // Cuánto se le cobra a una familia sin ninguna exención. Es lo que
  // `fixed_charge` significaba antes, y lo que corresponde mostrar en los
  // totales agregados donde no hay una familia concreta a la vista.
  const total = lista.reduce((s, c) => s + (Number(c.amount) || 0), 0);

  // El desglose de una familia: cada cargo con si le aplica y por qué no.
  const desgloseDe = (familyId) => lista.map(c => {
    const ex = porCargo.get(c.id)?.get(familyId) || null;
    return { ...c, amount: Number(c.amount) || 0, exenta: !!ex, exencion: ex };
  });

  const de = (familyId) => desgloseDe(familyId)
    .filter(c => !c.exenta)
    .reduce((s, c) => s + c.amount, 0);

  const exencionesDe = (familyId) => desgloseDe(familyId).filter(c => c.exenta);

  return {
    lista,
    total,
    de,
    desgloseDe,
    exencionesDe,
    // Cuántas familias están eximidas de este cargo, para la vista de cargos.
    exentasDe: (chargeId) => porCargo.get(chargeId)?.size || 0,
    exenciones: exemptions,
    faltaMigracion,
    editable: !faltaMigracion,

    // `periods.fixed_charge` lo mantiene sincronizado un trigger, así que si no
    // coincide con la suma de los cargos es que algo se escribió a medias —el
    // caso concreto es una copia de cargos fallida al crear el período, que deja
    // el total puesto y ninguna fila. Vale la pena decirlo en voz alta: la
    // alternativa es cobrar $0 de cargos sin que nadie se entere.
    descalzado: (!faltaMigracion && legacy !== total) ? { columna: legacy, cargos: total } : null,
  };
}

// ── Lo que los proveedores dijeron y todavía nadie aplicó ───────────────────
//
// `derivarDeConfirmacion` traduce UNA orden de compra. Esto recorre todas las
// del período, descarta lo que ya está registrado y devuelve lo que sigue
// pendiente, indexado por familia.
//
// Vive acá y no en la pestaña de Faltantes porque Retiros necesita la misma
// respuesta: marcar un retiro sin haber aplicado lo que el proveedor avisó que
// no traía es cobrarle a la familia un producto que nunca existió. Cuando el
// cálculo vivía dentro de un componente, la otra pantalla no podía verlo.
export function pendientesDeConfirmacion({ ordenes = [], sealedOrders = [], period = null, productos = [], ajustes = [] }) {
  if (!period) return { pendientes: [], aRepartir: [], porFamilia: new Map() };

  const automaticos = [];
  const reparto = [];
  ordenes.filter(o => o.status === 'confirmada').forEach(orden => {
    const d = derivarDeConfirmacion({ orden, sealedOrders, period, productos });
    automaticos.push(...d.automaticos);
    reparto.push(...d.aRepartir);
  });

  // Lo ya registrado no se vuelve a proponer. El índice único de la migración
  // 004 lo rechazaría igual, pero proponerlo sería ofrecerle a la comisión un
  // botón que va a fallar.
  const yaHay = new Set(
    ajustes.filter(a => a.type === 'no_confirmado').map(a => a.family_id + '|' + a.product_id)
  );
  const pendientes = automaticos.filter(a => !yaHay.has(a.family_id + '|' + a.product_id));

  // Indexado por familia: es como lo lee Retiros, familia por familia en la
  // puerta de la bodega.
  const porFamilia = new Map();
  const anota = (familyId, clave, valor) => {
    if (!porFamilia.has(familyId)) porFamilia.set(familyId, { noTrae: [], parcial: [] });
    porFamilia.get(familyId)[clave].push(valor);
  };
  pendientes.forEach(p => anota(p.family_id, 'noTrae', p));
  reparto.forEach(r => r.familias.forEach(f => anota(f.family_id, 'parcial', { ...r, suQty: f.qty })));

  return { pendientes, aRepartir: reparto, porFamilia };
}

// ¿Se puede marcar el retiro de esta familia?
//
// Bloquea solo el caso inequívoco: el proveedor dijo que NO LO TRAE, nadie lo
// va a recibir, y el descuento se aplica con un clic desde la misma fila. No
// hay decisión que tomar, solo un paso que se saltó.
//
// Una entrega PARCIAL no bloquea, aunque también esté sin resolver: quién se
// queda sin su parte lo decide la cooperativa, y esa conversación no puede
// ocurrir con la fila de familias esperando en la puerta. Se advierte y se
// deja pasar — el retiro es un hecho físico, y negarlo en la pantalla no
// impide que la caja se entregue.
export function puedeMarcarRetiro(pendientesFam) {
  const p = pendientesFam || { noTrae: [], parcial: [] };
  if (p.noTrae.length > 0) {
    return {
      puede: false,
      motivo: 'no_confirmados_sin_aplicar',
      noTrae: p.noTrae,
      parcial: p.parcial,
      texto: p.noTrae.length === 1
        ? 'El proveedor avisó que no trae 1 producto de este pedido y el descuento todavía no se aplicó.'
        : 'El proveedor avisó que no trae ' + p.noTrae.length + ' productos de este pedido y los descuentos todavía no se aplicaron.',
    };
  }
  if (p.parcial.length > 0) {
    return {
      puede: true, advertencia: true, motivo: 'parciales_sin_repartir',
      noTrae: [], parcial: p.parcial,
      texto: 'Hay ' + p.parcial.length + ' producto' + (p.parcial.length === 1 ? '' : 's') +
        ' del que el proveedor trae solo una parte. Repartir el faltante es decisión de la cooperativa: regístralo en Faltantes y Extras cuando se resuelva.',
    };
  }
  return { puede: true, advertencia: false, motivo: 'ok', noTrae: [], parcial: [] };
}

// ── Bajas de bodega: mermas, regalos y sobrantes ────────────────────────────
//
// Producto que salió de bodega sin venderse. El motivo no es una etiqueta
// decorativa: decide si la salida cuesta plata y si aparece en el flujo de caja.
//
// Mezclar merma con regalo hace que la cooperativa parezca descuidada cuando en
// realidad fue generosa, y al revés: esconde una merma real detrás de una
// decisión. Son dos conversaciones distintas en la asamblea.
export const MOTIVOS_BAJA = {
  merma: {
    label: 'Merma',
    descripcion: 'Se echó a perder, se rompió o se venció',
    ayuda: 'Pérdida involuntaria. Es lo que hay que medir para saber si conviene comprar menos.',
    cuestaPlata: true,
    color: '#c62828', bg: '#ffebee', ic: '🥀',
  },
  regalo: {
    label: 'Regalo o donación',
    descripcion: 'Se donó o se regaló',
    ayuda: 'Pérdida deliberada, no un descuido. Se cuenta aparte de la merma a propósito.',
    cuestaPlata: true,
    color: '#6a1b9a', bg: '#f3e5f5', ic: '🎁',
  },
  consumo: {
    label: 'Consumo de la cooperativa',
    descripcion: 'Se usó en una actividad, capacitación u once',
    ayuda: 'Sale del stock y es gasto, pero es gasto con propósito.',
    cuestaPlata: true,
    color: '#e65100', bg: '#fff3e0', ic: '🍵',
  },
  devolucion: {
    label: 'Devolución al proveedor',
    descripcion: 'Se le devolvió al proveedor',
    ayuda: 'No es pérdida: la plata vuelve o nunca se pagó. No genera egreso.',
    cuestaPlata: false,
    color: '#1565c0', bg: '#e3f2fd', ic: '↩',
  },
  ajuste: {
    label: 'Ajuste de inventario',
    descripcion: 'La cuenta física no cuadraba con el sistema',
    ayuda: 'No es un hecho del mundo, es una corrección de registro. Se anota para que el descalce quede visible en vez de desaparecer.',
    cuestaPlata: false,
    color: '#455a64', bg: '#eceff1', ic: '⚖',
  },
};

export const bajaCuestaPlata = (reason) => !!(MOTIVOS_BAJA[reason] && MOTIVOS_BAJA[reason].cuestaPlata);

// Cuánto queda disponible de un ítem de bodega.
//
// Tres cosas lo bajan y hay que restar las tres: lo asignado a familias, lo que
// se dio de baja, y nada más. Antes solo se restaban las asignaciones, así que
// un producto que se echó a perder seguía apareciendo como disponible para
// reservar — y alguien lo iba a reservar.
export function disponibleEnBodega({ item, asignaciones = [], bajas = [] }) {
  if (!item) return 0;
  const total = Number(item.quantity) || 0;
  const asignado = asignaciones
    .filter(a => String(a.bodega_id) === String(item.id))
    .reduce((s, a) => s + (Number(a.quantity) || 0), 0);
  const dadoDeBaja = bajas
    .filter(b => String(b.bodega_id) === String(item.id))
    .reduce((s, b) => s + (Number(b.quantity) || 0), 0);
  return Math.max(0, total - asignado - dadoDeBaja);
}

// Resumen de las bajas de un período, por motivo. Lo usa el flujo de caja y el
// reporte de bodega.
export function resumenBajas(bajas = []) {
  const porMotivo = {};
  Object.keys(MOTIVOS_BAJA).forEach(m => { porMotivo[m] = { cantidad: 0, monto: 0, n: 0 }; });

  let perdida = 0, sinCosto = 0;
  bajas.forEach(b => {
    const m = porMotivo[b.reason];
    if (!m) return;
    m.n++;
    m.cantidad += Number(b.quantity) || 0;
    m.monto += Number(b.amount) || 0;
    if (bajaCuestaPlata(b.reason)) perdida += Number(b.amount) || 0;
    else sinCosto += Number(b.amount) || 0;
  });

  return { porMotivo, perdida, sinCosto, total: perdida + sinCosto, n: bajas.length };
}
