import React, { useState } from 'react';
import { addAdjustment, deleteAdjustment } from './supabaseClient';
import { TIPOS, clp, parseItems, montoAjuste, ventanaAjustes, puedeBorrarAjuste } from './calculos';

// ─── FALTANTES Y EXTRAS DE LA FAMILIA ────────────────────────────────────────
// Del paso 07 del flujo: "cada familia o socio/a registra sus productos
// faltantes y extras", con la Comisión Retiro supervisando.
//
// La ventana se cierra en la fecha límite del período — pero solo para la
// familia. La comisión puede corregir después desde el panel, que es la válvula
// de escape para quien se atrasó un día con un reclamo legítimo.
//
// Nota: este control es de interfaz. Mientras no exista RLS, alguien con
// conocimiento técnico puede escribir igual a la base. Cuando llegue la
// autenticación real, la fecha hay que comprobarla también en el servidor.

export function FamiliaAjustes({ user, ord, period, products, ajustes, setAjustes }) {
  const [form, setForm] = useState(null); // { type, productId, qty, note }
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState('');

  const ventana = ventanaAjustes(period, ord);
  const mios = ajustes || [];

  const pedidos = parseItems(ord).filter(i => i.qty > 0);
  const opciones = form && form.type === 'extra'
    ? products
    : products.filter(p => pedidos.some(i => i.id === p.id));

  const guardar = async () => {
    const prod = products.find(p => String(p.id) === String(form.productId));
    if (!prod) { setErr('Elige un producto'); return; }
    const qty = parseFloat(form.qty);
    if (isNaN(qty) || qty <= 0) { setErr('La cantidad debe ser mayor que cero'); return; }

    if (form.type === 'faltante') {
      const item = pedidos.find(i => i.id === prod.id);
      const pedido = item ? Number(item.qty) : 0;
      const yaMarcado = mios
        .filter(a => a.product_id === prod.id && a.type !== 'extra')
        .reduce((s, a) => s + Number(a.qty || 0), 0);
      if (qty + yaMarcado > pedido) {
        setErr('Pediste ' + pedido + ' y ya hay ' + yaMarcado + ' marcado como faltante. No puedes marcar ' + qty + ' más.');
        return;
      }
    }

    setGuardando(true);
    const res = await addAdjustment({
      period_id: period.id,
      family_id: user.id,
      sealed_order_id: ord ? ord.id : null,
      type: form.type,
      product_id: prod.id,
      product_name: prod.name,
      unit: prod.unit,
      qty,
      unit_price: prod.price,
      amount: montoAjuste(form.type, qty, prod.price),
      source: 'familia',
      note: form.note.trim() || null,
      created_by: user.id,
    });
    if (res.error) { setErr(res.error); setGuardando(false); return; }
    setAjustes(p => [res, ...p]);
    setForm(null);
    setErr('');
    setGuardando(false);
  };

  const borrar = async (adj) => {
    if (!window.confirm('¿Quitar ' + adj.product_name + ' de tus ' + (adj.type === 'extra' ? 'extras' : 'faltantes') + '?')) return;
    const res = await deleteAdjustment(adj.id);
    if (res.error) { alert(res.error); return; }
    setAjustes(p => p.filter(a => a.id !== adj.id));
  };

  if (!ord) return null;

  return (
    <div style={{ marginTop: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '9px', flexWrap: 'wrap' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#e65100', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          ¿Faltó o sobró algo?
        </p>
        {ventana.abierta && ventana.diasRestantes != null && ventana.diasRestantes <= 2 && (
          <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px', background: '#fff3e0', color: '#e65100' }}>
            {ventana.diasRestantes === 0 ? 'Último día' : 'Quedan ' + ventana.diasRestantes + ' días'}
          </span>
        )}
      </div>

      <div style={{
        background: ventana.abierta ? 'white' : '#fafafa',
        border: '1px solid ' + (ventana.abierta ? '#ffcc80' : '#e0e0e0'),
        borderRadius: '10px', padding: '1rem',
      }}>
        <p style={{ fontSize: '12px', color: ventana.abierta ? '#666' : '#999', margin: '0 0 11px', lineHeight: 1.55 }}>
          {ventana.texto}
        </p>

        {/* Lo ya registrado, venga de donde venga */}
        {mios.map(a => {
          const cfg = TIPOS[a.type] || {};
          const borrable = puedeBorrarAjuste(a, ventana);
          return (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '8px 10px', background: cfg.bg, borderRadius: '7px', marginBottom: '6px' }}>
              <span>{cfg.ic}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: '12px', fontWeight: 600, margin: 0, color: '#333' }}>
                  {a.product_name} <span style={{ color: '#888', fontWeight: 400 }}>×{a.qty} {a.unit}</span>
                </p>
                <p style={{ fontSize: '10px', color: '#888', margin: '2px 0 0' }}>
                  {a.source === 'familia' ? 'Lo registraste tú'
                    : a.source === 'proveedor' ? 'El proveedor avisó que no lo trae'
                    : 'Lo registró la Comisión Retiro'}
                  {a.type === 'extra' && (a.paid ? ' · ya pagado' : ' · por pagar')}
                  {a.note && ' · ' + a.note}
                </p>
              </div>
              <span style={{ fontSize: '13px', fontWeight: 700, color: cfg.color, whiteSpace: 'nowrap' }}>
                {a.type === 'extra' && a.paid ? 'pagado' : (a.amount > 0 ? '+' : '') + clp(a.amount)}
              </span>
              {borrable && (
                <button onClick={() => borrar(a)}
                  style={{ width: '22px', height: '22px', border: '1px solid #ffcdd2', background: '#fff5f5', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', color: '#c62828' }}>✕</button>
              )}
            </div>
          );
        })}

        {!ventana.abierta && mios.length === 0 && (
          <p style={{ fontSize: '12px', color: '#aaa', margin: 0, textAlign: 'center', padding: '8px 0' }}>
            {ventana.motivo === 'cerrada' ? 'No registraste faltantes ni extras.' : 'Nada registrado todavía.'}
          </p>
        )}

        {ventana.abierta && (form ? (
          <div style={{ border: '1px solid #90caf9', borderRadius: '8px', padding: '11px', marginTop: '9px' }}>
            <p style={{ fontSize: '12px', fontWeight: 700, color: TIPOS[form.type].color, margin: '0 0 8px' }}>
              {TIPOS[form.type].ic} {form.type === 'faltante' ? 'Algo que no llegó a tu caja' : 'Algo que te llevaste de más'}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px', marginBottom: '8px' }}>
              <select value={form.productId} onChange={e => { setForm(p => ({ ...p, productId: e.target.value })); setErr(''); }}
                style={{ padding: '8px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '12px' }}>
                <option value="">— Producto —</option>
                {opciones.map(p => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
              </select>
              <input type="number" step="0.5" min="0" placeholder="Cantidad" value={form.qty}
                onChange={e => { setForm(p => ({ ...p, qty: e.target.value })); setErr(''); }}
                style={{ padding: '8px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '12px' }} />
            </div>
            <input type="text" placeholder="¿Algo que aclarar? (opcional)" value={form.note}
              onChange={e => setForm(p => ({ ...p, note: e.target.value }))}
              style={{ width: '100%', padding: '8px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '12px', boxSizing: 'border-box', marginBottom: '8px' }} />
            {(() => {
              const prod = products.find(p => String(p.id) === String(form.productId));
              const q = parseFloat(form.qty);
              if (!prod || isNaN(q) || q <= 0) return null;
              const m = montoAjuste(form.type, q, prod.price);
              return (
                <div style={{ padding: '8px 11px', background: TIPOS[form.type].bg, borderRadius: '6px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '11px', color: '#555' }}>{m < 0 ? 'Se te descontará' : 'Se te sumará'}</span>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: TIPOS[form.type].color }}>{m > 0 ? '+' : ''}{clp(m)}</span>
                </div>
              );
            })()}
            {err && <p style={{ fontSize: '11px', color: '#c62828', margin: '0 0 8px', fontWeight: 500 }}>{err}</p>}
            <div style={{ display: 'flex', gap: '7px' }}>
              <button onClick={guardar} disabled={guardando}
                style={{ flex: 1, padding: '9px', background: TIPOS[form.type].color, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '13px' }}>
                {guardando ? 'Guardando...' : 'Registrar'}
              </button>
              <button onClick={() => { setForm(null); setErr(''); }}
                style={{ padding: '9px 14px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Cancelar</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '7px', marginTop: mios.length ? '9px' : 0, flexWrap: 'wrap' }}>
            <button onClick={() => { setForm({ type: 'faltante', productId: '', qty: '1', note: '' }); setErr(''); }}
              style={{ flex: 1, minWidth: '135px', padding: '10px', background: TIPOS.faltante.bg, color: TIPOS.faltante.color, border: `1px solid ${TIPOS.faltante.color}44`, borderRadius: '7px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
              ❗ Me faltó algo
            </button>
            <button onClick={() => { setForm({ type: 'extra', productId: '', qty: '1', note: '' }); setErr(''); }}
              style={{ flex: 1, minWidth: '135px', padding: '10px', background: TIPOS.extra.bg, color: TIPOS.extra.color, border: `1px solid ${TIPOS.extra.color}44`, borderRadius: '7px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
              ➕ Me llevé algo extra
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
