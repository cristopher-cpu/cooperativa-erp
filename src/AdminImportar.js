import React, { useState, useMemo, useRef } from 'react';
import {
  normalizarFormatos, aplicarPrecios, revertirImportacion, addAdminLog,
} from './supabaseClient';
import { clp } from './calculos';
import { CANONICAS, planDeNormalizacion, formatoCanonico, interpretarFormato } from './unidades';
import { planDeImportacion, cambiosSospechosos, RESUMEN_ESTADOS, parsearPrecio } from './importar';
import { BuscadorProducto } from './Buscador';

// ─── CARGA MASIVA Y NORMALIZACIÓN ────────────────────────────────────────────
//
// Dos cosas que van juntas porque la segunda depende de la primera: emparejar
// una planilla de precios con el maestro funciona mucho mejor cuando los
// formatos están normalizados.
//
// Todo lo que escribe pasa por una confirmación que dice exactamente qué va a
// cambiar. Cambiar precios en masa es la operación más peligrosa del sistema:
// un error se multiplica por ochenta y dos y se descubre cuando las familias ya
// pidieron.

// ── A. Normalizar formatos de venta ─────────────────────────────────────────

function Normalizador({ products, setProducts, currentAdmin }) {
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState(null);
  const [manual, setManual] = useState({});   // productId → { qty, unit }
  const [abierto, setAbierto] = useState(false);

  const plan = useMemo(() => planDeNormalizacion(products), [products]);

  const aplicar = async (cambios, etiqueta) => {
    if (!cambios.length) return;
    setGuardando(true); setMsg(null);
    const res = await normalizarFormatos(cambios);
    if (res && res.error) {
      setMsg({ tipo: 'err', texto: res.error });
      if (res.hechos && res.hechos.length) {
        setProducts(p => p.map(x => res.hechos.find(h => h.id === x.id) || x));
      }
      setGuardando(false);
      return;
    }
    setProducts(p => p.map(x => res.find(h => h.id === x.id) || x));
    if (currentAdmin) {
      addAdminLog({
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        admin_id: currentAdmin.id, admin_name: currentAdmin.name,
        action: 'formatos_normalizados',
        details: etiqueta + ': ' + res.length + ' producto' + (res.length === 1 ? '' : 's'),
      });
    }
    setMsg({ tipo: 'ok', texto: 'Se normalizaron ' + res.length + ' producto' + (res.length === 1 ? '' : 's') + '.' });
    setGuardando(false);
  };

  const total = products.length;
  const variantes = new Set(products.map(p => p.unit)).size;
  const pendientes = plan.automaticos.length + plan.revisar.length;

  return (
    <div style={{ background: 'white', border: '1px solid #dde8dd', borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: '11px', color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
            Formatos de venta
          </p>
          <p style={{ fontSize: '12px', color: '#666', margin: '5px 0 0', lineHeight: 1.6 }}>
            {plan.listos.length} de {total} productos normalizados.
            Hay <strong>{variantes} maneras distintas</strong> de escribir lo que son {Object.keys(CANONICAS).length} unidades
            ({Object.values(CANONICAS).map(c => c.label).join(', ')}).
          </p>
        </div>
        <button onClick={() => setAbierto(!abierto)}
          style={{ padding: '6px 13px', background: '#e3f2fd', color: '#1565c0', border: '1px solid #90caf9', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' }}>
          {abierto ? 'Ocultar' : pendientes ? 'Revisar ' + pendientes : 'Ver detalle'}
        </button>
      </div>

      <p style={{ fontSize: '11px', color: '#aaa', margin: '8px 0 0', lineHeight: 1.6 }}>
        La etiqueta que se muestra <strong>no cambia</strong>: "24 rollos" se sigue leyendo así, porque quien recibe
        la caja necesita saber que son rollos. Lo que se agrega es la versión con la que se calcula
        (24 unidades), y sirve para que la orden al proveedor no diga "Kg", "1 Kg" y "Kilo" como si
        fueran tres formatos, para poder sumar el peso que se le compra a cada uno, y para emparejar
        una planilla de precios.
      </p>

      {msg && (
        <div style={{ background: msg.tipo === 'ok' ? '#e8f5e9' : '#ffebee', border: `1px solid ${msg.tipo === 'ok' ? '#81c784' : '#ef9a9a'}`, borderRadius: '7px', padding: '9px 12px', marginTop: '10px' }}>
          <p style={{ fontSize: '12px', color: msg.tipo === 'ok' ? '#2e7d32' : '#c62828', margin: 0, fontWeight: 500 }}>{msg.texto}</p>
        </div>
      )}

      {abierto && (
        <div style={{ marginTop: '12px' }}>
          {plan.automaticos.length > 0 && (
            <div style={{ background: '#f8fbff', border: '1px solid #90caf9', borderRadius: '8px', padding: '11px', marginBottom: '9px' }}>
              <p style={{ fontSize: '12px', fontWeight: 700, color: '#1565c0', margin: '0 0 6px' }}>
                {plan.automaticos.length} se interpretan sin ambigüedad
              </p>
              <div style={{ maxHeight: '190px', overflowY: 'auto', marginBottom: '9px' }}>
                {plan.automaticos.map(a => (
                  <div key={a.producto.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', padding: '3px 0', fontSize: '11px', borderBottom: '1px solid #f0f4f8' }}>
                    <span style={{ color: '#444', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.producto.name}</span>
                    <span style={{ whiteSpace: 'nowrap', color: '#888' }}>
                      "{a.producto.unit}" → <strong style={{ color: '#1565c0' }}>{formatoCanonico(a.qty, a.unit)}</strong>
                    </span>
                  </div>
                ))}
              </div>
              <button onClick={() => aplicar(
                plan.automaticos.map(a => ({ id: a.producto.id, qty: a.qty, unit: a.unit })),
                'automáticos'
              )} disabled={guardando}
                style={{ width: '100%', padding: '9px', background: '#1565c0', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: 700, fontSize: '12px' }}>
                {guardando ? 'Normalizando...' : 'Normalizar los ' + plan.automaticos.length}
              </button>
            </div>
          )}

          {plan.revisar.length > 0 && (
            <div style={{ background: '#fff8e1', border: '1px solid #ffc107', borderRadius: '8px', padding: '11px', marginBottom: '9px' }}>
              <p style={{ fontSize: '12px', fontWeight: 700, color: '#e65100', margin: '0 0 4px' }}>
                {plan.revisar.length} necesitan que alguien decida
              </p>
              <p style={{ fontSize: '11px', color: '#666', margin: '0 0 9px', lineHeight: 1.5 }}>
                O no traen número —"Kg" se asume un kilo, y si son medio kilo hay que corregirlo— o el
                formato es compuesto. Interpretar en silencio un formato que no se entiende es cómo un
                precio termina dividido por mil.
              </p>
              {plan.revisar.map(r => {
                const m = manual[r.producto.id] || { qty: r.qty != null ? String(r.qty) : '', unit: r.unit || '' };
                const listo = m.qty !== '' && m.unit && Number(m.qty) > 0;
                return (
                  <div key={r.producto.id} style={{ background: 'white', borderRadius: '7px', padding: '9px', marginBottom: '6px' }}>
                    <p style={{ fontSize: '12px', fontWeight: 600, margin: '0 0 3px', color: '#333' }}>{r.producto.name}</p>
                    <p style={{ fontSize: '10px', color: '#999', margin: '0 0 7px' }}>
                      Dice <strong>"{r.producto.unit}"</strong>{r.motivo && ' · ' + r.motivo}
                    </p>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input type="number" step="0.01" min="0" placeholder="Cantidad" value={m.qty}
                        onChange={e => setManual(p => ({ ...p, [r.producto.id]: { ...m, qty: e.target.value } }))}
                        style={{ width: '90px', padding: '6px', border: '1px solid #dde8dd', borderRadius: '5px', fontSize: '12px' }} />
                      <select value={m.unit}
                        onChange={e => setManual(p => ({ ...p, [r.producto.id]: { ...m, unit: e.target.value } }))}
                        style={{ padding: '6px', border: '1px solid #dde8dd', borderRadius: '5px', fontSize: '12px' }}>
                        <option value="">— unidad —</option>
                        {Object.entries(CANONICAS).map(([id, c]) => (
                          <option key={id} value={id}>{c.label} ({c.nombre})</option>
                        ))}
                      </select>
                      <button onClick={() => aplicar([{ id: r.producto.id, qty: Number(m.qty), unit: m.unit }], 'revisado a mano')}
                        disabled={!listo || guardando}
                        style={{ padding: '6px 12px', background: listo ? '#e65100' : '#e0e0e0', color: 'white', border: 'none', borderRadius: '5px', cursor: listo ? 'pointer' : 'default', fontSize: '11px', fontWeight: 700 }}>
                        Guardar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {pendientes === 0 && (
            <p style={{ fontSize: '12px', color: '#2e7d32', margin: 0, fontWeight: 500 }}>
              ✓ Los {total} productos tienen su formato normalizado.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── B. Importar una planilla de precios ─────────────────────────────────────

function ImportadorPrecios({ products, setProducts, providers, currentAdmin }) {
  const [texto, setTexto] = useState('');
  const [proveedorId, setProveedorId] = useState('');
  const [elecciones, setElecciones] = useState({});   // nº de fila → producto elegido
  const [aplicando, setAplicando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [msg, setMsg] = useState(null);
  const archivoRef = useRef(null);

  const plan = useMemo(
    () => texto.trim() ? planDeImportacion({ texto, productos: products, proveedorId: proveedorId || null }) : null,
    [texto, products, proveedorId]
  );

  // Las filas ambiguas resueltas a mano se tratan como las demás. Se calcula
  // acá y no dentro del plan porque el plan es puro y esto es una decisión que
  // tomó una persona en la pantalla.
  const lineas = useMemo(() => {
    if (!plan) return [];
    return plan.lineas.map(l => {
      const elegido = elecciones[l.fila];
      if (!elegido) return l;
      const cambia = Number(elegido.price) !== l.precio;
      return {
        ...l,
        estado: cambia ? 'cambia' : 'igual',
        producto: elegido,
        precioAnterior: Number(elegido.price) || 0,
        resueltoAMano: true,
      };
    });
  }, [plan, elecciones]);

  const conteos = useMemo(() => {
    const c = {};
    lineas.forEach(l => { c[l.estado] = (c[l.estado] || 0) + 1; });
    return c;
  }, [lineas]);

  const aplicables = useMemo(
    () => lineas.filter(l => RESUMEN_ESTADOS[l.estado] && RESUMEN_ESTADOS[l.estado].aplica),
    [lineas]
  );
  const sospechosos = useMemo(() => cambiosSospechosos(lineas), [lineas]);

  const leerArchivo = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { setTexto(String(r.result || '')); setElecciones({}); setResultado(null); };
    r.onerror = () => setMsg({ tipo: 'err', texto: 'No se pudo leer el archivo.' });
    // Los CSV que salen de Excel en Windows vienen en Latin-1 con frecuencia,
    // pero UTF-8 es lo más común hoy y un acento mal leído se ve al instante en
    // la vista previa, así que se lee UTF-8 y la persona lo nota.
    r.readAsText(f, 'UTF-8');
  };

  const aplicar = async () => {
    if (!aplicables.length) return;

    const delta = aplicables.reduce((s, l) => s + (l.precio - l.precioAnterior), 0);
    const sugeridos = aplicables.filter(l => l.estado === 'cambia_sugerido').length;

    const confirmacion =
      'Se van a cambiar ' + aplicables.length + ' precio' + (aplicables.length === 1 ? '' : 's') + '.\n\n' +
      (sugeridos ? '· ' + sugeridos + ' de ellos con un emparejamiento SUGERIDO (el nombre no era idéntico).\n' : '') +
      (sospechosos.length ? '· ' + sospechosos.length + ' con un cambio de más de 3 veces el precio anterior.\n' : '') +
      '\nEfecto sobre la suma del maestro: ' + (delta >= 0 ? '+' : '') + clp(delta) + '\n\n' +
      'Los pedidos ya sellados no cambian: tienen su precio congelado.\n' +
      'Podrás deshacer esta importación completa desde acá mismo.\n\n¿Aplicar?';

    if (!window.confirm(confirmacion)) return;

    setAplicando(true); setMsg(null);
    const batchId = 'imp-' + Date.now().toString(36);
    const res = await aplicarPrecios(
      aplicables.map(l => ({ id: l.producto.id, precio: l.precio, precioAnterior: l.precioAnterior })),
      {
        batchId,
        quien: currentAdmin ? currentAdmin.id : null,
        quienNombre: currentAdmin ? currentAdmin.name : null,
        note: proveedorId
          ? 'Importación de la lista de ' + ((providers.find(p => p.id === proveedorId) || {}).name || '')
          : 'Importación de lista de precios',
      }
    );

    if (res.hechos.length) {
      setProducts(p => p.map(x => res.hechos.find(h => h.id === x.id) || x));
    }
    if (currentAdmin) {
      addAdminLog({
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        admin_id: currentAdmin.id, admin_name: currentAdmin.name,
        action: 'precios_importados',
        details: res.hechos.length + ' precios actualizados (' + batchId + ')' +
                 (res.fallidos.length ? ', ' + res.fallidos.length + ' fallaron' : ''),
      });
    }

    setResultado({ batchId, ...res });
    setAplicando(false);
  };

  const deshacer = async () => {
    if (!resultado) return;
    if (!window.confirm(
      '¿Deshacer la importación completa?\n\n' +
      'Los ' + resultado.hechos.length + ' precios vuelven a su valor anterior.\n\n' +
      'Los que alguien haya cambiado a mano DESPUÉS de esta importación no se tocan: ' +
      'ese cambio es más nuevo y pisarlo sería descartar una decisión posterior.'
    )) return;

    setAplicando(true);
    const res = await revertirImportacion(resultado.batchId);
    if (res.error) { setMsg({ tipo: 'err', texto: res.error }); setAplicando(false); return; }
    setProducts(p => p.map(x => res.revertidos.find(h => h.id === x.id) || x));
    if (currentAdmin) {
      addAdminLog({
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        admin_id: currentAdmin.id, admin_name: currentAdmin.name,
        action: 'importacion_revertida',
        details: resultado.batchId + ': ' + res.revertidos.length + ' precios revertidos' +
                 (res.saltados.length ? ', ' + res.saltados.length + ' saltados' : ''),
      });
    }
    setMsg({
      tipo: 'ok',
      texto: 'Se revirtieron ' + res.revertidos.length + ' precios.' +
        (res.saltados.length ? ' ' + res.saltados.length + ' no se tocaron porque cambiaron después.' : ''),
    });
    setResultado(null); setTexto(''); setElecciones({});
    setAplicando(false);
  };

  const proveedor = providers.find(p => p.id === proveedorId);
  const universo = proveedorId ? products.filter(p => p.provider_id === proveedorId) : products;

  return (
    <div style={{ background: 'white', border: '1px solid #dde8dd', borderRadius: '10px', padding: '1rem' }}>
      <p style={{ fontSize: '11px', color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 5px' }}>
        Importar lista de precios
      </p>
      <p style={{ fontSize: '12px', color: '#666', margin: '0 0 12px', lineHeight: 1.6 }}>
        Abre la planilla del proveedor en Excel, <strong>selecciona las celdas y cópialas</strong> (Ctrl+C), y pégalas
        acá abajo. También sirve un archivo CSV. No se cambia nada hasta que revises lo que propone.
      </p>

      {/* Filtrar por proveedor baja mucho la ambigüedad: "Arroz" empareja con
          cuatro productos en el maestro completo y con uno en el catálogo de un
          proveedor. */}
      <div style={{ marginBottom: '10px' }}>
        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>
          ¿Es la lista de un proveedor? <span style={{ color: '#aaa' }}>(opcional, pero reduce mucho los empates)</span>
        </label>
        <select value={proveedorId} onChange={e => { setProveedorId(e.target.value); setElecciones({}); }}
          style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }}>
          <option value="">Consolidado — buscar en los {products.length} productos</option>
          {providers.filter(p => p.active !== false).sort((a, b) => a.name.localeCompare(b.name)).map(p => (
            <option key={p.id} value={p.id}>
              {p.name} ({products.filter(x => x.provider_id === p.id).length} productos)
            </option>
          ))}
        </select>
        {proveedor && universo.length === 0 && (
          <p style={{ fontSize: '11px', color: '#c62828', margin: '4px 0 0' }}>
            {proveedor.name} no tiene productos en el maestro: nada va a emparejar.
          </p>
        )}
      </div>

      <textarea value={texto} onChange={e => { setTexto(e.target.value); setElecciones({}); setResultado(null); }}
        rows={7}
        placeholder={'Producto\tFormato\tPrecio\nArroz integral\t1 kg\t$2.490\nLentejas\t500 gr\t$1.890'}
        style={{ width: '100%', padding: '9px', border: '1px solid #dde8dd', borderRadius: '7px', fontSize: '12px', fontFamily: 'monospace', boxSizing: 'border-box', resize: 'vertical' }} />

      <div style={{ display: 'flex', gap: '7px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input ref={archivoRef} type="file" accept=".csv,.txt,text/csv,text/plain" onChange={leerArchivo} style={{ display: 'none' }} />
        <button onClick={() => archivoRef.current && archivoRef.current.click()}
          style={{ padding: '7px 13px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: '#555' }}>
          📄 Abrir un CSV
        </button>
        {texto && (
          <button onClick={() => { setTexto(''); setElecciones({}); setResultado(null); setMsg(null); }}
            style={{ padding: '7px 13px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: '#555' }}>
            Limpiar
          </button>
        )}
        {plan && (
          <span style={{ fontSize: '11px', color: '#aaa' }}>
            {plan.totalFilas} fila{plan.totalFilas === 1 ? '' : 's'} ·
            {' '}separado por {plan.separador === '\t' ? 'tabulador' : '"' + plan.separador + '"'}
            {plan.columnas.tieneEncabezado ? ' · con encabezado' : ' · sin encabezado'}
          </span>
        )}
      </div>

      {msg && (
        <div style={{ background: msg.tipo === 'ok' ? '#e8f5e9' : '#ffebee', border: `1px solid ${msg.tipo === 'ok' ? '#81c784' : '#ef9a9a'}`, borderRadius: '7px', padding: '9px 12px', marginTop: '10px' }}>
          <p style={{ fontSize: '12px', color: msg.tipo === 'ok' ? '#2e7d32' : '#c62828', margin: 0, fontWeight: 500 }}>{msg.texto}</p>
        </div>
      )}

      {/* Qué pasó, después de aplicar */}
      {resultado && (
        <div style={{ background: '#e8f5e9', border: '1px solid #81c784', borderRadius: '8px', padding: '11px', marginTop: '12px' }}>
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#2e7d32', margin: '0 0 5px' }}>
            ✓ {resultado.hechos.length} precio{resultado.hechos.length === 1 ? '' : 's'} actualizado{resultado.hechos.length === 1 ? '' : 's'}
          </p>
          {resultado.fallidos.length > 0 && (
            <p style={{ fontSize: '12px', color: '#c62828', margin: '0 0 5px' }}>
              {resultado.fallidos.length} no se pudo{resultado.fallidos.length === 1 ? '' : 'ieron'} guardar:
              {' '}{resultado.fallidos.map(f => f.id).join(', ')}
            </p>
          )}
          {resultado.sinHistorial && (
            <p style={{ fontSize: '11px', color: '#e65100', margin: '0 0 5px', lineHeight: 1.5 }}>
              Los precios se aplicaron, pero no quedó historial: falta ejecutar{' '}
              <code>008_formato_de_venta.sql</code>. <strong>Sin historial no se puede deshacer</strong>.
            </p>
          )}
          {!resultado.sinHistorial && (
            <button onClick={deshacer} disabled={aplicando}
              style={{ padding: '7px 13px', background: 'white', border: '1px solid #81c784', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: '#2e7d32' }}>
              {aplicando ? '...' : '↩ Deshacer esta importación'}
            </button>
          )}
        </div>
      )}

      {/* Vista previa */}
      {plan && !resultado && (
        <div style={{ marginTop: '12px' }}>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
            {Object.entries(RESUMEN_ESTADOS).filter(([e]) => conteos[e]).map(([e, cfg]) => (
              <span key={e} style={{ fontSize: '11px', fontWeight: 600, padding: '4px 10px', borderRadius: '12px', background: cfg.bg, color: cfg.color }}>
                {conteos[e]} {cfg.label.toLowerCase()}
              </span>
            ))}
          </div>

          {sospechosos.length > 0 && (
            <div style={{ background: '#fff8e1', border: '1px solid #ffc107', borderRadius: '8px', padding: '10px 12px', marginBottom: '10px' }}>
              <p style={{ fontSize: '12px', fontWeight: 700, color: '#e65100', margin: '0 0 5px' }}>
                ⚠ {sospechosos.length} cambio{sospechosos.length === 1 ? '' : 's'} de más de 3 veces el precio anterior
              </p>
              <p style={{ fontSize: '11px', color: '#666', margin: '0 0 7px', lineHeight: 1.5 }}>
                Casi siempre es una columna mal leída, no una subida real. La cooperativa sabe si el
                aceite subió 40%; nadie sabe si subió 4.000%.
              </p>
              {sospechosos.map(l => (
                <div key={l.fila} style={{ fontSize: '11px', color: '#555', padding: '2px 0' }}>
                  {l.producto.name}: {clp(l.precioAnterior)} → <strong>{clp(l.precio)}</strong>
                  {' '}<span style={{ color: '#c62828' }}>(×{(l.precio / l.precioAnterior).toFixed(1)})</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ maxHeight: '420px', overflowY: 'auto', border: '1px solid #eef3ee', borderRadius: '8px' }}>
            {lineas.map(l => {
              const cfg = RESUMEN_ESTADOS[l.estado] || {};
              return (
                <div key={l.fila} style={{ padding: '8px 11px', borderBottom: '1px solid #f4f8f4', background: l.estado === 'igual' ? '#fafffe' : 'white' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '9px', color: '#ccc', width: '22px', flexShrink: 0 }}>{l.fila}</span>
                    <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 7px', borderRadius: '9px', background: cfg.bg, color: cfg.color, whiteSpace: 'nowrap' }}>
                      {cfg.label}
                    </span>
                    <span style={{ fontSize: '12px', color: '#333', flex: 1, minWidth: '120px' }}>
                      {l.nombreTexto || <em style={{ color: '#bbb' }}>(fila sin nombre)</em>}
                      {l.formatoTexto && <span style={{ color: '#bbb', fontSize: '10px' }}> · {l.formatoTexto}</span>}
                    </span>
                    {l.producto && (
                      <span style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
                        {l.estado === 'igual'
                          ? <span style={{ color: '#888' }}>{clp(l.precio)}</span>
                          : <>
                              <span style={{ color: '#999', textDecoration: 'line-through' }}>{clp(l.precioAnterior)}</span>
                              {' → '}
                              <strong style={{ color: l.precio > l.precioAnterior ? '#c62828' : '#2e7d32' }}>{clp(l.precio)}</strong>
                            </>}
                      </span>
                    )}
                    {!l.producto && l.precio != null && (
                      <span style={{ fontSize: '12px', color: '#888', whiteSpace: 'nowrap' }}>{clp(l.precio)}</span>
                    )}
                  </div>

                  {l.producto && l.producto.name !== l.nombreTexto && (
                    <p style={{ fontSize: '10px', color: '#888', margin: '3px 0 0', paddingLeft: '30px' }}>
                      → {l.producto.name} <span style={{ color: '#bbb' }}>({l.producto.unit})</span>
                      {l.resueltoAMano && <span style={{ color: '#2e7d32', fontWeight: 600 }}> · lo elegiste tú</span>}
                      {!l.resueltoAMano && l.por && <span style={{ color: '#e65100' }}> · emparejado por {l.por}, revísalo</span>}
                    </p>
                  )}

                  {l.motivo && (
                    <p style={{ fontSize: '10px', color: '#c62828', margin: '3px 0 0', paddingLeft: '30px' }}>{l.motivo}</p>
                  )}

                  {/* Los empates y los que no están en el maestro se resuelven
                      acá mismo con el buscador, en vez de mandar a la persona a
                      otra pestaña y perder el trabajo hecho. */}
                  {(l.estado === 'ambiguo' || l.estado === 'sin_match') && l.precio != null && (
                    <div style={{ paddingLeft: '30px', marginTop: '6px' }}>
                      {l.estado === 'ambiguo' && (
                        <p style={{ fontSize: '10px', color: '#6a1b9a', margin: '0 0 4px' }}>
                          Coinciden {l.candidatos.length}: {l.candidatos.map(c => c.name).join(' · ')}
                        </p>
                      )}
                      <BuscadorProducto
                        productos={l.candidatos && l.candidatos.length ? l.candidatos : universo}
                        value={(elecciones[l.fila] || {}).id || ''}
                        onChange={prod => setElecciones(p => {
                          const n = { ...p };
                          if (prod) n[l.fila] = prod; else delete n[l.fila];
                          return n;
                        })}
                        placeholder="Escribe para elegir a qué producto corresponde..."
                        vacio="No hay productos donde buscar"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button onClick={aplicar} disabled={!aplicables.length || aplicando}
            style={{ width: '100%', marginTop: '11px', padding: '11px', background: aplicables.length ? '#1565c0' : '#bdbdbd', color: 'white', border: 'none', borderRadius: '8px', cursor: aplicables.length && !aplicando ? 'pointer' : 'default', fontWeight: 700, fontSize: '13px' }}>
            {aplicando ? 'Aplicando...'
              : !aplicables.length ? 'Nada por aplicar'
              : 'Aplicar ' + aplicables.length + ' cambio' + (aplicables.length === 1 ? '' : 's') + ' de precio'}
          </button>

          <p style={{ fontSize: '10px', color: '#bbb', margin: '8px 0 0', lineHeight: 1.6 }}>
            Los pedidos ya sellados <strong>no cambian</strong>: tienen su precio congelado dentro.
            Lo que cambia es el maestro, y por lo tanto los pedidos que se hagan de ahora en adelante.
          </p>
        </div>
      )}
    </div>
  );
}

export function AdminImportar({ products, setProducts, providers = [], currentAdmin }) {
  return (
    <div>
      <Normalizador products={products} setProducts={setProducts} currentAdmin={currentAdmin} />
      <ImportadorPrecios products={products} setProducts={setProducts} providers={providers} currentAdmin={currentAdmin} />
    </div>
  );
}

// Reexportado para que la pestaña de Productos pueda mostrar el formato
// canónico de un producto sin importar dos módulos.
export { interpretarFormato, parsearPrecio };
