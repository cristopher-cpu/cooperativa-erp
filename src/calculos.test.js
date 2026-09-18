// Pruebas de la aritmética del período.
//
// Todo lo que decide cuánta plata debe una familia vive en `calculos.js` en
// funciones puras, así que se puede probar sin navegador y sin base. Vale la
// pena probarlo justamente porque es plata: un error acá no se ve en pantalla,
// se ve cuando alguien reclama que le cobraron mal.
//
// Lo que NO se prueba acá son las políticas RLS de la migración 010, que solo se
// pueden verificar contra un Postgres de verdad.

import {
  construirCargos, cuentaDeFamilia, puedeMarcarRetiro, pendientesDeConfirmacion,
  resumenBajas, disponibleEnBodega, MOTIVOS_BAJA, montoAjuste, estadoPedidos,
  ventanaAjustes, puedeBorrarAjuste,
} from './calculos';

// ─── Cargos fijos ────────────────────────────────────────────────────────────

describe('construirCargos: degradación sin la migración 007', () => {
  const sinMig = (fixed) => construirCargos({ charges: null, exemptions: [], period: { fixed_charge: fixed } });

  it('usa periods.fixed_charge como respaldo y lo marca', () => {
    const c = sinMig(4000);
    expect(c.faltaMigracion).toBe(true);
    expect(c.total).toBe(4000);
    expect(c.de('cualquiera')).toBe(4000);
    expect(c.lista).toHaveLength(1);
    expect(c.lista[0].legacy).toBe(true);
    expect(c.editable).toBe(false);
  });

  it('un fixed_charge de cero no inventa un cargo', () => {
    expect(sinMig(0).lista).toHaveLength(0);
  });
});

describe('construirCargos: con la migración corrida', () => {
  const charges = [
    { id: 'c2', name: 'Bodega', amount: 1000, sort: 1 },
    { id: 'c1', name: 'Cuota', amount: 4000, sort: 0 },
  ];
  const exemptions = [{ id: 'e1', charge_id: 'c2', family_id: 'f2', reason: 'acuerdo de asamblea' }];
  const cargos = construirCargos({ charges, exemptions, period: { fixed_charge: 5000 } });

  it('ordena por `sort`, no por el orden en que llegaron', () => {
    expect(cargos.lista.map(c => c.name)).toEqual(['Cuota', 'Bodega']);
  });

  it('el total es la suma SIN exenciones', () => {
    expect(cargos.total).toBe(5000);
  });

  it('cada familia paga lo suyo', () => {
    expect(cargos.de('f1')).toBe(5000);
    expect(cargos.de('f2')).toBe(4000);
  });

  it('el desglose dice de qué está eximida y por qué', () => {
    const d = cargos.desgloseDe('f2');
    expect(d.find(c => c.id === 'c2').exenta).toBe(true);
    expect(d.find(c => c.id === 'c1').exenta).toBe(false);
    expect(cargos.exencionesDe('f2')[0].exencion.reason).toBe('acuerdo de asamblea');
    expect(cargos.exentasDe('c2')).toBe(1);
  });

  // Este es el caso que importa: si la tabla existe y está vacía, el período no
  // cobra nada. Resucitar `fixed_charge` volvería a cobrar un cargo que alguien
  // acaba de borrar a propósito.
  it('tabla vacía significa que no se cobra, y avisa el descalce', () => {
    const v = construirCargos({ charges: [], exemptions: [], period: { fixed_charge: 4000 } });
    expect(v.total).toBe(0);
    expect(v.descalzado).toEqual({ columna: 4000, cargos: 0 });
  });

  it('cuando cuadra, no avisa nada', () => {
    expect(cargos.descalzado).toBeNull();
  });
});

describe('cuentaDeFamilia', () => {
  it('la exención llega hasta lo que se descuenta al cerrar', () => {
    const cargos = construirCargos({
      charges: [{ id: 'c1', name: 'Cuota', amount: 4000, sort: 0 }, { id: 'c2', name: 'Bodega', amount: 1000, sort: 1 }],
      exemptions: [{ charge_id: 'c2', family_id: 'f2' }],
      period: { fixed_charge: 5000 },
    });
    const ord = { total: 10000 };
    expect(cuentaDeFamilia({ ord, cargo: cargos.de('f1') }).cargoAlCerrar).toBe(15000);
    expect(cuentaDeFamilia({ ord, cargo: cargos.de('f2') }).cargoAlCerrar).toBe(14000);
  });

  it('sin pedido no hay cargo fijo', () => {
    expect(cuentaDeFamilia({ ord: null, cargo: 5000 }).cargo).toBe(0);
  });

  it('los ajustes que superan el pedido dejan saldo a favor, no un cobro negativo', () => {
    const c = cuentaDeFamilia({
      ord: { total: 1000 }, cargo: 0,
      ajustes: [{ type: 'faltante', amount: -3000 }],
    });
    expect(c.delPeriodo).toBe(0);
    expect(c.quedaAFavor).toBe(2000);
  });

  it('un extra ya pagado no se arrastra al saldo', () => {
    const conPagar = cuentaDeFamilia({ ord: { total: 1000 }, ajustes: [{ type: 'extra', amount: 500, paid: false }] });
    const pagado = cuentaDeFamilia({ ord: { total: 1000 }, ajustes: [{ type: 'extra', amount: 500, paid: true }] });
    expect(conPagar.delPeriodo).toBe(1500);
    expect(pagado.delPeriodo).toBe(1000);
  });

  it('el saldo a favor anterior baja lo que hay que pagar', () => {
    const c = cuentaDeFamilia({ ord: { total: 10000 }, cargo: 0, saldo: 3000 });
    expect(c.aPagar).toBe(7000);
  });
});

describe('montoAjuste: convención de signo', () => {
  it('lo que no llega hace deber MENOS', () => {
    expect(montoAjuste('no_confirmado', 2, 1000)).toBe(-2000);
    expect(montoAjuste('faltante', 2, 1000)).toBe(-2000);
  });
  it('lo que se lleva de más hace deber MÁS', () => {
    expect(montoAjuste('extra', 2, 1000)).toBe(2000);
  });
  it('el signo lo pone el tipo, no quien llama', () => {
    expect(montoAjuste('faltante', -2, -1000)).toBe(-2000);
  });
});

// ─── Retiro ──────────────────────────────────────────────────────────────────

describe('puedeMarcarRetiro', () => {
  it('sin pendientes, se puede', () => {
    expect(puedeMarcarRetiro(undefined).puede).toBe(true);
    expect(puedeMarcarRetiro({ noTrae: [], parcial: [] }).puede).toBe(true);
  });

  // El caso inequívoco: nadie va a recibir ese producto y el descuento se
  // aplica con un clic. Dejar marcar el retiro es cobrarle a la familia algo
  // que nunca existió.
  it('BLOQUEA cuando el proveedor dijo "no lo trae" y no se aplicó', () => {
    const r = puedeMarcarRetiro({ noTrae: [{ product_name: 'Arroz' }], parcial: [] });
    expect(r.puede).toBe(false);
    expect(r.motivo).toBe('no_confirmados_sin_aplicar');
  });

  // Repartir quién se queda sin su parte es una decisión de la cooperativa, y
  // esa conversación no puede ocurrir con la fila de familias en la puerta.
  it('ADVIERTE pero deja pasar una entrega parcial', () => {
    const r = puedeMarcarRetiro({ noTrae: [], parcial: [{ product_name: 'Papas' }] });
    expect(r.puede).toBe(true);
    expect(r.advertencia).toBe(true);
  });

  it('si hay de los dos, manda el bloqueo', () => {
    expect(puedeMarcarRetiro({ noTrae: [{}], parcial: [{}] }).puede).toBe(false);
  });
});

describe('pendientesDeConfirmacion', () => {
  const period = { id: 'P1' };
  const sealedOrders = [
    { id: 'o1', family_id: 'f1', items: JSON.stringify([{ id: 1, qty: 2 }, { id: 2, qty: 5 }]) },
    { id: 'o2', family_id: 'f2', items: JSON.stringify([{ id: 1, qty: 3 }]) },
  ];
  const ordenes = [{
    status: 'confirmada', provider_name: 'El Granero',
    lines: [
      { product_id: 1, name: 'Arroz', qty: 5, available: false, price: 2000 },
      { product_id: 2, name: 'Papas', qty: 5, confirmed_qty: 3, price: 900 },
    ],
  }];

  it('"no lo trae" genera un faltante por cada familia que lo pidió', () => {
    const p = pendientesDeConfirmacion({ ordenes, sealedOrders, period, ajustes: [] });
    expect(p.pendientes).toHaveLength(2);
    expect(p.pendientes.map(x => x.family_id).sort()).toEqual(['f1', 'f2']);
    expect(p.pendientes.every(x => x.amount < 0)).toBe(true);
  });

  it('la entrega parcial NO se reparte sola', () => {
    const p = pendientesDeConfirmacion({ ordenes, sealedOrders, period, ajustes: [] });
    expect(p.aRepartir).toHaveLength(1);
    expect(p.aRepartir[0]).toMatchObject({ pedido: 5, llegan: 3, faltan: 2 });
  });

  it('lo indexa por familia, que es como lo lee Retiros', () => {
    const p = pendientesDeConfirmacion({ ordenes, sealedOrders, period, ajustes: [] });
    expect(p.porFamilia.get('f1').noTrae).toHaveLength(1);
    expect(p.porFamilia.get('f1').parcial).toHaveLength(1);
    expect(p.porFamilia.get('f2').parcial).toHaveLength(0);
  });

  it('no vuelve a proponer lo ya registrado', () => {
    const p = pendientesDeConfirmacion({
      ordenes, sealedOrders, period,
      ajustes: [{ type: 'no_confirmado', family_id: 'f1', product_id: 1 }],
    });
    expect(p.pendientes).toHaveLength(1);
    expect(p.pendientes[0].family_id).toBe('f2');
  });

  it('una orden sin confirmar no genera nada', () => {
    const p = pendientesDeConfirmacion({
      ordenes: [{ ...ordenes[0], status: 'enviada' }], sealedOrders, period, ajustes: [],
    });
    expect(p.pendientes).toHaveLength(0);
  });
});

// ─── Bodega ──────────────────────────────────────────────────────────────────

describe('resumenBajas', () => {
  const bajas = [
    { reason: 'merma', quantity: 8, amount: 7200 },
    { reason: 'regalo', quantity: 2, amount: 1800 },
    { reason: 'devolucion', quantity: 1, amount: 900 },
    { reason: 'ajuste', quantity: 1, amount: 900 },
  ];

  // Sumar las devoluciones daría una pérdida inflada: esa plata vuelve o nunca
  // se pagó.
  it('la pérdida real excluye devoluciones y ajustes', () => {
    const r = resumenBajas(bajas);
    expect(r.perdida).toBe(9000);
    expect(r.sinCosto).toBe(1800);
    expect(r.total).toBe(10800);
  });

  it('un regalo es pérdida; una devolución no', () => {
    expect(MOTIVOS_BAJA.regalo.cuestaPlata).toBe(true);
    expect(MOTIVOS_BAJA.merma.cuestaPlata).toBe(true);
    expect(MOTIVOS_BAJA.consumo.cuestaPlata).toBe(true);
    expect(MOTIVOS_BAJA.devolucion.cuestaPlata).toBe(false);
    expect(MOTIVOS_BAJA.ajuste.cuestaPlata).toBe(false);
  });
});

describe('disponibleEnBodega', () => {
  const item = { id: 'b1', quantity: 50 };

  // El bug que esto arregla: un producto que se echó a perder seguía
  // apareciendo como disponible, y alguien lo iba a reservar.
  it('resta lo asignado Y lo dado de baja', () => {
    expect(disponibleEnBodega({
      item,
      asignaciones: [{ bodega_id: 'b1', quantity: 10 }, { bodega_id: 'b2', quantity: 99 }],
      bajas: [{ bodega_id: 'b1', quantity: 12 }],
    })).toBe(28);
  });

  it('nunca devuelve negativo', () => {
    expect(disponibleEnBodega({
      item: { id: 'b1', quantity: 5 },
      asignaciones: [{ bodega_id: 'b1', quantity: 99 }],
    })).toBe(0);
  });

  it('sin ítem, cero', () => {
    expect(disponibleEnBodega({ item: null })).toBe(0);
  });
});

// ─── Ventanas de tiempo ──────────────────────────────────────────────────────

describe('estadoPedidos', () => {
  const base = { active: true, date_from: '2026-09-01', date_to: '2026-09-10' };

  it('el cierre a mano gana sobre la fecha', () => {
    const e = estadoPedidos({ ...base, orders_closed_at: '2026-09-05T12:00:00Z' }, new Date('2026-09-06'));
    expect(e.cerrados).toBe(true);
    expect(e.porFecha).toBe(false);
  });

  it('se cierra solo al pasar date_to', () => {
    expect(estadoPedidos(base, new Date('2026-09-11T12:00:00')).cerrados).toBe(true);
  });

  it('abierto dentro de la ventana', () => {
    const e = estadoPedidos(base, new Date('2026-09-05T12:00:00'));
    expect(e.abiertos).toBe(true);
    expect(e.diasRestantes).toBe(5);
  });

  it('antes de abrir no se puede pedir', () => {
    expect(estadoPedidos(base, new Date('2026-08-30T12:00:00')).fase).toBe('por_abrir');
  });

  // Sin fecha de cierre nadie espera solo: alguien tiene que cerrar a mano.
  it('sin date_to queda abierto y lo dice', () => {
    const e = estadoPedidos({ active: true, date_from: '2026-09-01' }, new Date('2026-09-20'));
    expect(e.abiertos).toBe(true);
    expect(e.sinFecha).toBe(true);
  });

  it('sin período activo no hay ventana', () => {
    expect(estadoPedidos(null).fase).toBe('sin_periodo');
    expect(estadoPedidos({ active: false }).fase).toBe('sin_periodo');
  });
});

describe('ventanaAjustes', () => {
  const period = { date_delivery: '2026-09-15', date_adjust_until: '2026-09-20' };

  it('antes del retiro no hay nada que reclamar', () => {
    const v = ventanaAjustes(period, { retired: false }, new Date('2026-09-10'));
    expect(v.abierta).toBe(false);
    expect(v.motivo).toBe('antes_entrega');
  });

  it('abierta entre el retiro y el límite', () => {
    expect(ventanaAjustes(period, { retired: true }, new Date('2026-09-16')).abierta).toBe(true);
  });

  it('cerrada después del límite', () => {
    const v = ventanaAjustes(period, { retired: true }, new Date('2026-09-25'));
    expect(v.abierta).toBe(false);
    expect(v.motivo).toBe('cerrada');
  });

  // Una configuración incompleta no debe dejar a nadie sin poder reclamar.
  it('sin límite configurado no bloquea', () => {
    expect(ventanaAjustes({ date_delivery: '2026-09-15' }, { retired: true }, new Date('2027-01-01')).abierta).toBe(true);
  });

  it('sin pedido no hay ventana', () => {
    expect(ventanaAjustes(period, null).motivo).toBe('sin_pedido');
  });
});

describe('puedeBorrarAjuste', () => {
  const abierta = { abierta: true };

  it('la familia borra solo lo que ella registró', () => {
    expect(puedeBorrarAjuste({ source: 'familia' }, abierta)).toBe(true);
    expect(puedeBorrarAjuste({ source: 'comision' }, abierta)).toBe(false);
    expect(puedeBorrarAjuste({ source: 'proveedor' }, abierta)).toBe(false);
  });

  it('y solo mientras la ventana siga abierta', () => {
    expect(puedeBorrarAjuste({ source: 'familia' }, { abierta: false })).toBe(false);
  });
});
