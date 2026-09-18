// Pruebas del normalizador de formatos de venta.
//
// Se prueban LAS 24 VARIANTES REALES del maestro, no ejemplos inventados. Si
// alguien agrega un sinónimo y rompe una, esto lo dice.

import { interpretarFormato, formatoCanonico, enBase, pesoTotal, formatoDe } from './unidades';

// Las 24 variantes que existen en la base, con su frecuencia real.
const REALES = [
  ['500 gr', 500, 'gr', 18], ['Kg', 1, 'kg', 17], ['un', 1, 'un', 12],
  ['100 gr', 100, 'gr', 9], ['1 Kg', 1, 'kg', 4], ['5 lt', 5, 'lt', 2],
  ['1 lt', 1, 'lt', 2], ['250 gr', 250, 'gr', 2], ['25 gr', 25, 'gr', 1],
  ['330 ml', 330, 'ml', 1], ['270 ml', 270, 'ml', 1], ['200 gr', 200, 'gr', 1],
  ['150 gr', 150, 'gr', 1], ['120 gr', 120, 'gr', 1], ['50 gr', 50, 'gr', 1],
  ['3 lt', 3, 'lt', 1], ['200 un', 200, 'un', 1], ['24 rollos', 24, 'un', 1],
  ['Caja 3 un', 3, 'un', 1], ['500 cc', 500, 'ml', 1], ['350 gr', 350, 'gr', 1],
  ['60 ml', 60, 'ml', 1], ['30 ml', 30, 'ml', 1], ['Kilo', 1, 'kg', 1],
];

describe('interpretarFormato: las 24 variantes reales del maestro', () => {
  it.each(REALES)('%s → %s %s', (texto, qty, unit) => {
    const r = interpretarFormato(texto);
    expect(r.qty).toBe(qty);
    expect(r.unit).toBe(unit);
  });

  it('ninguna de las 24 queda en confianza baja', () => {
    const bajas = REALES.filter(([t]) => interpretarFormato(t).confianza === 'baja');
    expect(bajas).toEqual([]);
  });

  // Los tres sin número. Se asume 1 porque es lo que el maestro ya daba por
  // supuesto, pero se marca para que alguien confirme: si "Kg" fuera medio
  // kilo, el precio por kilo saldría al doble.
  it('las tres sin número quedan en confianza media, no alta', () => {
    ['Kg', 'Kilo', 'un'].forEach(t => {
      expect(interpretarFormato(t).confianza).toBe('media');
    });
  });
});

describe('interpretarFormato: casos límite', () => {
  it('sin acentos y sin importar mayúsculas', () => {
    expect(interpretarFormato('KILO')).toMatchObject({ qty: 1, unit: 'kg' });
  });

  it('decimales con coma o con punto', () => {
    expect(interpretarFormato('1,5 kg')).toMatchObject({ qty: 1.5, unit: 'kg' });
    expect(interpretarFormato('2.5 lt')).toMatchObject({ qty: 2.5, unit: 'lt' });
  });

  it('cc es ml', () => {
    expect(interpretarFormato('500 cc').unit).toBe('ml');
  });

  it('una docena son 12 unidades', () => {
    expect(interpretarFormato('Docena')).toMatchObject({ qty: 12, unit: 'un', confianza: 'alta' });
  });

  it('los envases se cuentan: su unidad es `un`', () => {
    ['24 rollos', 'Caja 3 un', '6 frascos', '2 bandejas'].forEach(t => {
      expect(interpretarFormato(t).unit).toBe('un');
    });
  });

  // Un "500" suelto podrían ser 500 gramos de harina o 500 unidades de bolsa, y
  // equivocarse cambia el precio por kilo en tres órdenes de magnitud.
  it('un número sin unidad NO se adivina', () => {
    const r = interpretarFormato('500');
    expect(r.unit).toBeNull();
    expect(r.confianza).toBe('baja');
  });

  // Este es el caso que la primera versión resolvía mal: devolvía "3 un" con
  // toda la seguridad del mundo, tirando el peso en silencio. Una respuesta
  // confiada y equivocada es peor que no responder, porque nadie la va a ir a
  // revisar.
  it('un formato compuesto pide revisión humana', () => {
    const r = interpretarFormato('3 bandejas de 500 gr');
    expect(r.confianza).toBe('baja');
    expect(r.motivo).toMatch(/compuesto/);
  });

  it('vacío o ilegible no revienta', () => {
    ['', '   ', null, undefined, 'xyz'].forEach(t => {
      const r = interpretarFormato(t);
      expect(r.confianza).toBe('baja');
      expect(r.qty).toBeNull();
    });
  });
});

describe('formatoCanonico', () => {
  // El objetivo: que el proveedor no reciba "Kg", "1 Kg" y "Kilo" como si
  // fueran tres formatos distintos del mismo producto.
  it('las tres formas de un kilo se leen igual', () => {
    ['Kg', '1 Kg', 'Kilo'].forEach(t => {
      const r = interpretarFormato(t);
      expect(formatoCanonico(r.qty, r.unit)).toBe('1 kg');
    });
  });

  it('los decimales se escriben con coma', () => {
    expect(formatoCanonico(1.5, 'kg')).toBe('1,5 kg');
  });

  it('sin datos devuelve null, no un texto a medias', () => {
    expect(formatoCanonico(null, 'kg')).toBeNull();
    expect(formatoCanonico(1, null)).toBeNull();
    expect(formatoCanonico(1, 'inventada')).toBeNull();
  });
});

describe('enBase y pesoTotal', () => {
  it('convierte a gramos y a mililitros', () => {
    expect(enBase(500, 'gr', 2)).toMatchObject({ valor: 1000, base: 'gr' });
    expect(enBase(1, 'kg', 3)).toMatchObject({ valor: 3000, base: 'gr' });
    expect(enBase(1, 'lt', 2)).toMatchObject({ valor: 2000, base: 'ml' });
  });

  // Sumar unidades a gramos daría un número que parece válido y no significa
  // nada.
  it('lo que se cuenta no se pesa', () => {
    expect(enBase(1, 'un', 5)).toBeNull();
  });

  it('suma el peso y dice qué dejó fuera', () => {
    const r = pesoTotal([
      { format_qty: 500, format_unit: 'gr', cantidad: 18 },
      { format_qty: 1, format_unit: 'kg', cantidad: 17 },
      { format_qty: 5, format_unit: 'lt', cantidad: 2 },
      { format_qty: 1, format_unit: 'un', cantidad: 12 },
      { format_qty: null, format_unit: null, cantidad: 3 },
    ]);
    expect(r.gr).toBe(26000);
    expect(r.kg).toBe(26);
    expect(r.lt).toBe(10);
    expect(r.sinPeso).toBe(1);     // la línea en unidades
    expect(r.sinFormato).toBe(1);  // la que no está normalizada
  });
});

describe('formatoDe', () => {
  it('prefiere las columnas de la migración 008', () => {
    expect(formatoDe({ unit: 'lo que sea', format_qty: 250, format_unit: 'gr' }))
      .toMatchObject({ qty: 250, unit: 'gr', confianza: 'alta' });
  });

  it('si no están, interpreta el texto', () => {
    expect(formatoDe({ unit: '500 gr' })).toMatchObject({ qty: 500, unit: 'gr' });
  });

  it('sin producto no revienta', () => {
    expect(formatoDe(null).qty).toBeNull();
  });
});
