import React, { useState, useEffect, useMemo } from 'react';
import {
  getAdjustments, addAdjustment, addAdjustmentsBulk, updateAdjustment, deleteAdjustment,
  getPurchaseOrders,
} from './supabaseClient';
import {
  TIPOS, clp, parseItems, montoAjuste, cuentaDeFamilia, ajustesPorFamilia, derivarDeConfirmacion,
} from './calculos';

// ─── FALTANTES Y EXTRAS ──────────────────────────────────────────────────────
// Lo que el proveedor no trae y lo que la familia se lleva de más. Es la pieza
// que conecta la confirmación del proveedor con lo que termina pagando cada
// familia: hasta ahora esa confirmación se registraba y no movía nada.

export function AdminAjustes({ families, sealed, products, period, cargo }) {
  const [ajustes, setAjustes] = useState([]);
  const [ordenes, setOrdenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expand, setExpand] = useState(null);
  const [msg, setMsg] = useState(null);
  const [aplicando, setAplicando] = useState(false);
  const [form, setForm] = useState(null); // { familyId, type, productId, qty, note }
  const [guardando, setGuardando] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [faltaMigracion, setFaltaMigracion] = useState(false);

  useEffect(() => {
    if (!period) { setLoading(false); return; }
    let cancel = false;
    Promise.all([getAdjustments(period.id), getPurchaseOrders(period.id)]).then(([a, o]) => {
      if (cancel) return;
      setFaltaMigracion(a === null);
      setAjustes(a || []); setOrdenes(o); setLoading(false);
    });
    return () => { cancel = true; };
  }, [period]);

  const porFamilia = useMemo(() => ajustesPorFamilia(ajustes), [ajustes]);
  const sealedList = useMemo(() => Object.values(sealed || {}), [sealed]);

  // Qué se puede derivar automáticamente de lo que los proveedores confirmaron,
  // y qué quedó ambiguo y necesita que alguien decida.
  const { pendientes, aRepartir } = useMemo(() => {
    if (!period) return { pendientes: [], aRepartir: [] };
    const todos = [];
    const reparto = [];
    ordenes.filter(o => o.status === 'confirmada').forEach(orden => {
      const d = derivarDeConfirmacion({ orden, sealedOrders: sealedList, period, productos: products });
      todos.push(...d.automaticos);
      reparto.push(...d.aRepartir);
    });
    // Los que ya existen no se vuelven a proponer.
    const yaHay = new Set(ajustes.filter(a => a.type === 'no_confirmado').map(a => a.family_id + '|' + a.product_id));
    return { pendientes: todos.filter(a => !yaHay.has(a.family_id + '|' + a.product_id)), aRepartir: reparto };
  }, [ordenes, sealedList, period, products, ajustes]);

  const aplicarDeProveedores = async () => {
    if (!pendientes.length) return;
    setAplicando(true); setMsg(null);
    const res = await addAdjustmentsBulk(pendientes);
    if (res.error) {
      setMsg({ tipo: 'err', texto: res.error });
    } else {
      const frescos = await getAdjustments(period.id);
      setAjustes(frescos || []);
      const n = Array.isArray(res) ? res.length : pendientes.length;
      setMsg({ tipo: 'ok', texto: 'Se aplicaron ' + n + ' faltante' + (n === 1 ? '' : 's') + ' desde lo que confirmaron los proveedores.' });
    }
    setAplicando(false);
  };

  const abrirForm = (familyId, type) => {
    setForm({ familyId, type, productId: '', qty: '1', note: '' });
    setFormErr('');
  };

  // Para faltantes se elige entre lo que la familia pidió; para extras, de todo
  // el maestro: un extra es justamente algo que no estaba en el pedido.
  const opcionesProducto = (familyId, type) => {
    if (type === 'extra') return products;
    const ord = sealed[familyId];
    const ids = parseItems(ord).filter(i => i.qty > 0).map(i => i.id);
    return products.filter(p => ids.includes(p.id));
  };

  const guardar = async () => {
    if (!form) return;
    const prod = products.find(p => String(p.id) === String(form.productId));
    if (!prod) { setFormErr('Elige un producto'); return; }
    const qty = parseFloat(form.qty);
    if (isNaN(qty) || qty <= 0) { setFormErr('La cantidad debe ser mayor que cero'); return; }

    // No se puede marcar como faltante más de lo que se pidió.
    if (form.type !== 'extra') {
      const item = parseItems(sealed[form.familyId]).find(i => i.id === prod.id);
      const pedido = item ? Number(item.qty) : 0;
      const yaAjustado = (porFamilia.get(form.familyId) || [])
        .filter(a => a.product_id === prod.id && a.type !== 'extra')
        .reduce((s, a) => s + Number(a.qty || 0), 0);
      if (qty + yaAjustado > pedido) {
        setFormErr('Pidió ' + pedido + ' y ya hay ' + yaAjustado + ' registrado. No puedes marcar ' + qty + ' más.');
        return;
      }
    }

    setGuardando(true);
    const ord = sealed[form.familyId];
    const res = await addAdjustment({
      period_id: period.id,
      family_id: form.familyId,
      sealed_order_id: ord ? ord.id : null,
      type: form.type,
      product_id: prod.id,
      product_name: prod.name,
      unit: prod.unit,
      qty,
      unit_price: prod.price,
      amount: montoAjuste(form.type, qty, prod.price),
      source: 'comision',
      note: form.note.trim() || null,
    });
    if (res.error) { setFormErr(res.error); setGuardando(false); return; }
    setAjustes(p => [res, ...p]);
    setForm(null);
    setGuardando(false);
  };

  const borrar = async (adj) => {
    const cfg = TIPOS[adj.type];
    if (!window.confirm('¿Eliminar este ' + (cfg ? cfg.label.toLowerCase() : 'ajuste') + ' de ' + adj.product_name + '?\n\nEl monto de ' + clp(Math.abs(adj.amount)) + ' dejará de aplicarse.')) return;
    const res = await deleteAdjustment(adj.id);
    if (res.error) { alert(res.error); return; }
    setAjustes(p => p.filter(a => a.id !== adj.id));
  };

  const togglePagado = async (adj) => {
    const res = await updateAdjustment(adj.id, { paid: !adj.paid });
    if (res.error) { alert(res.error); return; }
    setAjustes(p => p.map(a => a.id === adj.id ? { ...a, paid: !a.paid } : a));
  };

  if (!period) {
    return (
      <div style={{ background: '#fff8e1', border: '1px solid #ffc107', borderRadius: '10px', padding: '1.25rem' }}>
        <p style={{ fontSize: '13px', color: '#e65100', margin: 0 }}>No hay período activo.</p>
      </div>
    );
  }
  if (loading) return <p style={{ color: '#888', fontSize: '13px' }}>Cargando ajustes...</p>;

  if (faltaMigracion) {
    return (
      <div style={{ background: '#fff8e1', border: '1px solid #ffc107', borderRadius: '10px', padding: '1.25rem' }}>
        <p style={{ fontSize: '13px', fontWeight: 700, color: '#e65100', margin: '0 0 6px' }}>Falta ejecutar la migración</p>
        <p style={{ fontSize: '12px', color: '#666', margin: 0, lineHeight: 1.6 }}>
          La tabla de faltantes y extras todavía no existe en la base. Ejecuta <code>db/migrations/004_ajustes_pedido.sql</code> en Supabase (SQL Editor → Run without RLS) y vuelve a entrar aquí.
        </p>
      </div>
    );
  }

  const conPedido = families.filter(f => sealed[f.id]);
  const totalNoConf = ajustes.filter(a => a.type === 'no_confirmado').reduce((s, a) => s + a.amount, 0);
  const totalFalt = ajustes.filter(a => a.type === 'faltante').reduce((s, a) => s + a.amount, 0);
  const totalExtra = ajustes.filter(a => a.type === 'extra' && !a.paid).reduce((s, a) => s + a.amount, 0);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '1.25rem' }}>
        {[
          { l: 'No confirmados', v: clp(Math.abs(totalNoConf)), c: TIPOS.no_confirmado.color, bg: TIPOS.no_confirmado.bg },
          { l: 'Faltantes', v: clp(Math.abs(totalFalt)), c: TIPOS.faltante.color, bg: TIPOS.faltante.bg },
          { l: 'Extras por cobrar', v: clp(totalExtra), c: TIPOS.extra.color, bg: TIPOS.extra.bg },
          { l: 'Familias afectadas', v: porFamilia.size, c: '#555', bg: '#f5f5f5' },
        ].map(m => (
          <div key={m.l} style={{ padding: '0.9rem', background: m.bg, borderRadius: '8px', textAlign: 'center' }}>
            <p style={{ fontSize: '10px', color: m.c, margin: 0, fontWeight: 600 }}>{m.l}</p>
            <p style={{ fontSize: '17px', fontWeight: 700, margin: '4px 0 0', color: m.c }}>{m.v}</p>
          </div>
        ))}
      </div>

      {/* El plazo limita a las familias, no a la comisión. Conviene que quien
          está en el panel sepa si sigue siendo el único que puede corregir. */}
      {(() => {
        if (!period.date_adjust_until) {
          return (
            <div style={{ background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '10px 13px', marginBottom: '1rem' }}>
              <p style={{ fontSize: '11px', color: '#777', margin: 0, lineHeight: 1.5 }}>
                Sin <strong>límite de ajustes</strong> configurado en el período: las familias pueden registrar faltantes y extras indefinidamente. Ponle fecha en la pestaña Período para poder cerrar el ciclo.
              </p>
            </div>
          );
        }
        const limite = new Date(period.date_adjust_until + 'T23:59:59');
        const cerrada = new Date() > limite;
        const txt = limite.toLocaleDateString('es-CL', { day: 'numeric', month: 'long' });
        return (
          <div style={{ background: cerrada ? '#eceff1' : '#e8f5e9', border: `1px solid ${cerrada ? '#b0bec5' : '#a5d6a7'}`, borderRadius: '8px', padding: '10px 13px', marginBottom: '1rem' }}>
            <p style={{ fontSize: '11px', color: cerrada ? '#455a64' : '#2e7d32', margin: 0, lineHeight: 1.5 }}>
              {cerrada
                ? <>🔒 El plazo de las familias cerró el <strong>{txt}</strong>. Ya no pueden registrar nada por su cuenta — <strong>solo la Comisión Retiro puede corregir desde aquí.</strong></>
                : <>🕑 Las familias pueden registrar sus faltantes y extras hasta el <strong>{txt}</strong>. Después de esa fecha, solo se podrá desde aquí.</>}
            </p>
          </div>
        );
      })()}

      {msg && (
        <div style={{ background: msg.tipo === 'ok' ? '#e8f5e9' : '#ffebee', border: `1px solid ${msg.tipo === 'ok' ? '#81c784' : '#ef9a9a'}`, borderRadius: '8px', padding: '11px 14px', marginBottom: '1rem', display: 'flex', gap: '9px', alignItems: 'flex-start' }}>
          <span>{msg.tipo === 'ok' ? '✓' : '⚠'}</span>
          <p style={{ fontSize: '13px', color: msg.tipo === 'ok' ? '#2e7d32' : '#c62828', margin: 0, fontWeight: 500, lineHeight: 1.5 }}>{msg.texto}</p>
          <button onClick={() => setMsg(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}>✕</button>
        </div>
      )}

      {/* Lo que se puede aplicar solo desde lo que confirmaron los proveedores */}
      {pendientes.length > 0 && (
        <div style={{ background: 'white', border: '2px solid #ffb300', borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}>
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#e65100', margin: '0 0 5px' }}>
            📭 {pendientes.length} faltante{pendientes.length === 1 ? '' : 's'} por aplicar
          </p>
          <p style={{ fontSize: '12px', color: '#666', margin: '0 0 11px', lineHeight: 1.5 }}>
            Los proveedores confirmaron que no traen algunos productos. Al aplicarlos, se descuentan del pedido de cada familia que los había pedido.
          </p>
          <div style={{ maxHeight: '150px', overflowY: 'auto', marginBottom: '11px' }}>
            {pendientes.slice(0, 12).map((p, i) => {
              const fam = families.find(f => f.id === p.family_id);
              return (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '12px', borderBottom: '1px solid #f5f5f5' }}>
                  <span style={{ color: '#444' }}>{(fam && fam.name) || p.family_id} · {p.product_name} <span style={{ color: '#aaa' }}>×{p.qty}</span></span>
                  <span style={{ fontWeight: 600, color: '#c62828', whiteSpace: 'nowrap' }}>− {clp(Math.abs(p.amount))}</span>
                </div>
              );
            })}
            {pendientes.length > 12 && <p style={{ fontSize: '11px', color: '#999', margin: '6px 0 0' }}>y {pendientes.length - 12} más...</p>}
          </div>
          <button onClick={aplicarDeProveedores} disabled={aplicando}
            style={{ width: '100%', padding: '10px', background: '#e65100', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '13px' }}>
            {aplicando ? 'Aplicando...'
              : pendientes.length === 1 ? 'Aplicar el faltante'
              : 'Aplicar los ' + pendientes.length + ' faltantes'}
          </button>
        </div>
      )}

      {/* Entregas parciales: el sistema no decide quién se queda sin su parte */}
      {aRepartir.length > 0 && (
        <div style={{ background: '#fff8e1', border: '1px solid #ffc107', borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}>
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#e65100', margin: '0 0 5px' }}>
            ⚖ {aRepartir.length} entrega{aRepartir.length === 1 ? '' : 's'} parcial{aRepartir.length === 1 ? '' : 'es'} — hay que repartir a mano
          </p>
          <p style={{ fontSize: '12px', color: '#666', margin: '0 0 10px', lineHeight: 1.5 }}>
            El proveedor trae menos de lo pedido. <strong>Quién se queda sin su parte es una decisión de la cooperativa</strong>, no una fórmula, así que el sistema no lo reparte solo. Registra los faltantes que correspondan en cada familia, más abajo.
          </p>
          {aRepartir.map((r, i) => (
            <div key={i} style={{ padding: '8px 11px', background: 'white', borderRadius: '7px', marginBottom: '6px' }}>
              <p style={{ fontSize: '12px', fontWeight: 600, margin: 0, color: '#333' }}>{r.product_name} <span style={{ color: '#888', fontWeight: 400 }}>· {r.proveedor}</span></p>
              <p style={{ fontSize: '11px', color: '#666', margin: '3px 0 0' }}>
                Se pidieron <strong>{r.pedido}</strong>, llegan <strong>{r.llegan}</strong> — <span style={{ color: '#c62828', fontWeight: 600 }}>faltan {r.faltan}</span>.
                Lo pidieron: {r.familias.map(f => { const fam = families.find(x => x.id === f.family_id); return ((fam && fam.name) || f.family_id) + ' (' + f.qty + ')'; }).join(', ')}
              </p>
            </div>
          ))}
        </div>
      )}

      {conPedido.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', background: 'white', borderRadius: '10px', border: '1px solid #dde8dd' }}>
          <p style={{ fontSize: '40px', margin: 0 }}>📦</p>
          <p style={{ color: '#555', fontWeight: 500, margin: '1rem 0 4px' }}>No hay pedidos sellados en este período</p>
          <p style={{ color: '#999', fontSize: '12px', margin: 0 }}>Los faltantes y extras se registran contra un pedido.</p>
        </div>
      )}

      {conPedido.map(f => {
        const ord = sealed[f.id];
        const propios = porFamilia.get(f.id) || [];
        const cuenta = cuentaDeFamilia({ ord, ajustes: propios, cargo, saldo: f.balance || 0 });
        const abierto = expand === f.id;
        const editando = form && form.familyId === f.id;

        return (
          <div key={f.id} style={{ background: 'white', border: `1px solid ${propios.length ? '#ffcc80' : '#dde8dd'}`, borderRadius: '10px', marginBottom: '9px', overflow: 'hidden' }}>
            <div onClick={() => setExpand(abierto ? null : f.id)}
              style={{ padding: '0.9rem 1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#4CAF50', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, flexShrink: 0 }}>{f.initials}</div>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>{f.name}</p>
                  <p style={{ fontSize: '11px', color: '#888', margin: '2px 0 0' }}>
                    Pedido {clp(cuenta.subtotal + cuenta.cargo)}
                    {propios.length > 0 && <span style={{ color: '#e65100', fontWeight: 600 }}> · {propios.length} ajuste{propios.length === 1 ? '' : 's'}</span>}
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                {cuenta.totalAjustes !== 0 && (
                  <span style={{ fontSize: '12px', fontWeight: 700, color: cuenta.totalAjustes < 0 ? '#c62828' : '#1565c0' }}>
                    {cuenta.totalAjustes > 0 ? '+' : ''}{clp(cuenta.totalAjustes)}
                  </span>
                )}
                <span style={{ fontSize: '15px', fontWeight: 700, color: '#2d5a2d' }}>{clp(cuenta.aPagar)}</span>
                <span style={{ fontSize: '12px', color: '#888' }}>{abierto ? '▲' : '▼'}</span>
              </div>
            </div>

            {abierto && (
              <div style={{ borderTop: '1px solid #f0f7f0', padding: '0.9rem 1rem', background: '#fafffe' }}>
                {/* Desglose de la cuenta */}
                <div style={{ marginBottom: '12px' }}>
                  {[
                    { l: 'Subtotal productos', v: cuenta.subtotal, mostrar: true },
                    { l: 'Cargo fijo', v: cuenta.cargo, mostrar: cuenta.cargo > 0 },
                    { l: '📭 No confirmados', v: cuenta.noConfirmados, mostrar: cuenta.noConfirmados !== 0 },
                    { l: '❗ Faltantes', v: cuenta.faltantes, mostrar: cuenta.faltantes !== 0 },
                    { l: '➕ Extras', v: cuenta.extras, mostrar: cuenta.extras !== 0 },
                    { l: 'Saldo anterior', v: -cuenta.saldoAnterior, mostrar: cuenta.saldoAnterior !== 0 },
                  ].filter(r => r.mostrar).map(r => (
                    <div key={r.l} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '12px', borderBottom: '1px solid #f0f7f0' }}>
                      <span style={{ color: '#555' }}>{r.l}</span>
                      <span style={{ fontWeight: 500, color: r.v < 0 ? '#2e7d32' : '#333' }}>{r.v < 0 ? '−' : ''}{clp(Math.abs(r.v))}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', fontSize: '14px', fontWeight: 700, color: '#2d5a2d' }}>
                    <span>Total a pagar</span><span>{clp(cuenta.aPagar)}</span>
                  </div>
                  {cuenta.quedaAFavor > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 0', fontSize: '12px' }}>
                      <span style={{ color: '#2e7d32' }}>Quedará a favor para el próximo período</span>
                      <span style={{ fontWeight: 700, color: '#2e7d32' }}>{clp(cuenta.quedaAFavor)}</span>
                    </div>
                  )}
                </div>

                {/* Ajustes existentes */}
                {propios.map(a => {
                  const cfg = TIPOS[a.type] || {};
                  return (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '8px 10px', background: cfg.bg, borderRadius: '7px', marginBottom: '6px', flexWrap: 'wrap' }}>
                      <span>{cfg.ic}</span>
                      <div style={{ flex: 1, minWidth: '140px' }}>
                        <p style={{ fontSize: '12px', fontWeight: 600, margin: 0, color: '#333' }}>
                          {a.product_name} <span style={{ color: '#888', fontWeight: 400 }}>×{a.qty} {a.unit}</span>
                        </p>
                        <p style={{ fontSize: '10px', color: '#888', margin: '2px 0 0' }}>
                          {cfg.label}
                          {a.source === 'proveedor' && ' · automático desde el proveedor'}
                          {a.note && ' · ' + a.note}
                        </p>
                      </div>
                      {a.type === 'extra' && (
                        <button onClick={() => togglePagado(a)}
                          style={{ fontSize: '10px', padding: '3px 9px', borderRadius: '5px', border: '1px solid', cursor: 'pointer', fontWeight: 600, background: a.paid ? '#e8f5e9' : 'white', borderColor: a.paid ? '#81c784' : '#dde8dd', color: a.paid ? '#2e7d32' : '#888' }}>
                          {a.paid ? '✓ Pagado' : 'Sin pagar'}
                        </button>
                      )}
                      <span style={{ fontSize: '13px', fontWeight: 700, color: cfg.color, whiteSpace: 'nowrap' }}>
                        {a.amount > 0 ? '+' : ''}{clp(a.amount)}
                      </span>
                      <button onClick={() => borrar(a)}
                        style={{ width: '22px', height: '22px', border: '1px solid #ffcdd2', background: '#fff5f5', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', color: '#c62828' }}>✕</button>
                    </div>
                  );
                })}

                {/* Alta de ajuste */}
                {editando ? (
                  <div style={{ background: 'white', border: '1px solid #90caf9', borderRadius: '8px', padding: '11px', marginTop: '9px' }}>
                    <p style={{ fontSize: '12px', fontWeight: 700, color: TIPOS[form.type].color, margin: '0 0 8px' }}>
                      {TIPOS[form.type].ic} {TIPOS[form.type].label} — {TIPOS[form.type].descripcion}
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px', marginBottom: '8px' }}>
                      <select value={form.productId} onChange={e => { setForm(p => ({ ...p, productId: e.target.value })); setFormErr(''); }}
                        style={{ padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '12px' }}>
                        <option value="">— Producto —</option>
                        {opcionesProducto(f.id, form.type).map(p => (
                          <option key={p.id} value={p.id}>{p.name} ({p.unit}) · {clp(p.price)}</option>
                        ))}
                      </select>
                      <input type="number" step="0.5" min="0" placeholder="Cantidad" value={form.qty}
                        onChange={e => { setForm(p => ({ ...p, qty: e.target.value })); setFormErr(''); }}
                        style={{ padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '12px' }} />
                    </div>
                    <input type="text" placeholder="Nota (opcional): llegó en mal estado, se acordó con..., etc."
                      value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))}
                      style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '12px', boxSizing: 'border-box', marginBottom: '8px' }} />
                    {(() => {
                      const prod = products.find(p => String(p.id) === String(form.productId));
                      const q = parseFloat(form.qty);
                      if (!prod || isNaN(q) || q <= 0) return null;
                      const m = montoAjuste(form.type, q, prod.price);
                      return (
                        <div style={{ padding: '7px 10px', background: TIPOS[form.type].bg, borderRadius: '6px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '11px', color: '#555' }}>{m < 0 ? 'Se le descontará' : 'Se le cobrará'}</span>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: TIPOS[form.type].color }}>{m > 0 ? '+' : ''}{clp(m)}</span>
                        </div>
                      );
                    })()}
                    {formErr && <p style={{ fontSize: '11px', color: '#c62828', margin: '0 0 8px', fontWeight: 500 }}>{formErr}</p>}
                    <div style={{ display: 'flex', gap: '7px' }}>
                      <button onClick={guardar} disabled={guardando}
                        style={{ flex: 1, padding: '8px', background: TIPOS[form.type].color, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '12px' }}>
                        {guardando ? 'Guardando...' : 'Registrar'}
                      </button>
                      <button onClick={() => setForm(null)}
                        style={{ padding: '8px 14px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '7px', marginTop: '9px', flexWrap: 'wrap' }}>
                    <button onClick={() => abrirForm(f.id, 'faltante')}
                      style={{ flex: 1, minWidth: '130px', padding: '8px', background: TIPOS.faltante.bg, color: TIPOS.faltante.color, border: `1px solid ${TIPOS.faltante.color}44`, borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                      ❗ Registrar faltante
                    </button>
                    <button onClick={() => abrirForm(f.id, 'extra')}
                      style={{ flex: 1, minWidth: '130px', padding: '8px', background: TIPOS.extra.bg, color: TIPOS.extra.color, border: `1px solid ${TIPOS.extra.color}44`, borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                      ➕ Registrar extra
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
