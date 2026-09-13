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
