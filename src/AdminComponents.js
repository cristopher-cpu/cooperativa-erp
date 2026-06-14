import React, { useState, useEffect } from 'react';
import { addFamily, addProduct, updateProduct, updatePeriod, closePeriod, createPeriod, getCashFlow, addCashFlowEntry, deleteCashFlowEntry, markRetired, updateFamilyBalance, updateFamilyPin, getBodega, addBodegaItem, deleteBodegaItem, getBodegaAssignments, addBodegaAssignment, deleteBodegaAssignment } from './supabaseClient';

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

export function AdminDashboard({ families, sealed, cargo, setTab, period }) {
  const [expandedFam, setExpandedFam] = useState(null);
  const sc = Object.keys(sealed).length;
  const ret = Object.values(sealed).filter(o => o.retired).length;
  const tot = Object.values(sealed).reduce((s, o) => s + (o.total || 0) + cargo, 0);
  const pendientes = families.filter(f => !sealed[f.id]);

  const getItems = (ord) => {
    if (!ord) return [];
    try { return Array.isArray(ord.items) ? ord.items : JSON.parse(ord.items); } catch { return []; }
  };

  const metrics = [
    { ic: '✓', l: 'Sellados', v: `${sc}/${families.length}`, c: '#2e7d32', bg: '#e8f5e9', tab: 'pedidos' },
    { ic: '🚚', l: 'Retirados', v: `${ret}/${sc}`, c: ret === sc && sc > 0 ? '#2e7d32' : '#e65100', bg: ret === sc && sc > 0 ? '#e8f5e9' : '#fff3e0', tab: 'retiros' },
    { ic: '⏳', l: 'Pendientes', v: families.length - sc, c: '#888', bg: '#f5f5f5', tab: 'pedidos' },
    { ic: '💰', l: 'Total consolidado', v: '$' + tot.toLocaleString('es-CL'), c: '#1565c0', bg: '#e3f2fd', tab: null },
  ];

  return (
    <div>
      {/* KPIs clickeables */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: '1.5rem' }}>
        {metrics.map(m => (
          <div key={m.l} onClick={() => m.tab && setTab(m.tab)}
            style={{ padding: '1.1rem', background: m.bg, borderRadius: '10px', border: `1px solid ${m.c}22`, textAlign: 'center', cursor: m.tab ? 'pointer' : 'default', transition: 'transform 0.1s' }}
            onMouseEnter={e => m.tab && (e.currentTarget.style.transform = 'scale(1.02)')}
            onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}>
            <span style={{ fontSize: '20px', display: 'block', marginBottom: '5px' }}>{m.ic}</span>
            <p style={{ fontSize: '10px', color: '#666', margin: 0, fontWeight: 500 }}>{m.l}</p>
            <p style={{ fontSize: '20px', fontWeight: 700, margin: '4px 0 0', color: m.c }}>{m.v}</p>
            {m.tab && <p style={{ fontSize: '10px', color: m.c, margin: '4px 0 0', opacity: 0.7 }}>Ver detalle →</p>}
          </div>
        ))}
      </div>

      {/* Pedidos sellados - resumen rápido */}
      {sc > 0 && (
        <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #dde8dd', padding: '1rem', marginBottom: '1rem' }}>
          <p style={{ fontSize: '12px', fontWeight: 700, color: '#333', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pedidos sellados</p>
          {Object.entries(sealed).map(([fid, ord]) => {
            const fam = families.find(f => f.id === fid);
            if (!fam) return null;
            const items = getItems(ord);
            const isExpanded = expandedFam === fid;
            return (
              <div key={fid} style={{ borderBottom: '1px solid #f0f7f0', paddingBottom: '8px', marginBottom: '8px' }}>
                <div onClick={() => setExpandedFam(isExpanded ? null : fid)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '4px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#4CAF50', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700 }}>{fam.initials}</div>
                    <div>
                      <p style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>{fam.name}</p>
                      <p style={{ fontSize: '10px', color: '#888', margin: 0 }}>Sellado {new Date(ord.sealed_at).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '6px', background: ord.retired ? '#e8f5e9' : '#e3f2fd', color: ord.retired ? '#2e7d32' : '#1565c0' }}>
                      {ord.retired ? '✓ Retirado' : '📦 Sellado'} · ${(ord.total + cargo).toLocaleString('es-CL')}
                    </span>
                    <span style={{ fontSize: '12px', color: '#888' }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>
                {isExpanded && (
                  <div style={{ marginTop: '8px', paddingLeft: '36px' }}>
                    {items.filter(i => i.qty > 0).map(i => (
                      <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '12px', borderBottom: '1px solid #f9f9f9' }}>
                        <span style={{ color: '#444' }}>{i.n} <span style={{ color: '#aaa' }}>×{i.qty}</span></span>
                        <span style={{ fontWeight: 500 }}>${(i.p * i.qty).toLocaleString('es-CL')}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 2px', fontSize: '12px' }}>
                      <span style={{ color: '#666' }}>Cargo fijo</span>
                      <span style={{ fontWeight: 500 }}>${cargo.toLocaleString('es-CL')}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0 0', fontSize: '13px' }}>
                      <span style={{ fontWeight: 700, color: '#2d5a2d' }}>Total</span>
                      <span style={{ fontWeight: 700, color: '#2d5a2d' }}>${(ord.total + cargo).toLocaleString('es-CL')}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pendientes */}
      {pendientes.length > 0 && (
        <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #dde8dd', padding: '1rem' }}>
          <p style={{ fontSize: '12px', fontWeight: 700, color: '#e65100', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sin pedido ({pendientes.length})</p>
          {pendientes.map(f => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid #f0f7f0' }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#bdbdbd', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700 }}>{f.initials}</div>
              <span style={{ fontSize: '12px', color: '#555' }}>{f.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── PEDIDOS ─────────────────────────────────────────────────────────────────

export function AdminPedidos({ families, sealed, cargo, onHacerPedido, period }) {
  const [expandedFam, setExpandedFam] = useState(null);
  const [srch, setSrch] = useState('');
  const [statusFilter, setStatusFilter] = useState('todos');
  const sc = Object.keys(sealed).length;

  const getItems = (ord) => {
    try { return Array.isArray(ord.items) ? ord.items : JSON.parse(ord.items); } catch { return []; }
  };

  const filteredFamilies = families
    .filter(f => !srch || f.name.toLowerCase().includes(srch.toLowerCase()))
    .filter(f => {
      if (statusFilter === 'sellados') return !!sealed[f.id];
      if (statusFilter === 'pendientes') return !sealed[f.id];
      return true;
    });

  return (
    <div>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="text" placeholder="Buscar familia..." value={srch} onChange={e => setSrch(e.target.value)}
          style={{ flex: 1, minWidth: '150px', padding: '7px 12px', border: '1px solid #dde8dd', borderRadius: '8px', fontSize: '13px' }} />
        <div style={{ display: 'flex', gap: '6px' }}>
          {['todos', 'sellados', 'pendientes'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              style={{ padding: '6px 12px', borderRadius: '20px', border: '1px solid', cursor: 'pointer', fontSize: '11px', fontWeight: statusFilter === s ? 700 : 400, background: statusFilter === s ? '#1565c0' : 'white', borderColor: statusFilter === s ? '#1565c0' : '#dde8dd', color: statusFilter === s ? 'white' : '#555', textTransform: 'capitalize' }}>
              {s === 'todos' ? `Todos (${families.length})` : s === 'sellados' ? `Sellados (${sc})` : `Pendientes (${families.length - sc})`}
            </button>
          ))}
        </div>
      </div>

      {filteredFamilies.map(f => {
        const o = sealed[f.id];
        const isExp = expandedFam === f.id;
        const items = o ? getItems(o) : [];
        return (
          <div key={f.id} style={{ background: 'white', border: '1px solid #dde8dd', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' }}>
            <div onClick={() => o && setExpandedFam(isExp ? null : f.id)}
              style={{ padding: '0.9rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: o ? 'pointer' : 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: o ? '#4CAF50' : '#bdbdbd', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700 }}>{f.initials}</div>
                <div>
                  <p style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>{f.name}</p>
                  <p style={{ fontSize: '11px', color: '#888', margin: '2px 0 0' }}>
                    {o ? `Sellado ${new Date(o.sealed_at).toLocaleString('es-CL')}` : 'Sin pedido'}
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {o ? (
                  <>
                    <span style={{ fontSize: '11px', fontWeight: 600, padding: '4px 8px', borderRadius: '6px', background: o.retired ? '#e8f5e9' : '#e3f2fd', color: o.retired ? '#2e7d32' : '#1565c0' }}>
                      ${(o.total + cargo).toLocaleString('es-CL')}
                    </span>
                    <span style={{ fontSize: '11px', color: '#888' }}>{isExp ? '▲' : '▼'}</span>
                  </>
                ) : (
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <span style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '6px', background: '#f5f5f5', color: '#999' }}>Pendiente</span>
                    {period?.active && (
                      <button onClick={() => onHacerPedido(f)}
                        style={{ fontSize: '10px', padding: '4px 10px', background: '#1565c0', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>
                        Hacer pedido
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {isExp && o && (
              <div style={{ borderTop: '1px solid #f0f7f0', padding: '0.75rem 1rem', background: '#fafffe' }}>
                {items.filter(i => i.qty > 0).map(i => (
                  <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f0f7f0', fontSize: '12px' }}>
                    <span style={{ color: '#333', fontWeight: 500 }}>{i.n}</span>
                    <span style={{ color: '#555' }}>{i.u} × {i.qty} = <strong>${(i.p * i.qty).toLocaleString('es-CL')}</strong></span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '12px', color: '#666', borderBottom: '1px solid #f0f7f0' }}>
                  <span>Cargo fijo</span><span>${cargo.toLocaleString('es-CL')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 4px', fontSize: '13px', fontWeight: 700, color: '#2d5a2d' }}>
                  <span>Total</span><span>${(o.total + cargo).toLocaleString('es-CL')}</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── RETIROS ─────────────────────────────────────────────────────────────────

export function AdminRetiros({ families, sealed, cargo, setSealed }) {
  const [expandedFam, setExpandedFam] = useState(null);
  const ret = Object.values(sealed).filter(o => o.retired).length;
  const sc = Object.keys(sealed).length;

  const getItems = (ord) => {
    try { return Array.isArray(ord.items) ? ord.items : JSON.parse(ord.items); } catch { return []; }
  };

  const markRet = async (fid, ordId) => {
    await markRetired(ordId);
    setSealed(p => ({ ...p, [fid]: { ...p[fid], retired: true, retired_at: new Date().toISOString() } }));
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '1.5rem' }}>
        {[{ l: 'Retirados', v: ret, c: '#2e7d32', bg: '#e8f5e9' }, { l: 'Pendientes', v: sc - ret, c: '#e65100', bg: '#fff3e0' }, { l: 'Sin pedido', v: families.length - sc, c: '#888', bg: '#f5f5f5' }].map(m => (
          <div key={m.l} style={{ padding: '0.9rem', background: m.bg, borderRadius: '8px', textAlign: 'center' }}>
            <p style={{ fontSize: '10px', color: m.c, margin: 0, fontWeight: 600 }}>{m.l}</p>
            <p style={{ fontSize: '22px', fontWeight: 700, margin: '4px 0 0', color: m.c }}>{m.v}</p>
          </div>
        ))}
      </div>

      {families.map(f => {
        const o = sealed[f.id];
        if (!o) return null;
        const isExp = expandedFam === f.id;
        const items = getItems(o);
        return (
          <div key={f.id} style={{ background: 'white', border: `1px solid ${o.retired ? '#c8e6c9' : '#dde8dd'}`, borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' }}>
            <div onClick={() => setExpandedFam(isExp ? null : f.id)}
              style={{ padding: '0.9rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: o.retired ? '#4CAF50' : '#ff9800', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700 }}>{f.initials}</div>
                <div>
                  <p style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>{f.name}</p>
                  <p style={{ fontSize: '11px', color: '#888', margin: '2px 0 0' }}>
                    {o.retired ? `Retirado ${new Date(o.retired_at).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : `Total: $${(o.total + cargo).toLocaleString('es-CL')}`}
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {!o.retired && (
                  <button onClick={e => { e.stopPropagation(); markRet(f.id, o.id); }}
                    style={{ padding: '5px 12px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}>
                    ✓ Marcar retirado
                  </button>
                )}
                {o.retired && <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '6px', background: '#e8f5e9', color: '#2e7d32' }}>✓ Retirado</span>}
                <span style={{ fontSize: '11px', color: '#888' }}>{isExp ? '▲' : '▼'}</span>
              </div>
            </div>

            {isExp && (
              <div style={{ borderTop: '1px solid #f0f7f0', padding: '0.75rem 1rem', background: '#fafffe' }}>
                {items.filter(i => i.qty > 0).map(i => (
                  <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f0f7f0', fontSize: '12px' }}>
                    <span style={{ color: '#333', fontWeight: 500 }}>{i.n}</span>
                    <span style={{ color: '#555' }}>{i.u} × {i.qty} = <strong>${(i.p * i.qty).toLocaleString('es-CL')}</strong></span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 4px', fontSize: '12px', color: '#666', borderBottom: '1px solid #f0f7f0' }}>
                  <span>Cargo fijo</span><span>${cargo.toLocaleString('es-CL')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 4px', fontSize: '13px', fontWeight: 700, color: '#2d5a2d' }}>
                  <span>Total</span><span>${(o.total + cargo).toLocaleString('es-CL')}</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── FLUJO DE CAJA ────────────────────────────────────────────────────────────

export function AdminFlujoCaja({ period, setPeriod, cargo, families, setFamilies }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(!!period);
  const [showForm, setShowForm] = useState(false);
  const emptyForm = { type: 'ingreso', description: '', amount: '', date: new Date().toISOString().split('T')[0], family_id: '' };
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [editCargo, setEditCargo] = useState(false);
  const [cargoVal, setCargoVal] = useState(cargo.toString());
  const [savingCargo, setSavingCargo] = useState(false);
  const [err, setErr] = useState('');
  const [cashFlowError, setCashFlowError] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const fams = (families || []).filter(f => f.role === 'familia');

  useEffect(() => {
    if (!period) return;
    getCashFlow(period.id).then(data => {
      if (Array.isArray(data)) {
        setEntries(data);
      } else {
        setCashFlowError(true);
      }
      setLoading(false);
    }).catch(() => {
      setCashFlowError(true);
      setLoading(false);
    });
  }, [period]);

  const ingresos = entries.filter(e => e.type === 'ingreso').reduce((s, e) => s + (e.amount || 0), 0);
  const egresos = entries.filter(e => e.type === 'egreso').reduce((s, e) => s + (e.amount || 0), 0);
  const balance = ingresos - egresos;

  const selectedFam = fams.find(f => f.id === form.family_id);
  const newBalancePreview = selectedFam && form.amount
    ? (selectedFam.balance || 0) + (form.type === 'ingreso' ? parseInt(form.amount) || 0 : -(parseInt(form.amount) || 0))
    : null;

  const handleAdd = async () => {
    if (!form.description.trim() || !form.amount) { setErr('Descripción y monto son obligatorios'); return; }
    setSaving(true);
    setErr('');

    const entry = {
      id: Date.now().toString(),
      period_id: period.id,
      type: form.type,
      description: form.description.trim(),
      amount: parseInt(form.amount),
      date: form.date,
      family_id: form.family_id || null,
      family_name: selectedFam ? selectedFam.name : null,
    };

    const result = await addCashFlowEntry(entry);
    if (result) {
      setEntries(p => [result, ...p]);

      // Si hay familia asignada, actualizar su saldo inmediatamente
      if (form.family_id && selectedFam) {
        const delta = form.type === 'ingreso' ? parseInt(form.amount) : -(parseInt(form.amount));
        const nuevoSaldo = (selectedFam.balance || 0) + delta;
        await updateFamilyBalance(form.family_id, nuevoSaldo);
        if (setFamilies) {
          setFamilies(p => p.map(f => f.id === form.family_id ? { ...f, balance: nuevoSaldo } : f));
        }
        setSuccessMsg(`Saldo de ${selectedFam.name} actualizado a $${nuevoSaldo.toLocaleString('es-CL')}`);
        setTimeout(() => setSuccessMsg(''), 4000);
      }

      setForm(emptyForm);
      setShowForm(false);
    } else {
      setErr('Error al guardar. Verifica que la tabla cash_flow existe en Supabase.');
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    await deleteCashFlowEntry(id);
    setEntries(p => p.filter(e => e.id !== id));
  };

  const saveCargo = async () => {
    setSavingCargo(true);
    const val = parseInt(cargoVal) || 0;
    await updatePeriod(period.id, { fixed_charge: val });
    setPeriod(p => ({ ...p, fixed_charge: val }));
    setEditCargo(false);
    setSavingCargo(false);
  };

  return (
    <div>
      {/* Cargo fijo */}
      <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #dde8dd', padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p style={{ fontSize: '11px', color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Cargo fijo por familia</p>
            {!editCargo && <p style={{ fontSize: '22px', fontWeight: 700, margin: '4px 0 0', color: '#1565c0' }}>${cargo.toLocaleString('es-CL')}</p>}
          </div>
          {!editCargo
            ? <button onClick={() => { setEditCargo(true); setCargoVal(cargo.toString()); }}
                style={{ padding: '6px 14px', background: '#e3f2fd', color: '#1565c0', border: '1px solid #90caf9', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>Cambiar</button>
            : (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: '#555' }}>$</span>
                <input type="number" value={cargoVal} onChange={e => setCargoVal(e.target.value)}
                  style={{ width: '110px', padding: '6px 8px', border: '1px solid #4CAF50', borderRadius: '6px', fontSize: '14px', fontWeight: 700, textAlign: 'right' }} />
                <button onClick={saveCargo} disabled={savingCargo}
                  style={{ padding: '6px 12px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>{savingCargo ? '...' : '✓ Guardar'}</button>
                <button onClick={() => setEditCargo(false)}
                  style={{ padding: '6px 10px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
              </div>
            )
          }
        </div>
        <p style={{ fontSize: '11px', color: '#aaa', margin: '8px 0 0' }}>Este cargo se aplica a todas las familias en el período {period?.label}</p>
      </div>

      {/* Mensaje de éxito */}
      {successMsg && (
        <div style={{ background: '#e8f5e9', border: '1px solid #81c784', borderRadius: '8px', padding: '10px 14px', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>✓</span>
          <p style={{ fontSize: '13px', color: '#2e7d32', fontWeight: 500, margin: 0 }}>{successMsg}</p>
        </div>
      )}

      {/* Resumen flujo */}
      {!cashFlowError && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '1rem' }}>
            {[{ l: 'Ingresos', v: ingresos, c: '#2e7d32', bg: '#e8f5e9' }, { l: 'Egresos', v: egresos, c: '#c62828', bg: '#ffebee' }, { l: 'Balance', v: balance, c: balance >= 0 ? '#2e7d32' : '#c62828', bg: balance >= 0 ? '#e8f5e9' : '#ffebee' }].map(m => (
              <div key={m.l} style={{ padding: '0.9rem', background: m.bg, borderRadius: '8px', textAlign: 'center' }}>
                <p style={{ fontSize: '10px', color: m.c, margin: 0, fontWeight: 600 }}>{m.l}</p>
                <p style={{ fontSize: '16px', fontWeight: 700, margin: '4px 0 0', color: m.c }}>${Math.abs(m.v).toLocaleString('es-CL')}</p>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <p style={{ fontSize: '13px', fontWeight: 600, color: '#333', margin: 0 }}>Movimientos — {period?.label}</p>
            <button onClick={() => { setShowForm(true); setForm(emptyForm); setErr(''); }}
              style={{ padding: '6px 14px', background: '#1565c0', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>+ Registrar movimiento</button>
          </div>

          {showForm && (
            <div style={{ background: 'white', border: '1px solid #90caf9', borderRadius: '10px', padding: '1.25rem', marginBottom: '1rem' }}>
              <p style={{ fontSize: '13px', fontWeight: 700, color: '#1565c0', margin: '0 0 1rem' }}>Nuevo movimiento</p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Tipo *</label>
                  <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value, family_id: '' }))}
                    style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '13px' }}>
                    <option value="ingreso">↑ Ingreso (pago recibido)</option>
                    <option value="egreso">↓ Egreso (gasto / compra)</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Fecha *</label>
                  <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                    style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }} />
                </div>

                {/* Selector de familia — visible siempre, clave para ingresos */}
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>
                    Familia asociada {form.type === 'ingreso' ? <span style={{ color: '#1565c0', fontWeight: 600 }}>— aplica el monto directamente a su saldo</span> : <span style={{ color: '#aaa' }}>(opcional)</span>}
                  </label>
                  <select value={form.family_id} onChange={e => setForm(p => ({ ...p, family_id: e.target.value }))}
                    style={{ width: '100%', padding: '7px', border: `1px solid ${form.type === 'ingreso' ? '#90caf9' : '#dde8dd'}`, borderRadius: '6px', fontSize: '13px', background: form.type === 'ingreso' ? '#f8fbff' : 'white' }}>
                    <option value="">Sin familia específica</option>
                    {fams.map(f => (
                      <option key={f.id} value={f.id}>
                        {f.name} — Saldo actual: {f.balance > 0 ? '+' : ''}${(f.balance || 0).toLocaleString('es-CL')}
                      </option>
                    ))}
                  </select>

                  {/* Preview del nuevo saldo */}
                  {selectedFam && form.amount && (
                    <div style={{ marginTop: '6px', padding: '8px 12px', background: newBalancePreview >= 0 ? '#e8f5e9' : '#ffebee', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', color: '#555' }}>Nuevo saldo de {selectedFam.name}</span>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: newBalancePreview >= 0 ? '#2e7d32' : '#c62828' }}>
                        {newBalancePreview >= 0 ? '+' : ''}${(newBalancePreview || 0).toLocaleString('es-CL')}
                      </span>
                    </div>
                  )}
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Descripción *</label>
                  <input type="text"
                    placeholder={form.type === 'ingreso' ? 'Ej: Pago cuota Junio, Abono saldo...' : 'Ej: Compra proveedor Bio, Flete...'}
                    value={form.description}
                    onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }} />
                </div>

                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Monto CLP *</label>
                  <input type="number" placeholder="0" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                    style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '14px', fontWeight: 600, boxSizing: 'border-box' }} />
                </div>
              </div>

              {err && <p style={{ fontSize: '12px', color: '#c62828', margin: '0 0 10px' }}>{err}</p>}

              {/* Resumen de acción antes de guardar */}
              {form.amount && form.description && (
                <div style={{ background: form.type === 'ingreso' ? '#e8f5e9' : '#fff8e1', border: `1px solid ${form.type === 'ingreso' ? '#c8e6c9' : '#ffe082'}`, borderRadius: '8px', padding: '10px 12px', marginBottom: '12px' }}>
                  <p style={{ fontSize: '12px', color: '#555', margin: 0 }}>
                    <strong>Resumen:</strong>{' '}
                    {form.type === 'ingreso' ? 'Se registrará ingreso de' : 'Se registrará egreso de'}{' '}
                    <strong>${(parseInt(form.amount) || 0).toLocaleString('es-CL')}</strong>
                    {selectedFam ? <> y se <strong>actualizará el saldo de {selectedFam.name}</strong> de ${(selectedFam.balance || 0).toLocaleString('es-CL')} a <strong style={{ color: newBalancePreview >= 0 ? '#2e7d32' : '#c62828' }}>${(newBalancePreview || 0).toLocaleString('es-CL')}</strong></> : ' sin afectar saldo de ninguna familia'}.
                  </p>
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleAdd} disabled={saving}
                  style={{ flex: 1, padding: '9px', background: '#1565c0', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '13px' }}>
                  {saving ? 'Guardando...' : form.family_id ? `✓ Registrar y actualizar saldo` : '✓ Registrar movimiento'}
                </button>
                <button onClick={() => { setShowForm(false); setErr(''); }}
                  style={{ padding: '9px 16px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Cancelar</button>
              </div>
            </div>
          )}

          {loading ? (
            <p style={{ color: '#888', fontSize: '13px' }}>Cargando movimientos...</p>
          ) : entries.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', background: 'white', borderRadius: '8px', border: '1px solid #dde8dd' }}>
              <p style={{ color: '#aaa', fontSize: '13px', margin: 0 }}>Sin movimientos registrados para este período</p>
            </div>
          ) : (
            entries.map(e => {
              const entryFam = fams.find(f => f.id === e.family_id);
              return (
                <div key={e.id} style={{ background: 'white', border: `1px solid ${e.type === 'ingreso' ? '#c8e6c9' : '#ffcdd2'}`, borderRadius: '8px', padding: '0.8rem 1rem', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '10px', background: e.type === 'ingreso' ? '#e8f5e9' : '#ffebee', color: e.type === 'ingreso' ? '#2e7d32' : '#c62828' }}>
                        {e.type === 'ingreso' ? '↑ Ingreso' : '↓ Egreso'}
                      </span>
                      {(entryFam || e.family_name) && (
                        <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '10px', background: '#e3f2fd', color: '#1565c0' }}>
                          {entryFam ? entryFam.name : e.family_name}
                        </span>
                      )}
                      <span style={{ fontSize: '11px', color: '#aaa' }}>
                        {new Date(e.date).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                    <p style={{ fontSize: '13px', fontWeight: 500, margin: '4px 0 0', color: '#333' }}>{e.description}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: '8px' }}>
                    <span style={{ fontSize: '15px', fontWeight: 700, color: e.type === 'ingreso' ? '#2e7d32' : '#c62828', whiteSpace: 'nowrap' }}>
                      {e.type === 'ingreso' ? '+' : '-'}${(e.amount || 0).toLocaleString('es-CL')}
                    </span>
                    <button onClick={() => handleDelete(e.id)}
                      style={{ width: '24px', height: '24px', border: '1px solid #ffcdd2', background: '#fff5f5', borderRadius: '5px', cursor: 'pointer', fontSize: '12px', color: '#c62828', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
                  </div>
                </div>
              );
            })
          )}
        </>
      )}

      {cashFlowError && (
        <div style={{ background: '#fff8e1', border: '1px solid #ffc107', borderRadius: '8px', padding: '1rem' }}>
          <p style={{ fontSize: '13px', color: '#e65100', fontWeight: 600, margin: 0 }}>⚠ Tabla cash_flow no disponible aún</p>
          <p style={{ fontSize: '12px', color: '#666', margin: '6px 0 0' }}>Pendiente de creación en Supabase. El cargo fijo puede configurarse desde aquí igualmente.</p>
        </div>
      )}
    </div>
  );
}

// ─── FAMILIAS ─────────────────────────────────────────────────────────────────

export function AdminFamilias({ families, setFamilies, sealed, onHacerPedido }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', balance: '0' });
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [srch, setSrch] = useState('');
  const [pinEditId, setPinEditId] = useState(null);
  const [pinVal, setPinVal] = useState('');
  const [pinSaving, setPinSaving] = useState(false);

  const handleAdd = async () => {
    if (!form.name.trim()) { setErr('El nombre es obligatorio'); return; }
    if (!form.email.includes('@')) { setErr('Email inválido'); return; }
    setLoading(true);
    const newFamily = {
      id: Date.now().toString(),
      name: form.name.trim(),
      initials: form.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase(),
      balance: parseInt(form.balance) || 0,
      role: 'familia',
      email: form.email.trim()
    };
    const result = await addFamily(newFamily);
    if (result) {
      setFamilies(p => [...p, newFamily]);
      setForm({ name: '', email: '', balance: '0' });
      setErr('');
      setShowForm(false);
    } else {
      setErr('Error al agregar familia');
    }
    setLoading(false);
  };

  const savePinFor = async (fid) => {
    setPinSaving(true);
    await updateFamilyPin(fid, pinVal.trim() || null);
    setFamilies(p => p.map(f => f.id === fid ? { ...f, pin: pinVal.trim() || null } : f));
    setPinEditId(null);
    setPinVal('');
    setPinSaving(false);
  };

  const clearPinFor = async (fid) => {
    await updateFamilyPin(fid, null);
    setFamilies(p => p.map(f => f.id === fid ? { ...f, pin: null } : f));
  };

  const na = families.filter(f => f.role === 'familia');
  const filtered = na.filter(f => !srch || f.name.toLowerCase().includes(srch.toLowerCase()));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <p style={{ fontSize: '13px', fontWeight: 500, color: '#666', margin: 0 }}>{na.length} familias registradas</p>
        {!showForm && <button onClick={() => setShowForm(true)} style={{ padding: '6px 14px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>+ Nueva familia</button>}
      </div>

      <input type="text" placeholder="Buscar familia por nombre..." value={srch} onChange={e => setSrch(e.target.value)}
        style={{ width: '100%', padding: '7px 12px', border: '1px solid #dde8dd', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box', marginBottom: '1rem' }} />

      {showForm && (
        <div style={{ padding: '1rem', background: 'white', border: '1px solid #c8e6c9', borderRadius: '8px', marginBottom: '1rem' }}>
          <p style={{ fontWeight: 600, fontSize: '14px', color: '#2e7d32', margin: '0 0 1rem' }}>Nueva familia</p>
          <div style={{ display: 'grid', gap: '10px', marginBottom: '1rem' }}>
            {[{ k: 'name', l: 'Nombre completo *', t: 'text', ph: 'Ej: Familia González' }, { k: 'email', l: 'Correo electrónico *', t: 'email', ph: 'correo@ejemplo.com' }, { k: 'balance', l: 'Saldo inicial', t: 'number', ph: '0' }].map(f => (
              <div key={f.k}>
                <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>{f.l}</label>
                <input type={f.t} placeholder={f.ph} value={form[f.k]} onChange={e => setForm(p => ({ ...p, [f.k]: e.target.value }))}
                  style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', boxSizing: 'border-box' }} />
              </div>
            ))}
          </div>
          {err && <p style={{ fontSize: '12px', color: '#c62828', margin: '0 0 10px' }}>{err}</p>}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleAdd} disabled={loading} style={{ flex: 1, padding: '7px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>{loading ? 'Guardando...' : 'Agregar'}</button>
            <button onClick={() => { setShowForm(false); setErr(''); }} style={{ flex: 1, padding: '7px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Cancelar</button>
          </div>
        </div>
      )}

      {filtered.map(f => (
        <div key={f.id} style={{ background: 'white', border: '1px solid #dde8dd', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' }}>
          <div style={{ padding: '0.9rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#4CAF50', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, flexShrink: 0 }}>{f.initials}</div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>{f.name}</p>
                <p style={{ fontSize: '11px', color: '#888', margin: 0 }}>{f.email}</p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              {sealed[f.id]
                ? <span style={{ fontSize: '10px', fontWeight: 600, padding: '3px 7px', borderRadius: '6px', background: sealed[f.id].retired ? '#e8f5e9' : '#e3f2fd', color: sealed[f.id].retired ? '#2e7d32' : '#1565c0' }}>{sealed[f.id].retired ? '✓ Entregado' : '✓ Sellado'}</span>
                : (
                  <button onClick={() => onHacerPedido(f)}
                    style={{ fontSize: '10px', padding: '4px 10px', background: '#1565c0', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>
                    Hacer pedido
                  </button>
                )
              }
              {f.balance !== 0 && <p style={{ fontSize: '11px', margin: 0, color: f.balance > 0 ? '#2e7d32' : '#c62828', fontWeight: 600 }}>{f.balance > 0 ? '+' : ''}${Math.abs(f.balance).toLocaleString('es-CL')}</p>}
            </div>
          </div>

          {/* PIN management */}
          <div style={{ padding: '0.5rem 1rem', background: '#f9fafb', borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '10px', color: '#aaa' }}>🔒</span>
            {pinEditId === f.id ? (
              <>
                <input type="text" inputMode="numeric" maxLength={6} placeholder="Ingresa PIN numérico" value={pinVal}
                  onChange={e => setPinVal(e.target.value.replace(/[^0-9]/g, ''))}
                  style={{ flex: 1, padding: '4px 8px', border: '1px solid #4CAF50', borderRadius: '5px', fontSize: '12px' }} />
                <button onClick={() => savePinFor(f.id)} disabled={pinSaving}
                  style={{ padding: '3px 10px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}>
                  {pinSaving ? '...' : '✓'}
                </button>
                <button onClick={() => { setPinEditId(null); setPinVal(''); }}
                  style={{ padding: '3px 8px', background: 'white', border: '1px solid #dde8dd', borderRadius: '5px', cursor: 'pointer', fontSize: '11px' }}>✕</button>
              </>
            ) : (
              <>
                <span style={{ fontSize: '11px', color: f.pin ? '#2e7d32' : '#aaa', fontWeight: f.pin ? 600 : 400 }}>
                  {f.pin ? `PIN configurado (${f.pin.length} dígitos)` : 'Sin PIN — acceso libre'}
                </span>
                <button onClick={() => { setPinEditId(f.id); setPinVal(f.pin || ''); }}
                  style={{ marginLeft: 'auto', padding: '2px 8px', background: 'white', border: '1px solid #dde8dd', borderRadius: '5px', cursor: 'pointer', fontSize: '10px', color: '#555' }}>
                  {f.pin ? 'Cambiar' : 'Asignar PIN'}
                </button>
                {f.pin && (
                  <button onClick={() => clearPinFor(f.id)}
                    style={{ padding: '2px 8px', background: '#fff5f5', border: '1px solid #ffcdd2', borderRadius: '5px', cursor: 'pointer', fontSize: '10px', color: '#c62828' }}>
                    Quitar
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── PRODUCTOS ────────────────────────────────────────────────────────────────

export function AdminProductos({ products, setProducts }) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: '', category: 'Cereales', price: '', unit: '', provider: '', in_stock: true });
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [srch, setSrch] = useState('');

  const CATS = ['Cereales', 'Legumbres', 'Semillas', 'Harinas', 'Té y Café', 'Aceites', 'Aseo', 'Dulces', 'Pan', 'Miel', 'Aliños'];

  const handleSaveNew = async () => {
    if (!form.name.trim() || !form.price || !form.unit || !form.provider) { setErr('Todos los campos son obligatorios'); return; }
    setLoading(true);
    const newProduct = { id: Math.max(...products.map(p => p.id), 0) + 1, name: form.name.trim(), category: form.category, price: parseInt(form.price), unit: form.unit.trim(), provider: form.provider.trim(), in_stock: form.in_stock };
    const result = await addProduct(newProduct);
    if (result) {
      setProducts(p => [...p, newProduct]);
      setForm({ name: '', category: 'Cereales', price: '', unit: '', provider: '', in_stock: true });
      setErr(''); setShowForm(false);
    } else { setErr('Error al agregar producto'); }
    setLoading(false);
  };

  const handleEdit = async () => {
    if (!form.name.trim() || !form.price || !form.unit || !form.provider) { setErr('Todos los campos son obligatorios'); return; }
    setLoading(true);
    const updates = { name: form.name.trim(), category: form.category, price: parseInt(form.price), unit: form.unit.trim(), provider: form.provider.trim(), in_stock: form.in_stock };
    const result = await updateProduct(editId, updates);
    if (result) {
      setProducts(p => p.map(x => x.id === editId ? { ...x, ...updates } : x));
      setEditId(null); setErr('');
    } else { setErr('Error al actualizar producto'); }
    setLoading(false);
  };

  const toggleStock = async (id) => {
    const pr = products.find(p => p.id === id);
    const result = await updateProduct(id, { in_stock: !pr.in_stock });
    if (result) setProducts(p => p.map(x => x.id === id ? { ...x, in_stock: !x.in_stock } : x));
  };

  const startEdit = (pr) => {
    setEditId(pr.id);
    setForm({ name: pr.name, category: pr.category, price: pr.price, unit: pr.unit, provider: pr.provider, in_stock: pr.in_stock });
    setShowForm(false);
  };

  const vis = products.filter(p => !srch || p.name.toLowerCase().includes(srch.toLowerCase()));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <p style={{ fontSize: '13px', fontWeight: 500, color: '#666', margin: 0 }}>{products.length} productos</p>
        {!showForm && !editId && <button onClick={() => { setShowForm(true); setErr(''); }} style={{ padding: '6px 14px', background: '#1565c0', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>+ Nuevo producto</button>}
      </div>

      {(showForm || editId) && (
        <div style={{ padding: '1rem', background: 'white', border: `1px solid ${editId ? '#ffa726' : '#90caf9'}`, borderRadius: '8px', marginBottom: '1rem' }}>
          <p style={{ fontWeight: 600, fontSize: '14px', color: editId ? '#e65100' : '#1565c0', margin: '0 0 1rem' }}>{editId ? 'Editar' : 'Nuevo'} producto</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '1rem' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Nombre *</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Categoría</label>
              <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px' }}>
                {CATS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Proveedor *</label>
              <input type="text" value={form.provider} onChange={e => setForm(p => ({ ...p, provider: e.target.value }))} style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Precio CLP *</label>
              <input type="number" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Unidad *</label>
              <input type="text" placeholder="Kg, 500 gr, un..." value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))} style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" id="stock" checked={form.in_stock} onChange={e => setForm(p => ({ ...p, in_stock: e.target.checked }))} />
              <label htmlFor="stock" style={{ fontSize: '13px', cursor: 'pointer', margin: 0 }}>Con stock</label>
            </div>
          </div>
          {err && <p style={{ fontSize: '12px', color: '#c62828', margin: '0 0 10px' }}>{err}</p>}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={editId ? handleEdit : handleSaveNew} disabled={loading} style={{ flex: 1, padding: '7px', background: editId ? '#e65100' : '#1565c0', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>{loading ? 'Guardando...' : editId ? 'Actualizar' : 'Agregar'}</button>
            <button onClick={() => { setShowForm(false); setEditId(null); setErr(''); }} style={{ flex: 1, padding: '7px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Cancelar</button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: '1rem' }}>
        <input type="text" placeholder="Buscar..." value={srch} onChange={e => setSrch(e.target.value)} style={{ width: '100%', padding: '7px 12px', border: '1px solid #dde8dd', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }} />
      </div>

      {vis.map(pr => (
        <div key={pr.id} style={{ padding: '0.8rem 1rem', background: 'white', border: '1px solid #dde8dd', borderRadius: '8px', marginBottom: '7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>{pr.name}</p>
            <p style={{ fontSize: '11px', color: '#888', margin: '3px 0 0' }}>{pr.category} · {pr.provider} · {pr.unit} · ${pr.price.toLocaleString('es-CL')}</p>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={() => toggleStock(pr.id)} style={{ fontSize: '10px', fontWeight: 600, padding: '3px 8px', borderRadius: '5px', border: '1px solid', cursor: 'pointer', background: pr.in_stock ? '#e8f5e9' : '#f5f5f5', borderColor: pr.in_stock ? '#81c784' : '#dde8dd', color: pr.in_stock ? '#2e7d32' : '#999' }}>{pr.in_stock ? '✓ Stock' : 'Sin stock'}</button>
            <button onClick={() => startEdit(pr)} style={{ fontSize: '10px', padding: '3px 8px', border: '1px solid #dde8dd', background: 'white', borderRadius: '5px', cursor: 'pointer', color: '#555' }}>Editar</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── PERÍODO ──────────────────────────────────────────────────────────────────

export function AdminPeriodo({ period, setPeriod, families, sealed, cargo }) {
  const [dates, setDates] = useState({ date_from: period?.date_from || '', date_to: period?.date_to || '', date_delivery: period?.date_delivery || '' });
  const [loading, setLoading] = useState(false);
  const [dateErr, setDateErr] = useState('');
  const [showClose, setShowClose] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newMonth, setNewMonth] = useState('');
  const [closing, setClosing] = useState(false);
  const [closeMsg, setCloseMsg] = useState('');
  const [creating, setCreating] = useState(false);
  const [createLabel, setCreateLabel] = useState('');
  const [createMonth, setCreateMonth] = useState('');
  const [createMsg, setCreateMsg] = useState('');

  const na = families.filter(f => f.role === 'familia');
  const sc = Object.keys(sealed).length;
  const pct = na.length > 0 ? Math.round(sc / na.length * 100) : 0;

  // ── No active period: show create form ──────────────────────────────────────
  if (!period) {
    return (
      <div>
        <div style={{ background: '#fff8e1', border: '1px solid #ffc107', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.5rem' }}>
          <p style={{ fontSize: '14px', fontWeight: 700, color: '#e65100', margin: '0 0 6px' }}>⚠ No hay período activo</p>
          <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>Crea el primer período para que las familias puedan comenzar a hacer pedidos.</p>
        </div>

        <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #c8e6c9', padding: '1.25rem' }}>
          <p style={{ fontSize: '14px', fontWeight: 700, color: '#2e7d32', margin: '0 0 1rem' }}>Crear período</p>
          <div style={{ display: 'grid', gap: '10px', marginBottom: '1rem' }}>
            <div>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Nombre del período *</label>
              <input type="text" placeholder="Ej: Julio 2026" value={createLabel} onChange={e => setCreateLabel(e.target.value)}
                style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', boxSizing: 'border-box', fontSize: '13px' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Subtítulo / mes (opcional)</label>
              <input type="text" placeholder="Ej: Julio 2026" value={createMonth} onChange={e => setCreateMonth(e.target.value)}
                style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', boxSizing: 'border-box', fontSize: '13px' }} />
            </div>
          </div>
          {createMsg && <p style={{ fontSize: '12px', color: '#c62828', margin: '0 0 10px' }}>{createMsg}</p>}
          <button
            onClick={async () => {
              if (!createLabel.trim()) { setCreateMsg('Ingresa un nombre para el período'); return; }
              setCreating(true);
              setCreateMsg('');
              const newPeriod = {
                id: Date.now().toString(),
                label: createLabel.trim(),
                month: createMonth.trim() || createLabel.trim(),
                active: true,
                fixed_charge: 4000,
                date_from: null,
                date_to: null,
                date_delivery: null
              };
              const result = await createPeriod(newPeriod);
              if (result && result.id) {
                setPeriod(result);
              } else {
                setCreateMsg(result?.error || 'Error al crear el período. Revisa la consola.');
              }
              setCreating(false);
            }}
            disabled={creating}
            style={{ width: '100%', padding: '9px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '13px' }}>
            {creating ? 'Creando...' : '✓ Crear período'}
          </button>
        </div>
      </div>
    );
  }

  const handleSaveDates = async () => {
    setDateErr('');
    // Validate date logic
    if (dates.date_from && dates.date_to && dates.date_from >= dates.date_to) {
      setDateErr('La apertura de pedidos debe ser anterior al cierre');
      return;
    }
    if (dates.date_to && dates.date_delivery && dates.date_delivery < dates.date_to) {
      setDateErr('La fecha de entrega no puede ser antes del cierre de pedidos');
      return;
    }
    if (dates.date_from && dates.date_delivery && dates.date_delivery < dates.date_from) {
      setDateErr('La fecha de entrega no puede ser antes de la apertura');
      return;
    }
    setLoading(true);
    const clean = {
      date_from: dates.date_from || null,
      date_to: dates.date_to || null,
      date_delivery: dates.date_delivery || null,
    };
    await updatePeriod(period.id, clean);
    setPeriod(p => ({ ...p, ...clean }));
    setLoading(false);
  };

  const handleClosePeriod = async () => {
    if (!newLabel.trim()) { setCloseMsg('Ingresa un nombre para el nuevo período'); return; }
    setClosing(true);

    for (const f of na) {
      const ord = sealed[f.id];
      if (ord) {
        const totalDebe = ord.total + cargo;
        const nuevoSaldo = (f.balance || 0) - totalDebe;
        await updateFamilyBalance(f.id, nuevoSaldo);
      }
    }

    const newPeriod = {
      id: Date.now().toString(),
      label: newLabel.trim(),
      month: newMonth.trim() || newLabel.trim(),
      active: true,
      fixed_charge: cargo,
      date_from: null,
      date_to: null,
      date_delivery: null
    };

    const result = await closePeriod(period.id, newPeriod);
    if (result && result.id) {
      setPeriod(result);
      setShowClose(false);
      setCloseMsg('');
      setNewLabel('');
      setNewMonth('');
    } else {
      setCloseMsg(result?.error || 'Error al cerrar el período. Revisa la consola del navegador.');
    }
    setClosing(false);
  };

  return (
    <div>
      <div style={{ padding: '1.25rem', background: 'white', borderRadius: '10px', border: '1px solid #dde8dd', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <div>
            <p style={{ fontSize: '11px', color: '#888', margin: 0 }}>Período activo</p>
            <p style={{ fontSize: '22px', fontWeight: 700, margin: '4px 0 0' }}>{period.label}</p>
          </div>
          <span style={{ fontSize: '10px', fontWeight: 700, padding: '4px 10px', borderRadius: '10px', background: '#e8f5e9', color: '#2e7d32' }}>Activo</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '1rem' }}>
          {[{ l: 'Familias', v: na.length }, { l: 'Sellados', v: sc }, { l: 'Completitud', v: pct + '%' }].map(m => (
            <div key={m.l} style={{ padding: '0.9rem', background: '#f0f7f0', borderRadius: '8px', textAlign: 'center' }}>
              <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>{m.l}</p>
              <p style={{ fontSize: '20px', fontWeight: 700, margin: '4px 0 0' }}>{m.v}</p>
            </div>
          ))}
        </div>

        <div style={{ height: '6px', background: '#e0e0e0', borderRadius: '3px', marginBottom: '1.5rem' }}>
          <div style={{ height: '6px', width: pct + '%', background: '#4CAF50', borderRadius: '3px', transition: 'width 0.3s' }} />
        </div>

        <p style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 1rem', color: '#333' }}>Fechas del período</p>
        <div style={{ display: 'grid', gap: '10px', marginBottom: '1.25rem' }}>
          {[{ key: 'date_from', l: 'Apertura de pedidos' }, { key: 'date_to', l: 'Cierre de pedidos' }, { key: 'date_delivery', l: 'Fecha de entrega' }].map(f => (
            <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <label style={{ fontSize: '12px', color: '#666', minWidth: '170px' }}>{f.l}</label>
              <input type="date" value={dates[f.key]} onChange={e => setDates(p => ({ ...p, [f.key]: e.target.value }))}
                style={{ flex: 1, padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '13px' }} />
            </div>
          ))}
        </div>

        {dateErr && (
          <div style={{ padding: '8px 12px', background: '#ffebee', border: '1px solid #ef9a9a', borderRadius: '6px', marginBottom: '10px' }}>
            <p style={{ fontSize: '12px', color: '#c62828', margin: 0, fontWeight: 500 }}>⚠ {dateErr}</p>
          </div>
        )}
        <button onClick={handleSaveDates} disabled={loading}
          style={{ width: '100%', padding: '9px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '13px' }}>
          {loading ? 'Guardando...' : '✓ Guardar fechas'}
        </button>
      </div>

      {/* Cerrar período */}
      <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #ffcdd2', padding: '1.25rem' }}>
        <p style={{ fontSize: '13px', fontWeight: 700, color: '#c62828', margin: '0 0 6px' }}>Cerrar período</p>
        <p style={{ fontSize: '12px', color: '#666', margin: '0 0 1rem' }}>
          Cierra <strong>{period.label}</strong> y crea uno nuevo. Los saldos de cada familia se actualizarán automáticamente según sus pedidos.
        </p>

        {!showClose ? (
          <button onClick={() => setShowClose(true)}
            style={{ padding: '8px 16px', background: '#ffebee', color: '#c62828', border: '1px solid #ffcdd2', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
            Cerrar período actual
          </button>
        ) : (
          <div>
            <div style={{ display: 'grid', gap: '10px', marginBottom: '1rem' }}>
              <div>
                <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Nombre del nuevo período *</label>
                <input type="text" placeholder="Ej: Julio 2026" value={newLabel} onChange={e => setNewLabel(e.target.value)}
                  style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', boxSizing: 'border-box', fontSize: '13px' }} />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Subtítulo / mes (opcional)</label>
                <input type="text" placeholder="Ej: Julio 2026" value={newMonth} onChange={e => setNewMonth(e.target.value)}
                  style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', boxSizing: 'border-box', fontSize: '13px' }} />
              </div>
            </div>

            <div style={{ background: '#fff8e1', border: '1px solid #ffc107', borderRadius: '8px', padding: '10px 12px', marginBottom: '1rem' }}>
              <p style={{ fontSize: '12px', color: '#e65100', fontWeight: 600, margin: '0 0 4px' }}>⚠ Esta acción es irreversible</p>
              <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>
                Se cerrarán {sc} pedidos sellados. Los saldos pendientes de cada familia se migrarán automáticamente al nuevo período.
              </p>
            </div>

            {closeMsg && <p style={{ fontSize: '12px', color: '#c62828', margin: '0 0 10px' }}>{closeMsg}</p>}

            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={handleClosePeriod} disabled={closing}
                style={{ flex: 1, padding: '8px', background: '#c62828', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '13px' }}>
                {closing ? 'Cerrando...' : 'Confirmar cierre'}
              </button>
              <button onClick={() => { setShowClose(false); setCloseMsg(''); }}
                style={{ flex: 1, padding: '8px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Cancelar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── BODEGA ───────────────────────────────────────────────────────────────────

export function AdminBodega({ period, families, setFamilies, products = [] }) {
  const [items, setItems] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedItem, setExpandedItem] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const emptyForm = { product_id: '', product_name: '', provider: '', unit: '', price: '', quantity: '', notes: '' };
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [showProductDrop, setShowProductDrop] = useState(false);
  const [assigningItem, setAssigningItem] = useState(null);
  const [assignForm, setAssignForm] = useState({ family_id: '', quantity: '' });
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignErr, setAssignErr] = useState('');

  useEffect(() => {
    if (!period) { setLoading(false); return; }
    Promise.all([getBodega(period.id), getBodegaAssignments(period.id)]).then(([itms, asns]) => {
      setItems(itms);
      setAssignments(asns);
      setLoading(false);
    });
  }, [period]);

  const getRemaining = (itemId) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return 0;
    const used = assignments.filter(a => a.bodega_id === itemId).reduce((s, a) => s + parseFloat(a.quantity), 0);
    return Math.max(0, parseFloat(item.quantity) - used);
  };

  const handleAddItem = async () => {
    if (!form.product_id || !form.price || !form.quantity) { setFormErr('Selecciona un producto del maestro, precio y cantidad'); return; }
    setSaving(true);
    const item = {
      id: Date.now().toString(),
      product_name: form.product_name,
      provider: form.provider,
      unit: form.unit || 'un',
      price: parseInt(form.price),
      quantity: parseFloat(form.quantity),
      notes: form.notes.trim(),
      period_id: period.id,
    };
    const result = await addBodegaItem(item);
    if (result) { setItems(p => [...p, result]); setForm(emptyForm); setShowForm(false); setFormErr(''); setProductSearch(''); setShowProductDrop(false); }
    else { setFormErr('Error al guardar'); }
    setSaving(false);
  };

  const handleDeleteItem = async (id) => {
    if (assignments.some(a => a.bodega_id === id)) { alert('Elimina primero las asignaciones de este ítem.'); return; }
    await deleteBodegaItem(id);
    setItems(p => p.filter(i => i.id !== id));
  };

  const handleAssign = async () => {
    if (!assignForm.family_id || !assignForm.quantity) { setAssignErr('Selecciona familia y cantidad'); return; }
    const qty = parseFloat(assignForm.quantity);
    if (isNaN(qty) || qty <= 0) { setAssignErr('Cantidad inválida'); return; }
    const remaining = getRemaining(assigningItem.id);
    if (qty > remaining + 0.001) { setAssignErr('Solo quedan ' + remaining + ' ' + assigningItem.unit + ' disponibles'); return; }
    setAssignSaving(true);
    const fam = families.find(f => f.id === assignForm.family_id);
    const totalValue = Math.round(qty * assigningItem.price);
    const asnData = {
      id: Date.now().toString(),
      bodega_id: assigningItem.id,
      family_id: fam.id,
      family_name: fam.name,
      product_name: assigningItem.product_name,
      quantity: qty,
      total_value: totalValue,
      period_id: period.id,
    };
    const result = await addBodegaAssignment(asnData);
    if (result) {
      setAssignments(p => [result, ...p]);
      const newBal = (fam.balance || 0) - totalValue;
      await updateFamilyBalance(fam.id, newBal);
      setFamilies(p => p.map(f => f.id === fam.id ? { ...f, balance: newBal } : f));
      setAssigningItem(null);
      setAssignForm({ family_id: '', quantity: '' });
      setAssignErr('');
    } else { setAssignErr('Error al asignar'); }
    setAssignSaving(false);
  };

  const handleDeleteAssignment = async (asn) => {
    await deleteBodegaAssignment(asn.id);
    setAssignments(p => p.filter(a => a.id !== asn.id));
    const fam = families.find(f => f.id === asn.family_id);
    if (fam) {
      const newBal = (fam.balance || 0) + asn.total_value;
      await updateFamilyBalance(fam.id, newBal);
      setFamilies(p => p.map(f => f.id === asn.family_id ? { ...f, balance: newBal } : f));
    }
  };

  const totalBodegaValue = items.reduce((s, i) => s + parseInt(i.price) * parseFloat(i.quantity), 0);
  const totalAssigned = assignments.reduce((s, a) => s + a.total_value, 0);

  if (!period) return (
    <div style={{ background: '#fff8e1', border: '1px solid #ffc107', borderRadius: '10px', padding: '1.25rem' }}>
      <p style={{ fontSize: '13px', color: '#e65100', margin: 0 }}>No hay período activo. Crea uno desde la pestaña Período.</p>
    </div>
  );

  if (loading) return <p style={{ color: '#888', fontSize: '13px' }}>Cargando bodega...</p>;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '1rem' }}>
        {[
          { l: 'Ítems en bodega', v: items.length, c: '#1565c0', bg: '#e3f2fd' },
          { l: 'Valor total', v: '$' + totalBodegaValue.toLocaleString('es-CL'), c: '#2e7d32', bg: '#e8f5e9' },
          { l: 'Total asignado', v: '$' + totalAssigned.toLocaleString('es-CL'), c: '#e65100', bg: '#fff3e0' },
        ].map(m => (
          <div key={m.l} style={{ padding: '0.9rem', background: m.bg, borderRadius: '8px', textAlign: 'center' }}>
            <p style={{ fontSize: '10px', color: m.c, margin: 0, fontWeight: 600 }}>{m.l}</p>
            <p style={{ fontSize: '15px', fontWeight: 700, margin: '4px 0 0', color: m.c }}>{m.v}</p>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <p style={{ fontSize: '13px', fontWeight: 600, color: '#333', margin: 0 }}>Stock en bodega — {period.label}</p>
        {!showForm && (
          <button onClick={() => { setShowForm(true); setForm(emptyForm); setFormErr(''); }}
            style={{ padding: '6px 14px', background: '#1565c0', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
            + Agregar stock
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ background: 'white', border: '1px solid #90caf9', borderRadius: '10px', padding: '1.25rem', marginBottom: '1rem' }}>
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#1565c0', margin: '0 0 1rem' }}>Nuevo ítem en bodega</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
            <div style={{ gridColumn: 'span 2', position: 'relative' }}>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Producto del maestro *</label>
              {form.product_id ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ flex: 1, padding: '7px 10px', border: '1px solid #4CAF50', borderRadius: '6px', background: '#f0f7f0', fontSize: '13px', color: '#2d5a2d', fontWeight: 500 }}>
                    ✓ {form.product_name} — {form.unit}
                  </div>
                  <button type="button" onClick={() => setForm(prev => ({ ...prev, product_id: '', product_name: '', provider: '', unit: '', price: '' }))}
                    style={{ padding: '6px 10px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', color: '#666', whiteSpace: 'nowrap' }}>
                    Cambiar
                  </button>
                </div>
              ) : (
                <>
                  <input type="text" placeholder="Buscar producto del maestro..." value={productSearch}
                    onChange={e => { setProductSearch(e.target.value); setShowProductDrop(true); }}
                    onFocus={() => setShowProductDrop(true)}
                    onBlur={() => setTimeout(() => setShowProductDrop(false), 150)}
                    style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }} />
                  {showProductDrop && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.10)', zIndex: 100, maxHeight: '200px', overflowY: 'auto' }}>
                      {products.filter(p => !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase())).map(p => (
                        <div key={p.id} onMouseDown={() => {
                          setForm(prev => ({ ...prev, product_id: p.id, product_name: p.name, provider: p.provider || '', unit: p.unit, price: p.price.toString() }));
                          setProductSearch(''); setShowProductDrop(false);
                        }}
                        style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '12px', borderBottom: '1px solid #f5f5f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 500 }}>{p.name}</span>
                          <span style={{ color: '#888', fontSize: '11px' }}>{p.unit} · ${p.price.toLocaleString('es-CL')}</span>
                        </div>
                      ))}
                      {products.filter(p => !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase())).length === 0 && (
                        <div style={{ padding: '10px', textAlign: 'center', color: '#aaa', fontSize: '12px' }}>Sin resultados</div>
                      )}
                    </div>
                  )}
                </>
              )}
              {form.product_id && (
                <p style={{ fontSize: '11px', color: '#888', margin: '4px 0 0' }}>
                  {form.provider && `${form.provider} · `}Precio del maestro: ${parseInt(form.price || 0).toLocaleString('es-CL')} /{form.unit}
                </p>
              )}
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Precio por unidad CLP * <span style={{ fontWeight: 400, fontStyle: 'italic' }}>(del maestro, editable)</span></label>
              <input type="number" placeholder="0" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))}
                style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Cantidad disponible *</label>
              <input type="number" step="0.5" placeholder="0" value={form.quantity} onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))}
                style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Observaciones</label>
              <input type="text" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }} />
            </div>
          </div>
          {form.price && form.quantity && (
            <div style={{ padding: '8px 12px', background: '#e8f5e9', borderRadius: '6px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', color: '#555' }}>Valor total en bodega</span>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#2e7d32' }}>${(parseInt(form.price || 0) * parseFloat(form.quantity || 0)).toLocaleString('es-CL')}</span>
            </div>
          )}
          {formErr && <p style={{ fontSize: '12px', color: '#c62828', margin: '0 0 10px' }}>{formErr}</p>}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleAddItem} disabled={saving}
              style={{ flex: 1, padding: '8px', background: '#1565c0', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
              {saving ? 'Guardando...' : '+ Agregar a bodega'}
            </button>
            <button onClick={() => { setShowForm(false); setFormErr(''); setProductSearch(''); setShowProductDrop(false); }}
              style={{ padding: '8px 14px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Cancelar</button>
          </div>
        </div>
      )}

      {items.length === 0 && !showForm && (
        <div style={{ textAlign: 'center', padding: '3rem', background: 'white', borderRadius: '10px', border: '1px solid #dde8dd' }}>
          <p style={{ fontSize: '32px', margin: 0 }}>🏪</p>
          <p style={{ color: '#888', fontSize: '13px', margin: '1rem 0 0' }}>La bodega está vacía para este período</p>
        </div>
      )}

      {items.map(item => {
        const itemAssignments = assignments.filter(a => a.bodega_id === item.id);
        const remaining = getRemaining(item.id);
        const isExpanded = expandedItem === item.id;
        const isAssigning = assigningItem?.id === item.id;
        return (
          <div key={item.id} style={{ background: 'white', border: '1px solid #dde8dd', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' }}>
            <div onClick={() => setExpandedItem(isExpanded ? null : item.id)}
              style={{ padding: '0.9rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <p style={{ fontSize: '14px', fontWeight: 600, margin: 0 }}>{item.product_name}</p>
                  {item.provider && <span style={{ fontSize: '11px', color: '#888' }}>{item.provider}</span>}
                  {item.notes && <span style={{ fontSize: '11px', color: '#aaa', fontStyle: 'italic' }}>{item.notes}</span>}
                </div>
                <div style={{ display: 'flex', gap: '12px', marginTop: '4px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '12px', color: '#555' }}>${parseInt(item.price).toLocaleString('es-CL')} / {item.unit}</span>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: remaining > 0 ? '#2e7d32' : '#c62828' }}>
                    {remaining} {item.unit} disponibles
                  </span>
                  <span style={{ fontSize: '12px', color: '#aaa' }}>Total: {item.quantity} {item.unit}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#1565c0' }}>
                  ${(parseInt(item.price) * parseFloat(item.quantity)).toLocaleString('es-CL')}
                </span>
                <span style={{ fontSize: '11px', color: '#888' }}>{isExpanded ? '▲' : '▼'}</span>
              </div>
            </div>

            {isExpanded && (
              <div style={{ borderTop: '1px solid #f0f7f0', padding: '0.75rem 1rem', background: '#fafffe' }}>
                {itemAssignments.length > 0 && (
                  <div style={{ marginBottom: '1rem' }}>
                    <p style={{ fontSize: '11px', fontWeight: 700, color: '#666', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Asignaciones ({itemAssignments.length})
                    </p>
                    {itemAssignments.map(asn => (
                      <div key={asn.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f0f7f0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 600, padding: '2px 7px', borderRadius: '10px', background: '#e3f2fd', color: '#1565c0' }}>{asn.family_name}</span>
                          <span style={{ fontSize: '12px', color: '#666' }}>{asn.quantity} {item.unit}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: '#c62828' }}>${asn.total_value.toLocaleString('es-CL')}</span>
                          <button onClick={() => handleDeleteAssignment(asn)}
                            style={{ width: '22px', height: '22px', border: '1px solid #ffcdd2', background: '#fff5f5', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', color: '#c62828', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {isAssigning ? (
                  <div style={{ background: '#f8fbff', border: '1px solid #90caf9', borderRadius: '8px', padding: '1rem' }}>
                    <p style={{ fontSize: '12px', fontWeight: 700, color: '#1565c0', margin: '0 0 10px' }}>Asignar a familia</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                      <div>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Familia</label>
                        <select value={assignForm.family_id} onChange={e => setAssignForm(p => ({ ...p, family_id: e.target.value }))}
                          style={{ width: '100%', padding: '6px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '12px' }}>
                          <option value="">Seleccionar...</option>
                          {families.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Cantidad ({item.unit}) · máx {remaining}</label>
                        <input type="number" step="0.5" max={remaining} placeholder="0" value={assignForm.quantity}
                          onChange={e => setAssignForm(p => ({ ...p, quantity: e.target.value }))}
                          style={{ width: '100%', padding: '6px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '12px', boxSizing: 'border-box' }} />
                      </div>
                    </div>
                    {assignForm.quantity && assignForm.family_id && (function() {
                      const fam = families.find(f => f.id === assignForm.family_id);
                      const val = Math.round(parseFloat(assignForm.quantity || 0) * item.price);
                      const newBal = (fam ? fam.balance || 0 : 0) - val;
                      return (
                        <div style={{ padding: '8px 10px', background: '#fff3e0', borderRadius: '6px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', color: '#555' }}>Cargo: ${val.toLocaleString('es-CL')} · Nuevo saldo {fam ? fam.name : ''}:</span>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: newBal >= 0 ? '#2e7d32' : '#c62828' }}>${newBal.toLocaleString('es-CL')}</span>
                        </div>
                      );
                    })()}
                    {assignErr && <p style={{ fontSize: '11px', color: '#c62828', margin: '0 0 8px' }}>{assignErr}</p>}
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={handleAssign} disabled={assignSaving}
                        style={{ flex: 1, padding: '7px', background: '#1565c0', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                        {assignSaving ? 'Asignando...' : 'Confirmar asignación'}
                      </button>
                      <button onClick={() => { setAssigningItem(null); setAssignErr(''); }}
                        style={{ padding: '7px 12px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => { setAssigningItem(item); setAssignForm({ family_id: '', quantity: '' }); setAssignErr(''); }}
                      disabled={remaining <= 0}
                      style={{ flex: 1, padding: '7px', background: remaining > 0 ? '#e3f2fd' : '#f5f5f5', color: remaining > 0 ? '#1565c0' : '#999', border: '1px solid ' + (remaining > 0 ? '#90caf9' : '#dde8dd'), borderRadius: '6px', cursor: remaining > 0 ? 'pointer' : 'not-allowed', fontSize: '12px', fontWeight: 600 }}>
                      {remaining > 0 ? '+ Asignar a familia' : 'Sin stock disponible'}
                    </button>
                    <button onClick={() => handleDeleteItem(item.id)}
                      style={{ padding: '7px 12px', background: '#fff5f5', border: '1px solid #ffcdd2', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: '#c62828' }}>
                      Eliminar
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
