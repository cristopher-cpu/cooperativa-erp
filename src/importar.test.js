// Pruebas del importador de precios.
//
// Es la operación más peligrosa del sistema: un error se multiplica por ochenta
// y dos y se descubre cuando las familias ya pidieron. Lo que más se prueba acá
// es que NO adivine.

import {
  parsearPrecio, detectarSeparador, planDeImportacion, emparejar, cambiosSospechosos,
} from './importar';

// ─── Precios en formato chileno ──────────────────────────────────────────────
//
// `$1.234` son mil doscientos treinta y cuatro, no uno con veintitrés. Leerlo
// mil veces más chico y cobrarlo es el error más caro posible acá.

describe('parsearPrecio', () => {
  it.each([
    ['$1.234', 1234],
    ['1.234', 1234],
    ['1234', 1234],
    ['1,234', 1234],          // en una lista chilena, mil doscientos treinta y cuatro
    ['$ 2.400', 2400],
    ['12.345.678', 12345678], // varios puntos: todos son de miles
    ['  $4.000  ', 4000],
    ['4000 CLP', 4000],
    ['0', 0],
  ])('%s → %s', (texto, esperado) => {
    expect(parsearPrecio(texto)).toBe(esperado);
  });

  it('con punto Y coma, el último es el decimal', () => {
    expect(parsearPrecio('1.234,50')).toBe(1235);
    expect(parsearPrecio('1,234.50')).toBe(1235);
  });

  it('lo que no es un precio devuelve null, no cero', () => {
    ['', '   ', 'gratis', '$', null, undefined, '-100'].forEach(t => {
      expect(parsearPrecio(t)).toBeNull();
    });
  });

  // Un cero es una afirmación —es gratis— y un null dice que no se pudo leer.
  // Confundirlos haría que una fila ilegible se aplicara como precio cero.
  it('cero y "no se pudo leer" son distintos', () => {
    expect(parsearPrecio('0')).toBe(0);
    expect(parsearPrecio('abc')).toBeNull();
  });
});

describe('detectarSeparador', () => {
  it('reconoce el tabulador que deja Excel al copiar', () => {
    expect(detectarSeparador('Producto\tPrecio\nArroz\t1500')).toBe('\t');
  });

  it('reconoce el punto y coma del CSV chileno', () => {
    expect(detectarSeparador('Producto;Precio\nArroz;1.500')).toBe(';');
  });

  it('reconoce la coma', () => {
    expect(detectarSeparador('Arroz,1500\nAzucar,2000')).toBe(',');
  });

  it('sin separadores no revienta', () => {
    expect(detectarSeparador('')).toBe('\t');
    expect(detectarSeparador('una sola cosa')).toBe('\t');
  });
});

// ─── Emparejar con el maestro ────────────────────────────────────────────────

describe('emparejar', () => {
  const productos = [
    { id: 1, name: 'Arroz grano largo', price: 2000, provider_id: 'p1' },
    { id: 2, name: 'Arroz integral', price: 2500, provider_id: 'p2' },
    { id: 3, name: 'Lentejas', price: 1890, provider_id: 'p1' },
  ];

  it('empareja exacto sin importar mayúsculas ni acentos', () => {
    expect(emparejar('ARROZ INTEGRAL', productos)).toMatchObject({ tipo: 'exacto' });
  });

  it('empareja por contención cuando es único', () => {
    expect(emparejar('Lentejas 500 gr', productos)).toMatchObject({ tipo: 'sugerido', por: 'contención' });
  });

  // Este es el corazón del diseño: "Arroz" empareja con dos productos, y
  // adivinar es decidir a cuál se le cambia el precio. Esa apuesta la hace una
  // persona, no un puntaje.
  it('NUNCA elige entre varios candidatos', () => {
    const m = emparejar('Arroz', productos);
    expect(m.tipo).toBe('ambiguo');
    expect(m.candidatos).toHaveLength(2);
  });

  it('filtrar por proveedor deshace el empate', () => {
    expect(emparejar('Arroz', productos, 'p1')).toMatchObject({ tipo: 'sugerido' });
  });

  it('lo que no está lo dice', () => {
    expect(emparejar('Quinoa', productos)).toMatchObject({ tipo: 'sin_match' });
    expect(emparejar('', productos)).toMatchObject({ tipo: 'sin_match' });
  });
});

// ─── El plan completo ────────────────────────────────────────────────────────

describe('planDeImportacion', () => {
  const productos = [
    { id: 1, name: 'Arroz integral', price: 2500 },
    { id: 2, name: 'Lentejas', price: 1890 },
    { id: 3, name: 'Aceite de oliva', price: 8000 },
  ];

  it('reconoce el encabezado y qué columna es cada cosa', () => {
    const plan = planDeImportacion({
      texto: 'Producto\tFormato\tPrecio\nArroz integral\t1 kg\t$2.900',
      productos,
    });
    expect(plan.columnas).toMatchObject({ nombre: 0, formato: 1, precio: 2, tieneEncabezado: true });
    expect(plan.totalFilas).toBe(1);
  });

  it('sin encabezado, adivina por el contenido', () => {
    const plan = planDeImportacion({ texto: 'Arroz integral\t2900\nLentejas\t2000', productos });
    expect(plan.columnas.tieneEncabezado).toBe(false);
    expect(plan.lineas).toHaveLength(2);
    expect(plan.lineas[0].precio).toBe(2900);
  });

  it('clasifica cada fila', () => {
    const plan = planDeImportacion({
      texto: [
        'Producto\tPrecio',
        'Arroz integral\t2900',       // cambia
        'Lentejas\t1890',             // igual
        'Producto inexistente\t900',  // sin match
        'Aceite de oliva\tno es precio', // ilegible
      ].join('\n'),
      productos,
    });
    const estados = plan.lineas.map(l => l.estado);
    expect(estados).toEqual(['cambia', 'igual', 'sin_match', 'invalida']);
    expect(plan.lineas[0].precioAnterior).toBe(2500);
  });

  it('respeta las comillas de un CSV', () => {
    const plan = planDeImportacion({
      texto: '"Arroz, integral",2900',
      productos: [{ id: 1, name: 'Arroz, integral', price: 2500 }],
    });
    expect(plan.lineas[0].nombreTexto).toBe('Arroz, integral');
    expect(plan.lineas[0].precio).toBe(2900);
  });

  it('una fila sin nombre no se aplica', () => {
    const plan = planDeImportacion({ texto: '\t2900', productos });
    expect(plan.lineas[0].estado).toBe('invalida');
  });
});

describe('cambiosSospechosos', () => {
  // La cooperativa sabe si el aceite subió 40%; nadie sabe si subió 4.000%.
  // Casi siempre es una columna mal leída.
  it('destaca los cambios de más de 3 veces, en los dos sentidos', () => {
    const lineas = [
      { estado: 'cambia', precio: 99000, precioAnterior: 750 },  // x132
      { estado: 'cambia', precio: 100, precioAnterior: 750 },    // /7,5
      { estado: 'cambia', precio: 900, precioAnterior: 750 },    // x1,2 → normal
      { estado: 'igual', precio: 750, precioAnterior: 750 },
    ];
    const s = cambiosSospechosos(lineas);
    expect(s).toHaveLength(2);
  });

  it('no mira las filas que no se van a aplicar', () => {
    expect(cambiosSospechosos([{ estado: 'sin_match', precio: 99000, precioAnterior: 750 }])).toHaveLength(0);
  });

  it('un precio anterior de cero no es un cambio sospechoso, es un precio nuevo', () => {
    expect(cambiosSospechosos([{ estado: 'cambia', precio: 5000, precioAnterior: 0 }])).toHaveLength(0);
  });
});
