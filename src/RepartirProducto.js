import React, { useState, useMemo } from 'react';
import { addAdjustmentsBulk } from './supabaseClient';
import { clp, parseItems, repartirMonto } from './calculos';
import { BuscadorProducto } from './Buscador';

// ─── REPARTIR UN PRODUCTO ENTRE FAMILIAS ─────────────────────────────────────
//
// El caso que planteó la cooperativa: hay un zapallo entero a la venta y
// varias familias se llevan un pedazo. El costo del zapallo completo tiene que
// terminar repartido entre quienes se llevaron cada parte.
//
// Se registra con lo que ya existe, sin tablas nuevas:
//
//   · A cada familia que se llevó una parte, un EXTRA por su parte del costo.
//   · Si una familia lo tenía en su pedido completo (lo pidió ella y después lo
//     compartió), un FALTANTE por lo que pidió, al precio al que lo compró. Así
//     no paga el zapallo entero además de su pedazo.
//
// Las partes se reparten con `repartirMonto`, que garantiza que sumen
// exactamente el costo total: $2.000 en tres son $667 + $667 + $666, no tres
// de $666,67 que después no cuadran con la caja.
//
// Las partes se anotan como peso o proporción, lo que se tenga a mano: «1,2 kg,
// 0,8 kg y 1 kg» o «2, 1 y 1» dan el mismo reparto proporcional.

const filaVacia = () => ({ familyId: '', parte: '' });

export function RepartirProducto({ families = [], sealed = {}, products = [], period, ajustes = [], enBodega = null, currentAdmin, onGuardado }) {
  const [abierto, setAbierto] = useState(false);
  const [productId, setProductId] = useState('');
  const [unidades, setUnidades] = useState('1');
  const [costo, setCosto] = useState('');
  const [origenId, setOrigenId] = useState('');
  const [filas, setFilas] = useState([filaVacia(), filaVacia()]);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState('');

  const prod = products.find(p => String(p.id) === String(productId)) || null;

  // Quiénes lo tienen en su pedido: son las candidatas a «lo pidió completo».
  const loPidieron = useMemo(() => {
    if (!prod) return [];
    return families
      .map(f => {
        const it = parseItems(sealed[f.id]).find(i => String(i.id) === String(prod.id) && Number(i.qty) > 0);
        return it ? { fam: f, qty: Number(it.qty), precio: Number(it.p) || Number(prod.price) || 0 } : null;
      })
      .filter(Boolean);
  }, [prod, families, sealed]);

  const origen = loPidieron.find(o => o.fam.id === origenId) || null;
  const nUnidades = parseFloat(String(unidades).replace(',', '.'));

  // El costo sugerido: si lo pidió una familia, al precio al que ella lo compró
  // (es lo que se le devuelve); si no, al precio del maestro.
  const precioUnit = origen ? origen.precio : (prod ? Number(prod.price) || 0 : 0);
  const costoSugerido = nUnidades > 0 ? Math.round(nUnidades * precioUnit) : 0;
  const costoTotal = costo === '' ? costoSugerido : Math.round(Number(costo) || 0);

  const validas = filas
    .map((f, idx) => ({ ...f, idx, peso: parseFloat(String(f.parte).replace(',', '.')) }))
    .filter(f => f.familyId && f.peso > 0);
  const montos = repartirMonto(costoTotal, validas.map(f => f.peso));
  const montoDeFila = new Map(validas.map((v, k) => [v.idx, montos[k]]));
  const sumaPesos = validas.reduce((s, f) => s + f.peso, 0);

  const reiniciar = () => {
    setProductId(''); setUnidades('1'); setCosto(''); setOrigenId('');
    setFilas([filaVacia(), filaVacia()]); setNota(''); setErr('');
  };

  const partesIguales = () => setFilas(fs => fs.map(f => (f.familyId ? { ...f, parte: '1' } : f)));

  const guardar = async () => {
    setErr('');
    if (!prod) { setErr('Elige el producto que se repartió.'); return; }
    if (!(nUnidades > 0)) { setErr('¿Cuántas unidades se repartieron? Tiene que ser más que cero.'); return; }
    if (!(costoTotal > 0)) { setErr('El costo total tiene que ser mayor que cero.'); return; }
    if (validas.length < 1) { setErr('Agrega al menos una familia con su parte.'); return; }
    const ids = validas.map(f => f.familyId);
    if (new Set(ids).size !== ids.length) { setErr('Hay una familia repetida. Suma sus partes en una sola fila.'); return; }

    if (origen) {
      // No se puede devolver más de lo que pidió, contando lo que ya se le
      // descontó de ese producto.
      const yaAjustado = ajustes
        .filter(a => a.family_id === origen.fam.id && a.product_id === prod.id && a.type !== 'extra')
        .reduce((s, a) => s + Number(a.qty || 0), 0);
      if (nUnidades + yaAjustado > origen.qty) {
        setErr(origen.fam.name + ' pidió ' + origen.qty + ' y ya tiene ' + yaAjustado + ' descontado. No se le pueden devolver ' + nUnidades + '.');
        return;
      }
    }

    const nombre = (id) => (families.find(f => f.id === id) || {}).name || id;
    const resumen = validas.map((f, i) => nombre(f.familyId) + ' ' + clp(montos[i])).join(', ');
    if (!window.confirm(
      'Repartir ' + nUnidades + ' × ' + prod.name + ' (' + clp(costoTotal) + ') entre ' + validas.length + ' familia' + (validas.length === 1 ? '' : 's') + ':\n\n' +
      resumen + '\n\n' +
      (origen ? 'A ' + origen.fam.name + ' se le devuelve lo que había pedido (' + clp(Math.round(nUnidades * origen.precio)) + ').\n\n' : '') +
      '¿Registrar?'
    )) return;

    const base = {
      period_id: period.id,
      product_id: prod.id,
      product_name: prod.name,
      unit: prod.unit,
      source: 'comision',
      created_by: currentAdmin ? currentAdmin.id : null,
    };
    const etiqueta = nUnidades + ' × ' + prod.name + ' repartido entre ' + validas.length + ' familia' + (validas.length === 1 ? '' : 's');
    const filasAjuste = validas.map((f, i) => {
      const fraccion = f.peso / sumaPesos;
      return {
        ...base,
        family_id: f.familyId,
        sealed_order_id: sealed[f.familyId] ? sealed[f.familyId].id : null,
        type: 'extra',
        // La cantidad que se llevó, en unidades del producto (0,33 de un zapallo).
        qty: Math.round(nUnidades * fraccion * 1000) / 1000,
        unit_price: Math.round(costoTotal / nUnidades),
        // El monto se guarda tal cual lo dio el reparto, no qty × precio: así los
        // pedazos suman exactamente el costo total.
        amount: montos[i],
        note: 'Parte de ' + etiqueta + ' (' + f.parte + ' de ' + Math.round(sumaPesos * 1000) / 1000 + ')' + (nota.trim() ? ' · ' + nota.trim() : ''),
      };
    });
    if (origen) {
      filasAjuste.push({
        ...base,
        family_id: origen.fam.id,
        sealed_order_id: sealed[origen.fam.id] ? sealed[origen.fam.id].id : null,
        type: 'faltante',
        qty: nUnidades,
        unit_price: origen.precio,
        amount: -Math.round(nUnidades * origen.precio),
        note: 'Lo tenía en su pedido y se repartió: ' + etiqueta + (nota.trim() ? ' · ' + nota.trim() : ''),
      });
    }

    setGuardando(true);
    const res = await addAdjustmentsBulk(filasAjuste);
    setGuardando(false);
    if (res && res.error) { setErr(res.error); return; }
    reiniciar();
    setAbierto(false);
    if (onGuardado) onGuardado('Se repartió ' + etiqueta + ': ' + resumen + '.');
  };

  if (!period) return null;

  if (!abierto) {
    return (
      <button onClick={() => { reiniciar(); setAbierto(true); }}
        style={{ width: '100%', marginBottom: '1rem', padding: '10px', background: '#fff8e1', color: '#8d6e63', border: '1px dashed #ffb74d', borderRadius: '10px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
        🎃 Repartir un producto entre familias (por ejemplo, un zapallo en pedazos)
      </button>
    );
  }

  const inp = { padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '12px', boxSizing: 'border-box' };

  return (
    <div style={{ background: 'white', border: '2px solid #ffb74d', borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}>
      <p style={{ fontSize: '13px', fontWeight: 700, color: '#e65100', margin: '0 0 4px' }}>🎃 Repartir un producto entre familias</p>
      <p style={{ fontSize: '11px', color: '#777', margin: '0 0 12px', lineHeight: 1.5 }}>
        A cada familia se le cobra su parte como extra. Las partes pueden ser kilos, gramos o
        simplemente «1, 1, 2»: el costo se reparte en proporción y los montos suman exacto el total.
      </p>

      <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Producto</label>
      <BuscadorProducto productos={products} value={productId} enBodega={enBodega}
        onChange={p => { setProductId(p ? p.id : ''); setOrigenId(''); setCosto(''); setErr(''); }} />

      {prod && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', margin: '10px 0' }}>
            <div>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Unidades que se repartieron ({prod.unit})</label>
              <input type="number" step="any" min="0" value={unidades} onChange={e => { setUnidades(e.target.value); setErr(''); }} style={{ ...inp, width: '100%' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Costo total a repartir</label>
              <input type="number" step="1" min="0" placeholder={String(costoSugerido)} value={costo}
                onChange={e => { setCosto(e.target.value); setErr(''); }} style={{ ...inp, width: '100%' }} />
              <p style={{ fontSize: '10px', color: '#aaa', margin: '2px 0 0' }}>
                {costo === '' ? 'Sugerido: ' + clp(costoSugerido) + (origen ? ' (al precio que pagó ' + origen.fam.name + ')' : ' (precio del maestro)') : 'Costo escrito a mano'}
              </p>
            </div>
          </div>

          <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>¿Alguna familia lo tenía completo en su pedido?</label>
          <select value={origenId} onChange={e => { setOrigenId(e.target.value); setCosto(''); setErr(''); }} style={{ ...inp, width: '100%', marginBottom: '10px' }}>
            <option value="">No — se compró aparte para repartir</option>
            {loPidieron.map(o => (
              <option key={o.fam.id} value={o.fam.id}>{o.fam.name} (pidió {o.qty}) — se le devuelve lo que pagó</option>
            ))}
          </select>

          {enBodega && enBodega.get(prod.id) && (
            <p style={{ fontSize: '11px', color: '#1565c0', background: '#e3f2fd', borderRadius: '6px', padding: '6px 9px', margin: '0 0 10px', lineHeight: 1.5 }}>
              🏪 Este producto está en la bodega. Si lo que se reparte sale de ahí, asígnalo desde <strong>Bodega → Asignar a familia</strong> (acepta fracciones como 0,33): así el stock baja y no se vende dos veces.
            </p>
          )}
          <p style={{ fontSize: '11px', color: '#666', margin: '0 0 5px' }}>Quién se llevó cada parte</p>
          {filas.map((f, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto auto', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
              <select value={f.familyId} onChange={e => setFilas(fs => fs.map((x, j) => j === i ? { ...x, familyId: e.target.value } : x))} style={inp}>
                <option value="">— Familia —</option>
                {families.map(fm => <option key={fm.id} value={fm.id}>{fm.name}</option>)}
              </select>
              <input type="text" inputMode="decimal" placeholder="Parte (kg o 1, 2...)" value={f.parte}
                onChange={e => setFilas(fs => fs.map((x, j) => j === i ? { ...x, parte: e.target.value } : x))} style={inp} />
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#1565c0', minWidth: '64px', textAlign: 'right' }}>
                {montoDeFila.has(i) ? clp(montoDeFila.get(i)) : '—'}
              </span>
              <button onClick={() => setFilas(fs => fs.length > 1 ? fs.filter((_, j) => j !== i) : fs)}
                style={{ width: '24px', height: '24px', border: '1px solid #ffcdd2', background: '#fff5f5', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', color: '#c62828' }}>✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
            <button onClick={() => setFilas(fs => [...fs, filaVacia()])}
              style={{ padding: '5px 10px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '11px' }}>+ Otra familia</button>
            <button onClick={partesIguales}
              style={{ padding: '5px 10px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '11px' }}>Partes iguales</button>
          </div>

          <input type="text" placeholder="Nota (opcional): zapallo camote de La Granja..." value={nota} onChange={e => setNota(e.target.value)}
            style={{ ...inp, width: '100%', marginBottom: '8px' }} />

          {validas.length > 0 && (
            <div style={{ padding: '7px 10px', background: '#fff3e0', borderRadius: '6px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style={{ color: '#555' }}>{validas.length} parte{validas.length === 1 ? '' : 's'} · suman</span>
              <strong style={{ color: '#e65100' }}>{clp(montos.reduce((s, m) => s + m, 0))} de {clp(costoTotal)}</strong>
            </div>
          )}
        </>
      )}

      {err && <p style={{ fontSize: '11px', color: '#c62828', margin: '0 0 8px', fontWeight: 500 }}>{err}</p>}
      <div style={{ display: 'flex', gap: '7px' }}>
        <button onClick={guardar} disabled={guardando || !prod}
          style={{ flex: 1, padding: '9px', background: prod ? '#e65100' : '#ccc', color: 'white', border: 'none', borderRadius: '6px', cursor: prod ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: '12px' }}>
          {guardando ? 'Registrando...' : 'Registrar reparto'}
        </button>
        <button onClick={() => { reiniciar(); setAbierto(false); }}
          style={{ padding: '9px 14px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Cancelar</button>
      </div>
    </div>
  );
}
