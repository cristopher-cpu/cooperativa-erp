// Pruebas del buscador de productos. Lo usan el catálogo de las familias, el
// maestro, Bodega, Faltantes y Extras e Importar precios: si encuentra distinto
// en un lugar que en otro, alguien concluye que el producto no existe.

import { coincide, filtrarProductos, textoDeProducto } from './Buscador';

const productos = [
  { id: 1, name: 'Avena Integral', provider: 'El Granero', category: 'Cereales' },
  { id: 2, name: 'Azúcar Rubia', provider: 'El Granero', category: 'Dulces' },
  { id: 3, name: 'Quinoa', provider: 'Amador Aguilera', category: 'Cereales' },
  { id: 4, name: 'Miel de Ulmo', provider: null, category: 'Miel' },
];

describe('buscador de productos', () => {
  it('busca por nombre de proveedor', () => {
    expect(filtrarProductos(productos, 'granero').map(p => p.id).sort()).toEqual([1, 2]);
    expect(filtrarProductos(productos, 'amador').map(p => p.id)).toEqual([3]);
  });

  it('combina proveedor y producto en cualquier orden', () => {
    expect(filtrarProductos(productos, 'avena granero').map(p => p.id)).toEqual([1]);
  });

  it('no exige tildes', () => {
    expect(filtrarProductos(productos, 'azucar').map(p => p.id)).toEqual([2]);
  });

  it('un producto sin proveedor no rompe la búsqueda', () => {
    expect(() => filtrarProductos(productos, 'miel')).not.toThrow();
    expect(filtrarProductos(productos, 'miel').map(p => p.id)).toEqual([4]);
    expect(textoDeProducto({ name: 'X', provider: null })).toBe('X');
  });

  it('también por categoría', () => {
    expect(filtrarProductos(productos, 'cereales').map(p => p.id).sort()).toEqual([1, 3]);
  });

  it('consulta vacía no filtra', () => {
    expect(coincide('lo que sea', '')).toBe(true);
    expect(filtrarProductos(productos, '')).toHaveLength(4);
  });
});
