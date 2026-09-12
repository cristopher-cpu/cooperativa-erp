import React, { useState, useEffect, useMemo } from 'react';
import { addFamily, addProduct, updateProduct, updatePeriod, closePeriod, createPeriod, getCashFlow, addCashFlowEntry, deleteCashFlowEntry, markRetired, updateFamilyBalance, setFamilyPin, updateFamilyRole, getBodega, addBodegaItem, deleteBodegaItem, getBodegaAssignments, addBodegaAssignment, deleteBodegaAssignment, addAdminLog, getAdminLogs, getPastPeriods, getAllSealedOrders, getAllCashFlow, getAllPeriods, updateFamilyContacts, getAdjustments, markOrderCharged } from './supabaseClient';
import { cuentaDeFamilia, ajustesPorFamilia } from './calculos';

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

export function AdminDashboard({ families, sealed, cargo, setTab, period }) {
  const [expandedFam, setExpandedFam] = useState(null);
  // Only count orders belonging to actual familias (excludes an admin's own "Mi pedido")
  const famSealed = Object.entries(sealed).filter(([fid]) => families.some(f => f.id === fid));
  const sc = famSealed.length;
  const ret = famSealed.filter(([, o]) => o.retired).length;
  const tot = famSealed.reduce((s, [, o]) => s + (o.total || 0) + cargo, 0);
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
    const entry = entries.find(e => e.id === id);
    // If this movement adjusted a family's balance, reverse it so the balance stays correct
    if (entry && entry.family_id) {
      const fam = fams.find(f => f.id === entry.family_id);
      const who = entry.family_name || (fam && fam.name) || 'la familia';
      if (!window.confirm(`Este movimiento afectó el saldo de ${who}. Al eliminarlo se revertirá ese ajuste. ¿Continuar?`)) return;
      if (fam) {
        const reverse = entry.type === 'ingreso' ? -(entry.amount || 0) : (entry.amount || 0);
        const nuevoSaldo = (fam.balance || 0) + reverse;
        await updateFamilyBalance(entry.family_id, nuevoSaldo);
        if (setFamilies) setFamilies(p => p.map(f => f.id === entry.family_id ? { ...f, balance: nuevoSaldo } : f));
      }
    }
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

  if (!period) return (
    <div style={{ background: '#fff8e1', border: '1px solid #ffc107', borderRadius: '10px', padding: '1.25rem' }}>
      <p style={{ fontSize: '13px', color: '#e65100', margin: 0 }}>No hay período activo. Crea uno desde la pestaña <strong>Período</strong> para registrar flujo de caja.</p>
    </div>
  );

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

export function AdminFamilias({ families, setFamilies, sealed, onHacerPedido, currentAdmin }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', email2: '', balance: '0', role: 'familia' });
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [srch, setSrch] = useState('');
  const [pinEditId, setPinEditId] = useState(null);
  const [pinVal, setPinVal] = useState('');
  const [pinSaving, setPinSaving] = useState(false);
  const [pinErr, setPinErr] = useState('');
  const [mailEditId, setMailEditId] = useState(null);
  const [mailVals, setMailVals] = useState({ email: '', email2: '' });
  const [mailSaving, setMailSaving] = useState(false);

  const handleAdd = async () => {
    if (!form.name.trim()) { setErr('El nombre es obligatorio'); return; }
    if (!form.email.includes('@')) { setErr('El correo principal no es válido'); return; }
    if (form.email2.trim() && !form.email2.includes('@')) { setErr('El segundo correo no es válido'); return; }
    setLoading(true);
    const newFamily = {
      id: Date.now().toString(),
      name: form.name.trim(),
      initials: form.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase(),
      balance: parseInt(form.balance) || 0,
      role: form.role,
      email: form.email.trim(),
      email2: form.email2.trim() || null
    };
    const result = await addFamily(newFamily);
    if (result) {
      setFamilies(p => [...p, newFamily]);
      if (currentAdmin) {
        addAdminLog({
          id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.name,
          action: 'created_family',
          details: `${form.role === 'admin' ? 'Nuevo administrador' : 'Nueva familia'}: ${form.name.trim()}`
        });
      }
      setForm({ name: '', email: '', email2: '', balance: '0', role: 'familia' });
      setErr('');
      setShowForm(false);
    } else {
      setErr('Error al agregar familia');
    }
    setLoading(false);
  };

  const saveMailsFor = async (fid) => {
    const e1 = mailVals.email.trim(), e2 = mailVals.email2.trim();
    if (e1 && !e1.includes('@')) { alert('El correo principal no es válido'); return; }
    if (e2 && !e2.includes('@')) { alert('El segundo correo no es válido'); return; }
    setMailSaving(true);
    const result = await updateFamilyContacts(fid, e1, e2);
    if (result && result.error) { alert('Error al guardar: ' + result.error); setMailSaving(false); return; }
    setFamilies(p => p.map(f => f.id === fid ? { ...f, email: e1 || null, email2: e2 || null } : f));
    setMailEditId(null);
    setMailSaving(false);
  };

  // El PIN se cifra en el servidor: el panel no escribe la columna directamente.
  const savePinFor = async (fid) => {
    setPinSaving(true);
    setPinErr('');
    const res = await setFamilyPin(fid, pinVal.trim());
    if (res.error) { setPinErr(res.error); setPinSaving(false); return; }
    setFamilies(p => p.map(f => f.id === fid ? { ...f, pin_set_at: new Date().toISOString() } : f));
    setPinEditId(null);
    setPinVal('');
    setPinSaving(false);
  };

  const clearPinFor = async (fid) => {
    const res = await setFamilyPin(fid, null);
    if (res.error) { alert(res.error); return; }
    setFamilies(p => p.map(f => f.id === fid ? { ...f, pin_set_at: null } : f));
  };

  const [roleSavingId, setRoleSavingId] = useState(null);
  const changeRole = async (f, newRole) => {
    // Nunca dejar a la cooperativa sin administradores
    if (newRole === 'familia' && admins.length <= 1) {
      alert('No puedes quitar el rol al último administrador. Designa primero a otro administrador.');
      return;
    }
    const isSelf = currentAdmin && currentAdmin.id === f.id;
    let msg = newRole === 'admin'
      ? `¿Promover a "${f.name}" a Administrador?\n\nTendrá acceso completo al panel de administración.`
      : `¿Pasar a "${f.name}" de Administrador a Familia?\n\nPerderá el acceso al panel de administración.`;
    if (newRole === 'familia' && isSelf) msg += '\n\n⚠ Te estás quitando el rol a ti mismo: perderás el acceso al cerrar sesión.';
    if (!window.confirm(msg)) return;

    setRoleSavingId(f.id);
    const result = await updateFamilyRole(f.id, newRole);
    if (result) {
      setFamilies(p => p.map(x => x.id === f.id ? { ...x, role: newRole } : x));
      if (currentAdmin) {
        addAdminLog({
          id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.name,
          action: 'role_changed',
          details: `${f.name}: ${newRole === 'admin' ? 'Familia → Administrador' : 'Administrador → Familia'}`
        });
      }
    } else {
      alert('Error al cambiar el rol. Intenta nuevamente.');
    }
    setRoleSavingId(null);
  };

  const admins = families.filter(f => f.role === 'admin');
  const fams = families.filter(f => f.role === 'familia');
  const filtered = fams.filter(f => !srch || f.name.toLowerCase().includes(srch.toLowerCase()));

  // Los correos no son credenciales de acceso (se entra con nombre + PIN);
  // son las direcciones de notificación de la familia. La cooperativa pidió dos.
  const renderContactRow = (f) => (
    <div style={{ padding: '0.5rem 1rem', background: '#fbfdfb', borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '10px', color: '#aaa' }}>✉</span>
      {mailEditId === f.id ? (
        <>
          <input type="email" placeholder="Correo principal" value={mailVals.email}
            onChange={e => setMailVals(v => ({ ...v, email: e.target.value }))}
            style={{ flex: 1, minWidth: '150px', padding: '4px 8px', border: '1px solid #4CAF50', borderRadius: '5px', fontSize: '12px' }} />
          <input type="email" placeholder="Segundo correo (opcional)" value={mailVals.email2}
            onChange={e => setMailVals(v => ({ ...v, email2: e.target.value }))}
            style={{ flex: 1, minWidth: '150px', padding: '4px 8px', border: '1px solid #dde8dd', borderRadius: '5px', fontSize: '12px' }} />
          <button onClick={() => saveMailsFor(f.id)} disabled={mailSaving}
            style={{ padding: '3px 10px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}>
            {mailSaving ? '...' : '✓'}
          </button>
          <button onClick={() => setMailEditId(null)}
            style={{ padding: '3px 8px', background: 'white', border: '1px solid #dde8dd', borderRadius: '5px', cursor: 'pointer', fontSize: '11px' }}>✕</button>
        </>
      ) : (
        <>
          <span style={{ fontSize: '11px', color: '#666' }}>
            {f.email || <span style={{ color: '#c62828' }}>sin correo</span>}
            {f.email2
              ? <span style={{ color: '#888' }}> · {f.email2}</span>
              : <span style={{ color: '#ccc' }}> · sin segundo correo</span>}
          </span>
          <button onClick={() => { setMailEditId(f.id); setMailVals({ email: f.email || '', email2: f.email2 || '' }); }}
            style={{ marginLeft: 'auto', padding: '2px 8px', background: 'white', border: '1px solid #dde8dd', borderRadius: '5px', cursor: 'pointer', fontSize: '10px', color: '#555' }}>
            Editar correos
          </button>
        </>
      )}
    </div>
  );

  const renderPinRow = (f) => (
    <div style={{ padding: '0.5rem 1rem', background: f.role === 'admin' && !f.pin_set_at ? '#fff5f5' : '#f9fafb', borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '10px', color: '#aaa' }}>🔒</span>
      {pinEditId === f.id ? (
        <>
          <input type="password" inputMode="numeric" maxLength={8} placeholder="PIN de 4 a 8 dígitos" value={pinVal}
            onChange={e => { setPinVal(e.target.value.replace(/[^0-9]/g, '')); setPinErr(''); }}
            onKeyDown={e => e.key === 'Enter' && savePinFor(f.id)}
            autoFocus
            style={{ flex: 1, minWidth: '140px', padding: '4px 8px', border: `1px solid ${pinErr ? '#ef9a9a' : '#4CAF50'}`, borderRadius: '5px', fontSize: '12px', letterSpacing: '3px' }} />
          <button onClick={() => savePinFor(f.id)} disabled={pinSaving}
            style={{ padding: '3px 10px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}>
            {pinSaving ? '...' : '✓'}
          </button>
          <button onClick={() => { setPinEditId(null); setPinVal(''); setPinErr(''); }}
            style={{ padding: '3px 8px', background: 'white', border: '1px solid #dde8dd', borderRadius: '5px', cursor: 'pointer', fontSize: '11px' }}>✕</button>
          {pinErr && <p style={{ fontSize: '10px', color: '#c62828', margin: 0, width: '100%', fontWeight: 500 }}>{pinErr}</p>}
        </>
      ) : (
        <>
          <span style={{ fontSize: '11px', color: f.pin_set_at ? '#2e7d32' : f.role === 'admin' ? '#c62828' : '#aaa', fontWeight: f.pin_set_at || f.role === 'admin' ? 600 : 400 }}>
            {f.pin_set_at
              ? 'PIN configurado'
              : f.role === 'admin'
                ? '⚠ Sin PIN — no podrá entrar hasta que se le asigne uno'
                : 'Sin PIN — acceso libre'}
          </span>
          {/* El PIN ya no se puede leer, ni siquiera desde el panel: solo se reemplaza. */}
          <button onClick={() => { setPinEditId(f.id); setPinVal(''); setPinErr(''); }}
            style={{ marginLeft: 'auto', padding: '2px 8px', background: 'white', border: '1px solid #dde8dd', borderRadius: '5px', cursor: 'pointer', fontSize: '10px', color: '#555' }}>
            {f.pin_set_at ? 'Cambiar' : 'Asignar PIN'}
          </button>
          {f.pin_set_at && f.role !== 'admin' && (
            <button onClick={() => clearPinFor(f.id)}
              style={{ padding: '2px 8px', background: '#fff5f5', border: '1px solid #ffcdd2', borderRadius: '5px', cursor: 'pointer', fontSize: '10px', color: '#c62828' }}>
              Quitar
            </button>
          )}
        </>
      )}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <p style={{ fontSize: '13px', fontWeight: 500, color: '#666', margin: 0 }}>{fams.length} familias · {admins.length} admins</p>
        {!showForm && <button onClick={() => setShowForm(true)} style={{ padding: '6px 14px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>+ Nuevo miembro</button>}
      </div>

      <input type="text" placeholder="Buscar familia por nombre..." value={srch} onChange={e => setSrch(e.target.value)}
        style={{ width: '100%', padding: '7px 12px', border: '1px solid #dde8dd', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box', marginBottom: '1rem' }} />

      {showForm && (
        <div style={{ padding: '1rem', background: 'white', border: '1px solid #c8e6c9', borderRadius: '8px', marginBottom: '1rem' }}>
          <p style={{ fontWeight: 600, fontSize: '14px', color: '#2e7d32', margin: '0 0 1rem' }}>Nuevo miembro</p>
          <div style={{ display: 'grid', gap: '10px', marginBottom: '1rem' }}>
            {[{ k: 'name', l: 'Nombre completo *', t: 'text', ph: 'Ej: Familia González' }, { k: 'email', l: 'Correo electrónico *', t: 'email', ph: 'correo@ejemplo.com' }, { k: 'email2', l: 'Segundo correo (opcional)', t: 'email', ph: 'otro@ejemplo.com' }, { k: 'balance', l: 'Saldo inicial', t: 'number', ph: '0' }].map(f => (
              <div key={f.k}>
                <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>{f.l}</label>
                <input type={f.t} placeholder={f.ph} value={form[f.k]} onChange={e => setForm(p => ({ ...p, [f.k]: e.target.value }))}
                  style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', boxSizing: 'border-box' }} />
              </div>
            ))}
            <div>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Rol *</label>
              <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                style={{ width: '100%', padding: '7px', border: `1px solid ${form.role === 'admin' ? '#90caf9' : '#dde8dd'}`, borderRadius: '6px', fontSize: '13px', background: form.role === 'admin' ? '#f8fbff' : 'white' }}>
                <option value="familia">Familia (solo pedidos)</option>
                <option value="admin">Administrador (acceso total)</option>
              </select>
              {form.role === 'admin' && (
                <p style={{ fontSize: '11px', color: '#1565c0', margin: '4px 0 0' }}>Este usuario tendrá acceso al panel de administración completo.</p>
              )}
            </div>
          </div>
          {err && <p style={{ fontSize: '12px', color: '#c62828', margin: '0 0 10px' }}>{err}</p>}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleAdd} disabled={loading} style={{ flex: 1, padding: '7px', background: form.role === 'admin' ? '#1565c0' : '#4CAF50', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>{loading ? 'Guardando...' : 'Agregar'}</button>
            <button onClick={() => { setShowForm(false); setErr(''); }} style={{ flex: 1, padding: '7px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Cancelar</button>
          </div>
        </div>
      )}

      {admins.length > 0 && (
        <div style={{ marginBottom: '1.25rem' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, color: '#1565c0', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>Administradores</p>
          {admins.map(f => (
            <div key={f.id} style={{ background: 'white', border: '1.5px solid #90caf9', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' }}>
              <div style={{ padding: '0.9rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#1565c0', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, flexShrink: 0 }}>{f.initials}</div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>{f.name}</p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <span style={{ fontSize: '9px', fontWeight: 700, padding: '3px 8px', borderRadius: '10px', background: '#1565c0', color: 'white' }}>ADMIN</span>
                  <button onClick={() => changeRole(f, 'familia')} disabled={roleSavingId === f.id}
                    title="Quitar rol de administrador y dejarlo como Familia"
                    style={{ fontSize: '10px', padding: '4px 10px', background: '#fff5f5', color: '#c62828', border: '1px solid #ffcdd2', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>
                    {roleSavingId === f.id ? '...' : '⬇ Pasar a Familia'}
                  </button>
                </div>
              </div>
              {renderContactRow(f)}
              {renderPinRow(f)}
            </div>
          ))}
        </div>
      )}

      <p style={{ fontSize: '11px', fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>Familias ({fams.length})</p>
      {filtered.map(f => (
        <div key={f.id} style={{ background: 'white', border: '1px solid #dde8dd', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' }}>
          <div style={{ padding: '0.9rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#4CAF50', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, flexShrink: 0 }}>{f.initials}</div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>{f.name}</p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
              <button onClick={() => changeRole(f, 'admin')} disabled={roleSavingId === f.id}
                title="Promover a Administrador"
                style={{ fontSize: '10px', padding: '4px 10px', background: '#e3f2fd', color: '#1565c0', border: '1px solid #90caf9', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>
                {roleSavingId === f.id ? '...' : '⬆ Hacer Admin'}
              </button>
            </div>
          </div>
          {renderContactRow(f)}
          {renderPinRow(f)}
        </div>
      ))}
    </div>
  );
}

// ─── PRODUCTOS ────────────────────────────────────────────────────────────────

export function AdminProductos({ products, setProducts, providers = [] }) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: '', category: 'Cereales', price: '', unit: '', provider_id: '', in_stock: true });
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [srch, setSrch] = useState('');
  const [provSearch, setProvSearch] = useState('');
  const [showProvDrop, setShowProvDrop] = useState(false);

  const CATS = ['Cereales', 'Legumbres', 'Semillas', 'Harinas', 'Té y Café', 'Aceites', 'Aseo', 'Dulces', 'Pan', 'Miel', 'Aliños'];

  // El proveedor se elige de la lista maestra, pero seguimos guardando su nombre
  // en products.provider: el catálogo y la búsqueda de las familias leen ese texto.
  const selectedProvider = providers.find(p => p.id === form.provider_id) || null;
  const providerFields = () => selectedProvider ? { provider_id: selectedProvider.id, provider: selectedProvider.name } : null;

  // Inactivos visibles solo si están ya asignados: no se ofrecen para productos nuevos
  // pero tampoco desaparecen al editar uno viejo.
  const provMatches = providers
    .filter(p => p.active || p.id === form.provider_id)
    .filter(p => !provSearch || p.name.toLowerCase().includes(provSearch.toLowerCase().trim()));

  const validate = () => {
    if (!form.name.trim() || !form.price || !form.unit) return 'Nombre, precio y unidad son obligatorios';
    if (!form.provider_id) return 'Selecciona un proveedor';
    if (!providerFields()) return 'El proveedor seleccionado ya no existe';
    return '';
  };

  const handleSaveNew = async () => {
    const v = validate();
    if (v) { setErr(v); return; }
    setLoading(true);
    const newProduct = { id: Math.max(...products.map(p => p.id), 0) + 1, name: form.name.trim(), category: form.category, price: parseInt(form.price), unit: form.unit.trim(), in_stock: form.in_stock, ...providerFields() };
    const result = await addProduct(newProduct);
    if (result) {
      setProducts(p => [...p, newProduct]);
      setForm({ name: '', category: 'Cereales', price: '', unit: '', provider_id: '', in_stock: true });
      setErr(''); setShowForm(false);
    } else { setErr('Error al agregar producto'); }
    setLoading(false);
  };

  const handleEdit = async () => {
    const v = validate();
    if (v) { setErr(v); return; }
    setLoading(true);
    const updates = { name: form.name.trim(), category: form.category, price: parseInt(form.price), unit: form.unit.trim(), in_stock: form.in_stock, ...providerFields() };
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
    // Productos anteriores a la tabla de proveedores pueden no tener provider_id:
    // se resuelve por nombre para que el desplegable no aparezca vacío.
    const byName = providers.find(p => p.name.toLowerCase() === (pr.provider || '').trim().toLowerCase());
    setForm({ name: pr.name, category: pr.category, price: pr.price, unit: pr.unit, provider_id: pr.provider_id || (byName ? byName.id : ''), in_stock: pr.in_stock });
    setShowForm(false);
    setErr('');
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
            {/* Buscador en vez de <select>: la lista de proveedores va a crecer. */}
            <div style={{ position: 'relative' }}>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Proveedor *</label>
              {selectedProvider ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ flex: 1, minWidth: 0, padding: '7px 10px', border: '1px solid #4CAF50', borderRadius: '6px', background: '#f0f7f0', fontSize: '13px', color: '#2d5a2d', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    ✓ {selectedProvider.name}{selectedProvider.active ? '' : ' (inactivo)'}
                  </div>
                  <button type="button" onClick={() => { setForm(p => ({ ...p, provider_id: '' })); setProvSearch(''); setShowProvDrop(true); }}
                    style={{ padding: '6px 10px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', color: '#666', whiteSpace: 'nowrap' }}>
                    Cambiar
                  </button>
                </div>
              ) : (
                <>
                  <input type="text" placeholder="Buscar proveedor..." value={provSearch}
                    onChange={e => { setProvSearch(e.target.value); setShowProvDrop(true); setErr(''); }}
                    onFocus={() => setShowProvDrop(true)}
                    onBlur={() => setTimeout(() => setShowProvDrop(false), 150)}
                    style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }} />
                  {showProvDrop && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.10)', zIndex: 100, maxHeight: '200px', overflowY: 'auto' }}>
                      {provMatches.map(p => (
                        <div key={p.id} onMouseDown={() => { setForm(f => ({ ...f, provider_id: p.id })); setProvSearch(''); setShowProvDrop(false); setErr(''); }}
                          style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '12px', borderBottom: '1px solid #f5f5f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontWeight: 500 }}>{p.name}{p.active ? '' : ' (inactivo)'}</span>
                          <span style={{ color: '#888', fontSize: '11px', whiteSpace: 'nowrap' }}>
                            {products.filter(x => x.provider_id === p.id).length} prod.
                          </span>
                        </div>
                      ))}
                      {provMatches.length === 0 && (
                        <div style={{ padding: '10px', textAlign: 'center', color: '#aaa', fontSize: '12px' }}>
                          {providers.length === 0 ? 'No hay proveedores cargados' : 'Sin resultados'}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
              {providers.length === 0 && (
                <p style={{ fontSize: '10px', color: '#c62828', margin: '3px 0 0' }}>Créalos primero en la pestaña Proveedores.</p>
              )}
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

export function AdminPeriodo({ period, setPeriod, families, sealed, cargo, currentAdmin }) {
  const [dates, setDates] = useState({ date_from: period?.date_from || '', date_to: period?.date_to || '', date_delivery: period?.date_delivery || '', date_confirm_until: period?.date_confirm_until || '', date_adjust_until: period?.date_adjust_until || '' });
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
  const [pastPeriods, setPastPeriods] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState(null);

  const na = families.filter(f => f.role === 'familia');
  const sc = Object.keys(sealed).filter(fid => na.some(f => f.id === fid)).length;
  const pct = na.length > 0 ? Math.round(sc / na.length * 100) : 0;

  useEffect(() => {
    if (!showHistory) return;
    setLoadingHistory(true);
    getPastPeriods().then(data => { setPastPeriods(data); setLoadingHistory(false); });
  }, [showHistory]);

  const logAction = (action, details) => {
    if (!currentAdmin) return;
    addAdminLog({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      admin_id: currentAdmin.id,
      admin_name: currentAdmin.name,
      action,
      details
    });
  };

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
                logAction('period_created', `Período creado: ${createLabel.trim()}`);
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
      date_confirm_until: dates.date_confirm_until || null,
      date_adjust_until: dates.date_adjust_until || null,
    };
    await updatePeriod(period.id, clean);
    setPeriod(p => ({ ...p, ...clean }));
    logAction('period_dates_updated', `Fechas actualizadas en período: ${period.label} — Apertura: ${clean.date_from || 'N/A'}, Cierre: ${clean.date_to || 'N/A'}, Entrega: ${clean.date_delivery || 'N/A'}`);
    setLoading(false);
  };

  const handleClosePeriod = async () => {
    if (!newLabel.trim()) { setCloseMsg('Ingresa un nombre para el nuevo período'); return; }
    setClosing(true);

    const totalValue = Object.values(sealed).reduce((s, o) => s + o.total + cargo, 0);
    const summary = {
      period_label: period.label,
      families_count: na.length,
      sealed_count: sc,
      total_value: totalValue,
      cargo,
      families: na.map(f => {
        const ord = sealed[f.id];
        return {
          name: f.name,
          balance_before: f.balance || 0,
          had_order: !!ord,
          order_total: ord ? ord.total + cargo : 0
        };
      })
    };

    // El cobro va ANTES de cerrar y no se puede deshacer, así que cada pedido se
    // marca como cobrado en cuanto se aplica. Si esto falla a la mitad y el admin
    // reintenta, los ya cobrados se saltan en vez de cobrarse dos veces.
    const ajustes = await getAdjustments(period.id);
    const porFam = ajustesPorFamilia(ajustes);
    const fallidas = [];

    for (const f of na) {
      const ord = sealed[f.id];
      if (!ord) continue;
      if (ord.charged_at) continue; // ya cobrado en un intento anterior

      const cuenta = cuentaDeFamilia({ ord, ajustes: porFam.get(f.id) || [], cargo, saldo: f.balance || 0 });
      const nuevoSaldo = (f.balance || 0) - cuenta.cargoAlCerrar;

      const res = await updateFamilyBalance(f.id, nuevoSaldo);
      if (!res) { fallidas.push(f.name); continue; }
      await markOrderCharged(ord.id, cuenta.cargoAlCerrar);
    }

    if (fallidas.length) {
      setCloseMsg('No se pudo cobrar a: ' + fallidas.join(', ') + '. El período NO se cerró. Vuelve a intentarlo — las familias ya cobradas no se cobrarán de nuevo.');
      setClosing(false);
      return;
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

    const result = await closePeriod(period.id, newPeriod, summary);
    if (result && result.id) {
      logAction('period_closed', `Período cerrado: ${period.label} → Nuevo: ${newLabel.trim()} (${sc} pedidos, total $${totalValue.toLocaleString('es-CL')})`);
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
          {[{ key: 'date_from', l: 'Apertura de pedidos' }, { key: 'date_to', l: 'Cierre de pedidos' }, { key: 'date_confirm_until', l: 'Límite confirmación proveedores' }, { key: 'date_delivery', l: 'Fecha de entrega' }, { key: 'date_adjust_until', l: 'Límite de ajustes (faltantes/extras)' }].map(f => (
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

      {/* Historial de períodos */}
      <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #dde8dd', padding: '1.25rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showHistory ? '1rem' : 0 }}>
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#333', margin: 0 }}>Historial de períodos anteriores</p>
          <button onClick={() => setShowHistory(h => !h)}
            style={{ padding: '5px 12px', background: showHistory ? '#f5f5f5' : '#e3f2fd', color: showHistory ? '#555' : '#1565c0', border: `1px solid ${showHistory ? '#dde8dd' : '#90caf9'}`, borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}>
            {showHistory ? 'Ocultar' : 'Ver historial'}
          </button>
        </div>
        {showHistory && (
          loadingHistory ? <p style={{ color: '#888', fontSize: '13px', margin: 0 }}>Cargando...</p> :
          pastPeriods.length === 0 ? <p style={{ color: '#aaa', fontSize: '13px', margin: 0 }}>No hay períodos anteriores registrados.</p> :
          pastPeriods.map(pp => {
            const sum = pp.summary ? (() => { try { return JSON.parse(pp.summary); } catch { return null; } })() : null;
            const isExp = expandedHistory === pp.id;
            return (
              <div key={pp.id} style={{ border: '1px solid #e0e0e0', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' }}>
                <div onClick={() => setExpandedHistory(isExp ? null : pp.id)} style={{ padding: '0.9rem 1rem', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafafa' }}>
                  <div>
                    <p style={{ fontSize: '14px', fontWeight: 700, margin: 0, color: '#333' }}>{pp.label}</p>
                    <p style={{ fontSize: '11px', color: '#888', margin: '3px 0 0' }}>
                      Cerrado: {pp.closed_at ? new Date(pp.closed_at).toLocaleString('es-CL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Sin fecha'}
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {sum && <span style={{ fontSize: '12px', fontWeight: 600, color: '#2e7d32' }}>${sum.total_value?.toLocaleString('es-CL')}</span>}
                    <span style={{ fontSize: '11px', color: '#888' }}>{isExp ? '▲' : '▼'}</span>
                  </div>
                </div>
                {isExp && sum && (
                  <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid #f0f0f0', background: 'white' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '1rem' }}>
                      {[
                        { l: 'Familias', v: sum.families_count },
                        { l: 'Con pedido', v: sum.sealed_count },
                        { l: 'Total recaudado', v: '$' + sum.total_value?.toLocaleString('es-CL') }
                      ].map(m => (
                        <div key={m.l} style={{ padding: '0.6rem', background: '#f5f5f5', borderRadius: '6px', textAlign: 'center' }}>
                          <p style={{ fontSize: '10px', color: '#888', margin: 0 }}>{m.l}</p>
                          <p style={{ fontSize: '14px', fontWeight: 700, margin: '2px 0 0', color: '#333' }}>{m.v}</p>
                        </div>
                      ))}
                    </div>
                    {sum.families && sum.families.length > 0 && (
                      <div>
                        <p style={{ fontSize: '11px', fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>Detalle por familia</p>
                        {sum.families.map((fh, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #f5f5f5', fontSize: '12px' }}>
                            <span style={{ fontWeight: 500, color: '#333' }}>{fh.name}</span>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                              {fh.had_order
                                ? <span style={{ color: '#1565c0' }}>Pedido: ${fh.order_total?.toLocaleString('es-CL')}</span>
                                : <span style={{ color: '#aaa' }}>Sin pedido</span>
                              }
                              <span style={{ color: fh.balance_before >= 0 ? '#2e7d32' : '#c62828', fontWeight: 600 }}>
                                Saldo prev.: {fh.balance_before >= 0 ? '+' : ''}${fh.balance_before?.toLocaleString('es-CL')}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {isExp && !sum && (
                  <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid #f0f0f0', background: 'white' }}>
                    <p style={{ color: '#aaa', fontSize: '12px', margin: 0 }}>Este período no tiene resumen guardado (fue cerrado antes de esta función).</p>
                  </div>
                )}
              </div>
            );
          })
        )}
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

// ─── ACTIVIDAD / LOGS ─────────────────────────────────────────────────────────

export function AdminLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState('todos');

  useEffect(() => {
    getAdminLogs().then(data => { setLogs(data); setLoading(false); });
  }, []);

  const actionConfig = {
    created_family:       { label: 'Nuevo miembro',      bg: '#e8f5e9', color: '#2e7d32', ic: '👤' },
    period_dates_updated: { label: 'Fechas actualizadas', bg: '#e3f2fd', color: '#1565c0', ic: '📅' },
    period_closed:        { label: 'Período cerrado',     bg: '#fff3e0', color: '#e65100', ic: '🔒' },
    period_created:       { label: 'Período creado',      bg: '#e8f5e9', color: '#2e7d32', ic: '✅' },
    role_changed:         { label: 'Cambio de rol',       bg: '#f3e5f5', color: '#6a1b9a', ic: '🔑' },
  };

  const filtered = filterAction === 'todos' ? logs : logs.filter(l => l.action === filterAction);

  if (loading) return <p style={{ color: '#888', fontSize: '13px' }}>Cargando actividad...</p>;

  return (
    <div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {['todos', 'created_family', 'role_changed', 'period_dates_updated', 'period_closed', 'period_created'].map(k => {
          const cfg = k === 'todos' ? null : actionConfig[k];
          const active = filterAction === k;
          return (
            <button key={k} onClick={() => setFilterAction(k)}
              style={{ padding: '5px 12px', borderRadius: '20px', border: '1px solid', cursor: 'pointer', fontSize: '11px', fontWeight: active ? 700 : 400, background: active ? (cfg ? cfg.color : '#333') : 'white', borderColor: active ? (cfg ? cfg.color : '#333') : '#dde8dd', color: active ? 'white' : '#555', whiteSpace: 'nowrap' }}>
              {cfg ? `${cfg.ic} ${cfg.label}` : `Todos (${logs.length})`}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', background: 'white', borderRadius: '10px', border: '1px solid #dde8dd' }}>
          <p style={{ fontSize: '28px', margin: 0 }}>📝</p>
          <p style={{ color: '#aaa', fontSize: '13px', margin: '1rem 0 0' }}>Sin actividad registrada aún</p>
        </div>
      ) : (
        filtered.map(log => {
          const cfg = actionConfig[log.action] || { label: log.action, bg: '#f5f5f5', color: '#888', ic: '•' };
          return (
            <div key={log.id} style={{ background: 'white', border: '1px solid #f0f0f0', borderRadius: '8px', padding: '0.8rem 1rem', marginBottom: '6px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '18px', flexShrink: 0, marginTop: '1px' }}>{cfg.ic}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px', background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#333' }}>{log.admin_name}</span>
                  </div>
                  <span style={{ fontSize: '10px', color: '#aaa', whiteSpace: 'nowrap' }}>
                    {new Date(log.created_at).toLocaleString('es-CL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                {log.details && <p style={{ fontSize: '12px', color: '#555', margin: '4px 0 0' }}>{log.details}</p>}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ─── ANALÍTICA ────────────────────────────────────────────────────────────────

const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const clp = n => '$' + Math.round(n || 0).toLocaleString('es-CL');

function parseOrderItems(ord) {
  try { return Array.isArray(ord.items) ? ord.items : JSON.parse(ord.items); } catch { return []; }
}

// Assigns a calendar bucket (month / quarter / year) to a date string
function bucketOf(dateStr, gran) {
  if (!dateStr) return { key: 'sin-fecha', label: 'Sin fecha' };
  const iso = dateStr.length === 10 ? dateStr + 'T12:00:00' : dateStr;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { key: 'sin-fecha', label: 'Sin fecha' };
  const y = d.getFullYear(), m = d.getMonth();
  if (gran === 'anio') return { key: String(y), label: String(y) };
  if (gran === 'trimestre') { const q = Math.floor(m / 3) + 1; return { key: `${y}-Q${q}`, label: `Q${q} ${y}` }; }
  return { key: `${y}-${String(m + 1).padStart(2, '0')}`, label: `${MONTHS_ES[m]} ${y}` };
}

// Vertical bar chart (single series) — dependency-free
function TrendBars({ data, color, fmt }) {
  if (!data || data.length === 0) return <p style={{ color: '#aaa', fontSize: '12px', textAlign: 'center', padding: '1.5rem 0', margin: 0 }}>Sin datos suficientes para mostrar tendencia</p>;
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '150px', padding: '8px 0', overflowX: 'auto' }}>
      {data.map(d => (
        <div key={d.key} style={{ minWidth: '38px', flex: '1 0 38px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', height: '100%', justifyContent: 'flex-end' }}>
          <span style={{ fontSize: '9px', fontWeight: 700, color, whiteSpace: 'nowrap' }}>{fmt(d.value)}</span>
          <div title={`${d.label}: ${fmt(d.value)}`} style={{ width: '72%', height: `${Math.max((d.value / max) * 105, 2)}px`, background: color, borderRadius: '4px 4px 0 0' }} />
          <span style={{ fontSize: '9px', color: '#888', whiteSpace: 'nowrap' }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// Grouped bars: ingresos vs egresos
function DualBars({ data }) {
  if (!data || data.length === 0) return <p style={{ color: '#aaa', fontSize: '12px', textAlign: 'center', padding: '1.5rem 0', margin: 0 }}>Sin movimientos de caja en el rango</p>;
  const max = Math.max(...data.flatMap(d => [d.ing, d.egr]), 1);
  return (
    <div>
      <div style={{ display: 'flex', gap: '14px', marginBottom: '8px', fontSize: '11px' }}>
        <span style={{ color: '#2e7d32', fontWeight: 600 }}>■ Ingresos</span>
        <span style={{ color: '#c62828', fontWeight: 600 }}>■ Egresos</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', height: '150px', padding: '8px 0', overflowX: 'auto' }}>
        {data.map(d => (
          <div key={d.key} style={{ minWidth: '50px', flex: '1 0 50px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', height: '100%', justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '105px' }}>
              <div title={`Ingresos: ${clp(d.ing)}`} style={{ width: '14px', height: `${Math.max((d.ing / max) * 105, 2)}px`, background: '#2e7d32', borderRadius: '3px 3px 0 0' }} />
              <div title={`Egresos: ${clp(d.egr)}`} style={{ width: '14px', height: `${Math.max((d.egr / max) * 105, 2)}px`, background: '#c62828', borderRadius: '3px 3px 0 0' }} />
            </div>
            <span style={{ fontSize: '9px', color: '#888', whiteSpace: 'nowrap' }}>{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Ranking with per-row data lineage (answers "qué datos construyen el indicador")
function RankingCard({ title, subtitle, icon, color, accentBg, rows, emptyMsg }) {
  const [open, setOpen] = useState(null);
  const top = rows.slice(0, 8);
  const max = Math.max(...top.map(r => r.value), 1);
  return (
    <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #e0e0e0', padding: '1.1rem', marginBottom: '1rem' }}>
      <div style={{ marginBottom: '0.9rem' }}>
        <p style={{ fontSize: '13px', fontWeight: 700, color: '#333', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>{icon} {title}</p>
        {subtitle && <p style={{ fontSize: '11px', color: '#aaa', margin: '2px 0 0' }}>{subtitle}</p>}
      </div>
      {top.length === 0 ? (
        <p style={{ color: '#aaa', fontSize: '12px', margin: 0 }}>{emptyMsg || 'Sin datos en el rango seleccionado'}</p>
      ) : top.map((r, i) => {
        const isOpen = open === r.key;
        return (
          <div key={r.key} style={{ marginBottom: '8px' }}>
            <div onClick={() => setOpen(isOpen ? null : r.key)}
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#bbb', width: '16px', flexShrink: 0 }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color, flexShrink: 0 }}>{r.valueLabel}</span>
                </div>
                <div style={{ height: '7px', background: '#f0f0f0', borderRadius: '4px', marginTop: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(r.value / max) * 100}%`, background: color, borderRadius: '4px' }} />
                </div>
                {r.sub && <p style={{ fontSize: '10px', color: '#aaa', margin: '2px 0 0' }}>{r.sub}</p>}
              </div>
              <span style={{ fontSize: '10px', color: '#bbb', flexShrink: 0 }}>{isOpen ? '▲' : '▼'}</span>
            </div>
            {isOpen && r.contributions && (
              <div style={{ margin: '6px 0 0 24px', padding: '8px 10px', background: accentBg || '#f9fafb', borderRadius: '6px', border: '1px solid #f0f0f0' }}>
                <p style={{ fontSize: '10px', color: '#888', margin: '0 0 6px', fontStyle: 'italic' }}>Datos que componen este valor:</p>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                  <thead>
                    <tr>{r.contribCols.map(c => <th key={c} style={{ textAlign: 'left', color: '#999', fontWeight: 600, padding: '2px 4px', fontSize: '10px' }}>{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {r.contributions.map((row, ri) => (
                      <tr key={ri}>{row.map((cell, ci) => <td key={ci} style={{ padding: '3px 4px', borderTop: '1px solid #f0f0f0', color: ci === 0 ? '#333' : '#666', fontWeight: ci === 0 ? 500 : 400 }}>{cell}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function AdminAnalytics({ families = [], products = [] }) {
  const [granularity, setGranularity] = useState('mes');
  const [selectedBucket, setSelectedBucket] = useState('all');
  const [allOrders, setAllOrders] = useState([]);
  const [allCash, setAllCash] = useState([]);
  const [allPeriods, setAllPeriods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedKpi, setExpandedKpi] = useState(null);

  useEffect(() => {
    Promise.all([getAllSealedOrders(), getAllCashFlow(), getAllPeriods()]).then(([o, c, p]) => {
      setAllOrders(o); setAllCash(c); setAllPeriods(p); setLoading(false);
    });
  }, []);

  const famList = useMemo(() => families.filter(f => f.role === 'familia'), [families]);
  const famById = useMemo(() => { const m = {}; families.forEach(f => { m[f.id] = f; }); return m; }, [families]);
  const famName = id => (famById[id] && famById[id].name) || 'Familia';
  const prodCat = useMemo(() => { const m = {}; products.forEach(p => { m[p.id] = p.category; }); return m; }, [products]);
  const cargoByPeriod = useMemo(() => { const m = {}; allPeriods.forEach(p => { m[p.id] = p.fixed_charge != null ? p.fixed_charge : 4000; }); return m; }, [allPeriods]);

  // Enrich every order with cargo, gmv, parsed items and its time bucket.
  // Exclude admin-placed orders so family metrics (participación, rankings) stay accurate.
  const orders = useMemo(() => allOrders
    .filter(o => (famById[o.family_id] && famById[o.family_id].role) !== 'admin')
    .map(o => {
      const cargo = cargoByPeriod[o.period_id] != null ? cargoByPeriod[o.period_id] : 4000;
      const b = bucketOf(o.sealed_at, granularity);
      return { ...o, cargo, items: parseOrderItems(o), gmv: (o.total || 0) + cargo, bucketKey: b.key, bucketLabel: b.label };
    }), [allOrders, cargoByPeriod, granularity, famById]);

  const buckets = useMemo(() => {
    const map = new Map();
    orders.forEach(o => { if (!map.has(o.bucketKey)) map.set(o.bucketKey, o.bucketLabel); });
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([key, label]) => ({ key, label }));
  }, [orders]);

  const fOrders = selectedBucket === 'all' ? orders : orders.filter(o => o.bucketKey === selectedBucket);
  const cashInBucket = selectedBucket === 'all' ? allCash : allCash.filter(e => bucketOf(e.date, granularity).key === selectedBucket);
  const rangeLabel = selectedBucket === 'all' ? 'todo el histórico' : (buckets.find(b => b.key === selectedBucket) || {}).label || selectedBucket;

  // ── KPIs ──
  const gmv = fOrders.reduce((s, o) => s + o.gmv, 0);
  const sealedCount = fOrders.length;
  const ticket = sealedCount ? gmv / sealedCount : 0;
  const uniqueFams = new Set(fOrders.map(o => o.family_id)).size;
  const participation = famList.length ? (uniqueFams / famList.length) * 100 : 0;
  const retired = fOrders.filter(o => o.retired).length;
  const retiroRate = sealedCount ? (retired / sealedCount) * 100 : 0;
  const ingresos = cashInBucket.filter(e => e.type === 'ingreso').reduce((s, e) => s + (e.amount || 0), 0);
  const egresos = cashInBucket.filter(e => e.type === 'egreso').reduce((s, e) => s + (e.amount || 0), 0);
  const balanceCaja = ingresos - egresos;
  const deudaFams = famList.filter(f => (f.balance || 0) < 0).sort((a, b) => (a.balance || 0) - (b.balance || 0));
  const favorFams = famList.filter(f => (f.balance || 0) > 0).sort((a, b) => (b.balance || 0) - (a.balance || 0));
  const deudaTotal = deudaFams.reduce((s, f) => s + Math.abs(f.balance || 0), 0);
  const favorTotal = favorFams.reduce((s, f) => s + (f.balance || 0), 0);

  // ── Product / provider / category aggregation (with lineage) ──
  const prodAgg = useMemo(() => {
    const m = {};
    fOrders.forEach(o => o.items.forEach(it => {
      const qty = Number(it.qty) || 0, val = (Number(it.p) || 0) * qty;
      const k = it.n || 'Producto';
      if (!m[k]) m[k] = { name: k, unit: it.u, provider: it.pv || 'Sin proveedor', qty: 0, value: 0, contrib: {} };
      m[k].qty += qty; m[k].value += val;
      const fn = famName(o.family_id);
      if (!m[k].contrib[fn]) m[k].contrib[fn] = { qty: 0, value: 0 };
      m[k].contrib[fn].qty += qty; m[k].contrib[fn].value += val;
    }));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fOrders]);

  const provAgg = useMemo(() => {
    const m = {};
    fOrders.forEach(o => o.items.forEach(it => {
      const qty = Number(it.qty) || 0, val = (Number(it.p) || 0) * qty;
      const k = it.pv || 'Sin proveedor';
      if (!m[k]) m[k] = { value: 0, qty: 0, prods: {} };
      m[k].value += val; m[k].qty += qty;
      const pn = it.n || 'Producto';
      if (!m[k].prods[pn]) m[k].prods[pn] = { qty: 0, value: 0 };
      m[k].prods[pn].qty += qty; m[k].prods[pn].value += val;
    }));
    return m;
  }, [fOrders]);

  const catAgg = useMemo(() => {
    const m = {};
    fOrders.forEach(o => o.items.forEach(it => {
      const qty = Number(it.qty) || 0, val = (Number(it.p) || 0) * qty;
      const k = prodCat[it.id] || 'Sin categoría';
      if (!m[k]) m[k] = { value: 0, qty: 0, prods: {} };
      m[k].value += val; m[k].qty += qty;
      const pn = it.n || 'Producto';
      if (!m[k].prods[pn]) m[k].prods[pn] = { qty: 0, value: 0 };
      m[k].prods[pn].qty += qty; m[k].prods[pn].value += val;
    }));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fOrders]);

  const famAgg = useMemo(() => {
    const m = {};
    fOrders.forEach(o => {
      if (!m[o.family_id]) m[o.family_id] = { gmv: 0, orders: [] };
      m[o.family_id].gmv += o.gmv;
      m[o.family_id].orders.push(o);
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fOrders]);

  // ── Ranking rows ──
  const topProdQty = Object.values(prodAgg).map(p => ({
    key: p.name, label: p.name, sub: `${p.provider} · ${p.unit}`, value: p.qty, valueLabel: `${p.qty} ${p.unit || ''}`.trim(),
    contribCols: ['Familia', 'Cantidad', 'Valor'],
    contributions: Object.entries(p.contrib).sort((a, b) => b[1].qty - a[1].qty).map(([fn, v]) => [fn, `${v.qty} ${p.unit || ''}`.trim(), clp(v.value)])
  })).sort((a, b) => b.value - a.value);

  const topProdValue = Object.values(prodAgg).map(p => ({
    key: p.name, label: p.name, sub: `${p.provider} · ${p.qty} ${p.unit || ''}`.trim(), value: p.value, valueLabel: clp(p.value),
    contribCols: ['Familia', 'Cantidad', 'Valor'],
    contributions: Object.entries(p.contrib).sort((a, b) => b[1].value - a[1].value).map(([fn, v]) => [fn, `${v.qty} ${p.unit || ''}`.trim(), clp(v.value)])
  })).sort((a, b) => b.value - a.value);

  const topProv = Object.entries(provAgg).map(([name, p]) => ({
    key: name, label: name, sub: `${Object.keys(p.prods).length} productos distintos`, value: p.value, valueLabel: clp(p.value),
    contribCols: ['Producto', 'Cantidad', 'Valor'],
    contributions: Object.entries(p.prods).sort((a, b) => b[1].value - a[1].value).map(([pn, v]) => [pn, `${v.qty}`, clp(v.value)])
  })).sort((a, b) => b.value - a.value);

  const topCat = Object.entries(catAgg).map(([name, p]) => ({
    key: name, label: name, sub: `${Object.keys(p.prods).length} productos`, value: p.value, valueLabel: clp(p.value),
    contribCols: ['Producto', 'Cantidad', 'Valor'],
    contributions: Object.entries(p.prods).sort((a, b) => b[1].value - a[1].value).map(([pn, v]) => [pn, `${v.qty}`, clp(v.value)])
  })).sort((a, b) => b.value - a.value);

  const topFam = Object.entries(famAgg).map(([fid, p]) => ({
    key: fid, label: famName(fid), sub: `${p.orders.length} pedido(s)`, value: p.gmv, valueLabel: clp(p.gmv),
    contribCols: ['Período', 'Productos', 'Total'],
    contributions: p.orders.sort((a, b) => b.gmv - a.gmv).map(o => [o.bucketLabel, `${o.items.length} ítems`, clp(o.gmv)])
  })).sort((a, b) => b.value - a.value);

  const debtRank = deudaFams.map(f => ({
    key: f.id, label: f.name, sub: f.email || '', value: Math.abs(f.balance || 0), valueLabel: clp(Math.abs(f.balance || 0)),
    contribCols: ['Concepto', 'Monto'],
    contributions: [['Saldo pendiente actual', clp(Math.abs(f.balance || 0))]]
  }));

  // ── Trends across all buckets (evolution) ──
  const salesTrend = useMemo(() => {
    const m = new Map();
    orders.forEach(o => {
      if (!m.has(o.bucketKey)) m.set(o.bucketKey, { key: o.bucketKey, label: o.bucketLabel, gmv: 0, fams: new Set() });
      const e = m.get(o.bucketKey); e.gmv += o.gmv; e.fams.add(o.family_id);
    });
    return [...m.values()].sort((a, b) => (a.key < b.key ? -1 : 1)).slice(-12);
  }, [orders]);

  const cashTrend = useMemo(() => {
    const m = new Map();
    allCash.forEach(e => {
      const b = bucketOf(e.date, granularity);
      if (!m.has(b.key)) m.set(b.key, { key: b.key, label: b.label, ing: 0, egr: 0 });
      const x = m.get(b.key);
      if (e.type === 'ingreso') x.ing += e.amount || 0; else x.egr += e.amount || 0;
    });
    return [...m.values()].sort((a, b) => (a.key < b.key ? -1 : 1)).slice(-12);
  }, [allCash, granularity]);

  const partTrend = salesTrend.map(t => ({ key: t.key, label: t.label, value: famList.length ? Math.round((t.fams.size / famList.length) * 100) : 0 }));

  // ── KPI definitions with data lineage ──
  const kpis = [
    {
      id: 'gmv', icon: '💰', label: 'Ventas totales (GMV)', value: clp(gmv), color: '#2e7d32', bg: '#e8f5e9',
      definition: 'Valor total de todos los pedidos sellados en el rango, incluyendo el cargo fijo.',
      formula: 'Σ (subtotal de productos + cargo fijo) de cada pedido sellado.',
      cols: ['Familia', 'Subtotal + Cargo', 'Total'],
      rows: [...fOrders].sort((a, b) => b.gmv - a.gmv).map(o => [famName(o.family_id), `${clp(o.total)} + ${clp(o.cargo)}`, clp(o.gmv)]),
      footer: ['Total', '', clp(gmv)]
    },
    {
      id: 'orders', icon: '📦', label: 'Pedidos sellados', value: String(sealedCount), color: '#1565c0', bg: '#e3f2fd',
      definition: 'Cantidad de pedidos que las familias confirmaron (sellaron) en el rango.',
      formula: 'Conteo de registros en pedidos sellados dentro del rango.',
      cols: ['Familia', 'Período', 'Total'],
      rows: [...fOrders].sort((a, b) => b.gmv - a.gmv).map(o => [famName(o.family_id), o.bucketLabel, clp(o.gmv)])
    },
    {
      id: 'ticket', icon: '🎯', label: 'Ticket promedio', value: clp(ticket), color: '#6a1b9a', bg: '#f3e5f5',
      definition: 'Cuánto gasta en promedio una familia por pedido.',
      formula: `GMV (${clp(gmv)}) ÷ N° de pedidos (${sealedCount}) = ${clp(ticket)}`,
      cols: ['Familia', 'Total del pedido'],
      rows: [...fOrders].sort((a, b) => b.gmv - a.gmv).map(o => [famName(o.family_id), clp(o.gmv)])
    },
    {
      id: 'part', icon: '👥', label: 'Participación', value: `${Math.round(participation)}%`, color: '#00838f', bg: '#e0f7fa',
      definition: 'Porcentaje de familias que hicieron al menos un pedido en el rango.',
      formula: `Familias que pidieron (${uniqueFams}) ÷ Total de familias (${famList.length}) = ${Math.round(participation)}%`,
      cols: ['Familia', '¿Pidió?'],
      rows: famList.map(f => [f.name, new Set(fOrders.map(o => o.family_id)).has(f.id) ? '✓ Sí' : '— No'])
    },
    {
      id: 'retiro', icon: '🚚', label: 'Tasa de retiro', value: `${Math.round(retiroRate)}%`, color: '#e65100', bg: '#fff3e0',
      definition: 'De los pedidos sellados, cuántos fueron efectivamente retirados/entregados.',
      formula: `Pedidos retirados (${retired}) ÷ Pedidos sellados (${sealedCount}) = ${Math.round(retiroRate)}%`,
      cols: ['Familia', 'Estado'],
      rows: [...fOrders].sort((a, b) => (b.retired === a.retired ? 0 : b.retired ? -1 : 1)).map(o => [famName(o.family_id), o.retired ? '✓ Retirado' : '⏳ Pendiente'])
    },
    {
      id: 'ing', icon: '↑', label: 'Ingresos (caja)', value: clp(ingresos), color: '#2e7d32', bg: '#e8f5e9',
      definition: 'Dinero efectivamente recibido (pagos de familias, abonos) registrado en Flujo de Caja.',
      formula: 'Σ de movimientos tipo "ingreso" en el rango.',
      cols: ['Fecha', 'Descripción', 'Monto'],
      rows: cashInBucket.filter(e => e.type === 'ingreso').map(e => [new Date(e.date).toLocaleDateString('es-CL'), (e.family_name ? e.family_name + ' · ' : '') + e.description, clp(e.amount)]),
      footer: ['', 'Total ingresos', clp(ingresos)]
    },
    {
      id: 'egr', icon: '↓', label: 'Egresos (caja)', value: clp(egresos), color: '#c62828', bg: '#ffebee',
      definition: 'Gastos y compras registrados en Flujo de Caja.',
      formula: 'Σ de movimientos tipo "egreso" en el rango.',
      cols: ['Fecha', 'Descripción', 'Monto'],
      rows: cashInBucket.filter(e => e.type === 'egreso').map(e => [new Date(e.date).toLocaleDateString('es-CL'), e.description, clp(e.amount)]),
      footer: ['', 'Total egresos', clp(egresos)]
    },
    {
      id: 'balcaja', icon: '⚖️', label: 'Balance de caja', value: clp(balanceCaja), color: balanceCaja >= 0 ? '#2e7d32' : '#c62828', bg: balanceCaja >= 0 ? '#e8f5e9' : '#ffebee',
      definition: 'Diferencia entre lo que entró y lo que salió de la caja en el rango.',
      formula: `Ingresos (${clp(ingresos)}) − Egresos (${clp(egresos)}) = ${clp(balanceCaja)}`,
      cols: ['Concepto', 'Monto'],
      rows: [['Ingresos', clp(ingresos)], ['Egresos', '− ' + clp(egresos)]],
      footer: ['Balance', clp(balanceCaja)]
    },
    {
      id: 'deuda', icon: '⚠️', label: 'Saldos pendientes (total)', value: clp(deudaTotal), color: '#c62828', bg: '#ffebee', global: true,
      definition: 'Suma de los saldos pendientes de todas las familias, en este momento (no depende del rango).',
      formula: 'Σ |saldo| de familias con saldo negativo.',
      cols: ['Familia', 'Saldo pendiente'],
      rows: deudaFams.map(f => [f.name, clp(Math.abs(f.balance || 0))]),
      footer: ['Total', clp(deudaTotal)]
    },
    {
      id: 'favor', icon: '✅', label: 'Saldo a favor (actual)', value: clp(favorTotal), color: '#2e7d32', bg: '#e8f5e9', global: true,
      definition: 'Suma de saldos a favor de todas las familias, en este momento.',
      formula: 'Σ saldo de familias con saldo positivo.',
      cols: ['Familia', 'A favor'],
      rows: favorFams.map(f => [f.name, clp(f.balance || 0)]),
      footer: ['Total', clp(favorTotal)]
    },
  ];

  // ── Automatic plain-language insights ──
  const insights = [];
  if (topProdValue[0]) insights.push({ ic: '⭐', txt: `Producto estrella: **${topProdValue[0].label}** con ${clp(topProdValue[0].value)} en ventas.` });
  if (topProv[0]) insights.push({ ic: '🏭', txt: `Proveedor principal: **${topProv[0].label}** concentra ${clp(topProv[0].value)} de los pedidos.` });
  if (topFam[0]) insights.push({ ic: '🛒', txt: `Familia que más compra: **${topFam[0].label}** con ${clp(topFam[0].value)}.` });
  if (debtRank[0]) insights.push({ ic: '⚠️', txt: `Mayor saldo pendiente: **${debtRank[0].label}** debe ${clp(debtRank[0].value)}. Saldos pendientes de la cooperativa: ${clp(deudaTotal)}.` });
  if (sealedCount > 0) insights.push({ ic: '📊', txt: `Participación de ${Math.round(participation)}%: ${uniqueFams} de ${famList.length} familias compraron en ${rangeLabel}.` });

  const renderInsight = (txt) => {
    const parts = txt.split(/\*\*(.*?)\*\*/g);
    return parts.map((p, i) => i % 2 === 1 ? <strong key={i} style={{ color: '#1a1a1a' }}>{p}</strong> : <span key={i}>{p}</span>);
  };

  if (loading) return <p style={{ color: '#888', fontSize: '13px' }}>Cargando analítica...</p>;

  if (allOrders.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem', background: 'white', borderRadius: '10px', border: '1px solid #dde8dd' }}>
        <p style={{ fontSize: '36px', margin: 0 }}>📈</p>
        <p style={{ color: '#555', fontSize: '14px', margin: '1rem 0 0', fontWeight: 500 }}>Aún no hay pedidos sellados para analizar</p>
        <p style={{ color: '#aaa', fontSize: '12px', margin: '4px 0 0' }}>Los indicadores aparecerán a medida que las familias realicen pedidos.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Controles de rango */}
      <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #dde8dd', padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: '11px', color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>Granularidad</p>
            <div style={{ display: 'flex', gap: '6px' }}>
              {[{ k: 'mes', l: 'Mensual' }, { k: 'trimestre', l: 'Trimestral' }, { k: 'anio', l: 'Anual' }].map(g => (
                <button key={g.k} onClick={() => { setGranularity(g.k); setSelectedBucket('all'); }}
                  style={{ padding: '6px 14px', borderRadius: '20px', border: '1px solid', cursor: 'pointer', fontSize: '12px', fontWeight: granularity === g.k ? 700 : 400, background: granularity === g.k ? '#1565c0' : 'white', borderColor: granularity === g.k ? '#1565c0' : '#dde8dd', color: granularity === g.k ? 'white' : '#555' }}>
                  {g.l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p style={{ fontSize: '11px', color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>Período</p>
            <select value={selectedBucket} onChange={e => setSelectedBucket(e.target.value)}
              style={{ padding: '7px 12px', border: '1px solid #dde8dd', borderRadius: '8px', fontSize: '13px', background: 'white', minWidth: '160px' }}>
              <option value="all">Todo el histórico</option>
              {buckets.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
          </div>
        </div>
        <p style={{ fontSize: '11px', color: '#aaa', margin: '10px 0 0' }}>
          Mostrando datos de <strong style={{ color: '#1565c0' }}>{rangeLabel}</strong>. Haz clic en cualquier indicador para ver los datos exactos que lo componen.
        </p>
      </div>

      {/* Insights automáticos */}
      {insights.length > 0 && (
        <div style={{ background: 'linear-gradient(135deg, #e3f2fd 0%, #e8f5e9 100%)', borderRadius: '10px', border: '1px solid #c8e6c9', padding: '1.1rem', marginBottom: '1rem' }}>
          <p style={{ fontSize: '12px', fontWeight: 700, color: '#1565c0', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>💡 Resumen inteligente — {rangeLabel}</p>
          <div style={{ display: 'grid', gap: '8px' }}>
            {insights.map((ins, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '13px', color: '#444' }}>
                <span style={{ flexShrink: 0 }}>{ins.ic}</span>
                <span>{renderInsight(ins.txt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px', marginBottom: '0.5rem' }}>
        {kpis.map(k => (
          <div key={k.id} className="lift" onClick={() => setExpandedKpi(expandedKpi === k.id ? null : k.id)}
            style={{ padding: '0.9rem', background: k.bg, borderRadius: '10px', border: `1px solid ${expandedKpi === k.id ? k.color : k.color + '22'}`, cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '18px' }}>{k.icon}</span>
              <span style={{ fontSize: '9px', color: k.color, opacity: 0.7 }}>{expandedKpi === k.id ? '▲' : 'ⓘ'}</span>
            </div>
            <p style={{ fontSize: '10px', color: '#666', margin: '6px 0 0', fontWeight: 500 }}>{k.label}</p>
            <p style={{ fontSize: '18px', fontWeight: 700, margin: '2px 0 0', color: k.color }}>{k.value}</p>
            {k.global && <span style={{ fontSize: '8px', color: '#999', fontStyle: 'italic' }}>valor actual</span>}
          </div>
        ))}
      </div>

      {/* KPI detail panel (data lineage) */}
      {expandedKpi && (() => {
        const k = kpis.find(x => x.id === expandedKpi);
        if (!k) return null;
        return (
          <div style={{ background: 'white', border: `1.5px solid ${k.color}`, borderRadius: '10px', padding: '1.1rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
              <div>
                <p style={{ fontSize: '14px', fontWeight: 700, color: k.color, margin: 0 }}>{k.icon} {k.label} = {k.value}</p>
                <p style={{ fontSize: '12px', color: '#555', margin: '4px 0 0' }}>{k.definition}</p>
              </div>
              <button onClick={() => setExpandedKpi(null)} style={{ background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', padding: '3px 8px', color: '#888' }}>✕ Cerrar</button>
            </div>
            <div style={{ background: '#f8f9fa', borderRadius: '6px', padding: '8px 12px', marginBottom: '10px' }}>
              <p style={{ fontSize: '11px', color: '#888', margin: 0 }}><strong style={{ color: '#555' }}>Cómo se calcula:</strong> {k.formula}</p>
            </div>
            {k.rows && k.rows.length > 0 ? (
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'white' }}>
                    <tr>{k.cols.map(c => <th key={c} style={{ textAlign: 'left', padding: '6px 8px', color: '#999', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '2px solid #f0f0f0' }}>{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {k.rows.map((row, ri) => (
                      <tr key={ri}>{row.map((cell, ci) => <td key={ci} style={{ padding: '5px 8px', borderBottom: '1px solid #f5f5f5', color: ci === 0 ? '#333' : '#555', fontWeight: ci === 0 ? 500 : 400 }}>{cell}</td>)}</tr>
                    ))}
                  </tbody>
                  {k.footer && (
                    <tfoot>
                      <tr>{k.footer.map((cell, ci) => <td key={ci} style={{ padding: '7px 8px', borderTop: '2px solid #e0e0e0', color: k.color, fontWeight: 700 }}>{cell}</td>)}</tr>
                    </tfoot>
                  )}
                </table>
              </div>
            ) : <p style={{ fontSize: '12px', color: '#aaa', margin: 0 }}>Sin datos individuales en este rango.</p>}
          </div>
        );
      })()}

      {/* Gráficos de tendencia */}
      <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #dde8dd', padding: '1.1rem', marginBottom: '1rem' }}>
        <p style={{ fontSize: '13px', fontWeight: 700, color: '#333', margin: '0 0 4px' }}>📈 Evolución de ventas</p>
        <p style={{ fontSize: '11px', color: '#aaa', margin: '0 0 8px' }}>GMV por {granularity === 'mes' ? 'mes' : granularity === 'trimestre' ? 'trimestre' : 'año'} (últimos 12 · todo el histórico)</p>
        <TrendBars data={salesTrend.map(t => ({ key: t.key, label: t.label, value: t.gmv }))} color="#2e7d32" fmt={v => clp(v)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #dde8dd', padding: '1.1rem' }}>
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#333', margin: '0 0 4px' }}>💵 Ingresos vs Egresos</p>
          <p style={{ fontSize: '11px', color: '#aaa', margin: '0 0 8px' }}>Flujo de caja por período</p>
          <DualBars data={cashTrend} />
        </div>
        <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #dde8dd', padding: '1.1rem' }}>
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#333', margin: '0 0 4px' }}>👥 Participación</p>
          <p style={{ fontSize: '11px', color: '#aaa', margin: '0 0 8px' }}>% de familias que compraron por período</p>
          <TrendBars data={partTrend} color="#1565c0" fmt={v => v + '%'} />
        </div>
      </div>

      {/* Rankings */}
      <p style={{ fontSize: '12px', fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '1.5rem 0 0.75rem' }}>Rankings — {rangeLabel}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
        <RankingCard icon="🥇" title="Top productos por valor" subtitle="Cuánto dinero genera cada producto" color="#2e7d32" accentBg="#f1f8f1" rows={topProdValue} />
        <RankingCard icon="📦" title="Top productos por cantidad" subtitle="Los más pedidos en unidades" color="#1565c0" accentBg="#eef5fc" rows={topProdQty} />
        <RankingCard icon="🏭" title="Top proveedores" subtitle="Por valor total solicitado" color="#6a1b9a" accentBg="#f7f0fa" rows={topProv} />
        <RankingCard icon="🏷️" title="Top categorías" subtitle="Por valor total" color="#00838f" accentBg="#e9f8fa" rows={topCat} />
        <RankingCard icon="🛒" title="Familias que más compran" subtitle="Por valor total de pedidos" color="#e65100" accentBg="#fdf3ea" rows={topFam} />
        <RankingCard icon="⚠️" title="Familias con más saldo pendiente" subtitle="Saldo pendiente actual" color="#c62828" accentBg="#fdeeee" rows={debtRank} emptyMsg="Ninguna familia tiene saldo pendiente 🎉" />
      </div>

      <p style={{ fontSize: '11px', color: '#bbb', textAlign: 'center', margin: '1.5rem 0 0' }}>
        Todos los indicadores se calculan en tiempo real desde los pedidos, saldos y flujo de caja. Sin servicios externos.
      </p>
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
