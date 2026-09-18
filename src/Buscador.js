import React, { useState, useMemo, useRef, useEffect } from 'react';

// ─── BUSCADOR DE PRODUCTOS ───────────────────────────────────────────────────
//
// Un `<select>` con los 82 productos del maestro obliga a recorrer la lista
// entera para encontrar uno, y el maestro va a crecer. En el día del retiro, con
// la familia esperando, eso es tiempo real perdido.
//
// El patrón de escribir-y-elegir ya existía dos veces en el panel (proveedor en
// Productos, producto en Bodega), copiado con sus diferencias: uno cerraba el
// desplegable con onBlur y el otro no, y las coincidencias se buscaban distinto.
// Está acá una sola vez para que se comporte igual en todas partes.
//
// ── Cómo busca ──────────────────────────────────────────────────────────────
//
// Sin acentos y por palabras en cualquier orden: "integral arroz" encuentra
// "Arroz integral", y "azucar" encuentra "Azúcar". Un buscador que exige tildes
// correctas y el orden exacto es un buscador que no se usa.
//
// Ordena las que empiezan con lo escrito antes que las que solo lo contienen:
// escribir "ha" tiene que ofrecer "Harina" antes que "Zapallo halloween".

const normalizar = (s) => (s || '')
  .toString()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '');

export function coincide(texto, consulta) {
  const q = normalizar(consulta).trim();
  if (!q) return true;
  const t = normalizar(texto);
  return q.split(/\s+/).every(palabra => t.includes(palabra));
}

// Filtra y ordena. Exportada aparte porque el desglose de una familia también
// necesita filtrar sin dibujar un desplegable.
export function filtrarProductos(productos, consulta) {
  const q = normalizar(consulta).trim();
  const lista = (productos || []).filter(p => coincide(p.name + ' ' + (p.provider || ''), consulta));
  if (!q) return lista;
  const empieza = p => normalizar(p.name).startsWith(q.split(/\s+/)[0]);
  return lista.sort((a, b) => (empieza(b) ? 1 : 0) - (empieza(a) ? 1 : 0) || a.name.localeCompare(b.name));
}

// Resalta lo escrito dentro del nombre, para que se vea POR QUÉ apareció.
function Resaltado({ texto, consulta }) {
  const q = normalizar(consulta).trim().split(/\s+/).filter(Boolean);
  if (!q.length) return <>{texto}</>;

  // Se marca sobre el texto original (con tildes) usando las posiciones que da
  // la versión normalizada. Ambas tienen el mismo largo: NFD descompone y el
  // replace borra solo los diacríticos, que no son caracteres base.
  const plano = normalizar(texto);
  const marcas = new Array(texto.length).fill(false);
  q.forEach(palabra => {
    let i = plano.indexOf(palabra);
    while (i !== -1) {
      for (let k = i; k < i + palabra.length && k < marcas.length; k++) marcas[k] = true;
      i = plano.indexOf(palabra, i + 1);
    }
  });

  const trozos = [];
  let actual = '', marcado = marcas[0];
  for (let i = 0; i < texto.length; i++) {
    if (marcas[i] !== marcado) { trozos.push({ t: actual, m: marcado }); actual = ''; marcado = marcas[i]; }
    actual += texto[i];
  }
  trozos.push({ t: actual, m: marcado });

  return <>{trozos.map((z, i) => z.m
    ? <mark key={i} style={{ background: '#fff59d', color: 'inherit', padding: 0 }}>{z.t}</mark>
    : <React.Fragment key={i}>{z.t}</React.Fragment>)}</>;
}

// `value`    id del producto elegido, o '' / null
// `onChange` recibe el producto completo, o null al limpiar
// `subtitulo` texto opcional bajo la selección (por ejemplo cuánto pidió)
export function BuscadorProducto({
  productos = [],
  value = '',
  onChange,
  placeholder = 'Escribe para buscar un producto...',
  sinResultados = 'Ningún producto coincide',
  vacio = 'No hay productos cargados',
  subtitulo = null,
  autoFocus = false,
  detalleDe = null,   // (producto) => nodo, a la derecha de cada opción
}) {
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [cursor, setCursor] = useState(0);
  const contenedor = useRef(null);
  const listaRef = useRef(null);

  const elegido = productos.find(p => String(p.id) === String(value)) || null;
  const matches = useMemo(() => filtrarProductos(productos, q), [productos, q]);

  // El cursor se reinicia al cambiar lo escrito: si quedara donde estaba,
  // Enter elegiría un producto que ya no es el que está arriba de la lista.
  useEffect(() => { setCursor(0); }, [q]);

  // Se cierra al hacer clic fuera. Con onBlur y un setTimeout —como estaba en
  // los dos copiados— elegir con el teclado a veces perdía el clic.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e) => { if (contenedor.current && !contenedor.current.contains(e.target)) setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);

  // Mantiene visible la opción marcada al moverse con las flechas.
  useEffect(() => {
    const el = listaRef.current?.children[cursor];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [cursor, abierto]);

  const elegir = (p) => { onChange && onChange(p); setQ(''); setAbierto(false); };

  const teclas = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAbierto(true); setCursor(c => Math.min(c + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (matches[cursor]) elegir(matches[cursor]); }
    else if (e.key === 'Escape') { setAbierto(false); }
  };

  if (elegido) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ flex: 1, minWidth: 0, padding: '7px 10px', border: '1px solid #4CAF50', borderRadius: '6px', background: '#f0f7f0', fontSize: '13px', color: '#2d5a2d', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ✓ {elegido.name} <span style={{ fontWeight: 400, color: '#5a8a5a' }}>· {elegido.unit} · ${Number(elegido.price || 0).toLocaleString('es-CL')}</span>
          </div>
          <button type="button" onClick={() => { onChange && onChange(null); setQ(''); setAbierto(true); }}
            style={{ padding: '6px 10px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', color: '#666', whiteSpace: 'nowrap' }}>
            Cambiar
          </button>
        </div>
        {subtitulo && <p style={{ fontSize: '11px', color: '#888', margin: '4px 0 0' }}>{subtitulo}</p>}
      </div>
    );
  }

  return (
    <div ref={contenedor} style={{ position: 'relative' }}>
      <input
        type="text"
        value={q}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={e => { setQ(e.target.value); setAbierto(true); }}
        onFocus={() => setAbierto(true)}
        onKeyDown={teclas}
        style={{ width: '100%', padding: '7px 10px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }}
      />
      {abierto && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', boxShadow: '0 4px 14px rgba(0,0,0,0.12)', zIndex: 100, maxHeight: '220px', overflowY: 'auto', marginTop: '2px' }}>
          {productos.length === 0 ? (
            <div style={{ padding: '10px', textAlign: 'center', color: '#aaa', fontSize: '12px' }}>{vacio}</div>
          ) : matches.length === 0 ? (
            <div style={{ padding: '10px', textAlign: 'center', color: '#aaa', fontSize: '12px' }}>{sinResultados}</div>
          ) : (
            <div ref={listaRef}>
              {matches.map((p, i) => (
                <div key={p.id}
                  onMouseDown={e => { e.preventDefault(); elegir(p); }}
                  onMouseEnter={() => setCursor(i)}
                  style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '12px', borderBottom: '1px solid #f5f5f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', background: i === cursor ? '#f0f7f0' : 'white' }}>
                  <span style={{ fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <Resaltado texto={p.name} consulta={q} />
                    {p.provider && <span style={{ color: '#aaa', fontWeight: 400 }}> · {p.provider}</span>}
                  </span>
                  <span style={{ color: '#888', fontSize: '11px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {detalleDe ? detalleDe(p) : <>{p.unit} · ${Number(p.price || 0).toLocaleString('es-CL')}</>}
                  </span>
                </div>
              ))}
            </div>
          )}
          {matches.length > 0 && (
            <div style={{ padding: '5px 12px', fontSize: '10px', color: '#bbb', background: '#fafafa', borderTop: '1px solid #f0f0f0' }}>
              {matches.length} de {productos.length} · ↑↓ y Enter para elegir
            </div>
          )}
        </div>
      )}
    </div>
  );
}
