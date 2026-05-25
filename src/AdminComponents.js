import React, { useState } from 'react';
import { addFamily, addProduct, updateProduct, updatePeriod, addInventoryEntry, updateInventory } from './supabaseClient';

const CARGO = 4000;

export function AdminFamilias({ families, setFamilies, sealed }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', balance: '0' });
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAdd = async () => {
    if (!form.name.trim()) { setErr('El nombre es obligatorio'); return; }
    if (!form.email.includes('@')) { setErr('Email inválido'); return; }
    
    setLoading(true);
    const newFamily = {
      id: Date.now().toString(),
      name: form.name.trim(),
      initials: form.name.split(' ').slice(0, 2).map(w => w[0]).join(''),
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

  const na = families.filter(f => f.role === 'familia');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <p style={{ fontSize: '13px', fontWeight: 500, color: '#666' }}>{na.length} familias registradas</p>
        {!showForm && <button onClick={() => setShowForm(true)} style={{ padding: '6px 14px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>+ Nueva familia</button>}
      </div>

      {showForm && (
        <div style={{ padding: '1rem', background: 'white', border: '1px solid #4CAF50', borderRadius: '6px', marginBottom: '1rem' }}>
          <p style={{ fontWeight: 500, fontSize: '14px', color: '#4CAF50', margin: 0, marginBottom: '1rem' }}>Agregar nueva familia</p>
          <div style={{ display: 'grid', gap: '10px', marginBottom: '1rem' }}>
            <div>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Nombre completo *</label>
              <input type="text" placeholder="Ej: Familia González" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} style={{ width: '100%', padding: '6px', border: '1px solid #ddd', borderRadius: '4px' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Correo electrónico *</label>
              <input type="email" placeholder="correo@ejemplo.com" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} style={{ width: '100%', padding: '6px', border: '1px solid #ddd', borderRadius: '4px' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Saldo inicial</label>
              <input type="number" placeholder="0" value={form.balance} onChange={e => setForm(p => ({ ...p, balance: e.target.value }))} style={{ width: '100%', padding: '6px', border: '1px solid #ddd', borderRadius: '4px' }} />
            </div>
          </div>
          {err && <p style={{ fontSize: '12px', color: '#d32f2f', margin: '0 0 1rem 0' }}>{err}</p>}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleAdd} disabled={loading} style={{ flex: 1, padding: '6px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}>{loading ? 'Guardando...' : 'Agregar familia'}</button>
            <button onClick={() => { setShowForm(false); setErr(''); }} style={{ flex: 1, padding: '6px', background: 'white', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Cancelar</button>
          </div>
        </div>
      )}

      {na.map(f => (
        <div key={f.id} style={{ padding: '1rem', background: 'white', border: '1px solid #eee', borderRadius: '6px', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#4CAF50', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 600 }}>{f.initials}</div>
            <div>
              <p style={{ fontSize: '13px', fontWeight: 500, margin: 0 }}>{f.name}</p>
              <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>{f.email}</p>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {sealed[f.id] ? <span style={{ fontSize: '10px', fontWeight: 500, padding: '3px 7px', borderRadius: '6px', background: sealed[f.id].retired ? '#e8f5e9' : '#e3f2fd', color: sealed[f.id].retired ? '#0a7e0f' : '#0066cc' }}>{sealed[f.id].retired ? '✓ Entregado' : '✓ Sellado'}</span> : <span style={{ fontSize: '10px', padding: '3px 7px', borderRadius: '6px', background: '#f5f5f5', color: '#999' }}>Sin pedido</span>}
            {f.balance !== 0 && <p style={{ fontSize: '11px', margin: '4px 0 0', color: f.balance > 0 ? '#0a7e0f' : '#d32f2f', fontWeight: 500 }}>{f.balance > 0 ? '+' : ''}${Math.abs(f.balance).toLocaleString('es-CL')}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AdminProductos({ products, setProducts }) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: '', category: 'Cereales', price: '', unit: '', provider: '', in_stock: true });
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [srch, setSrch] = useState('');

  const handleSaveNew = async () => {
    if (!form.name.trim() || !form.price || !form.unit || !form.provider) { setErr('Todos los campos son obligatorios'); return; }
    
    setLoading(true);
    const newProduct = {
      id: Math.max(...products.map(p => p.id), 0) + 1,
      name: form.name.trim(),
      category: form.category,
      price: parseInt(form.price),
      unit: form.unit.trim(),
      provider: form.provider.trim(),
      in_stock: form.in_stock
    };
    
    const result = await addProduct(newProduct);
    if (result) {
      setProducts(p => [...p, newProduct]);
      setForm({ name: '', category: 'Cereales', price: '', unit: '', provider: '', in_stock: true });
      setErr('');
      setShowForm(false);
    } else {
      setErr('Error al agregar producto');
    }
    setLoading(false);
  };

  const handleEdit = async () => {
    if (!form.name.trim() || !form.price || !form.unit || !form.provider) { setErr('Todos los campos son obligatorios'); return; }
    
    setLoading(true);
    const updates = {
      name: form.name.trim(),
      category: form.category,
      price: parseInt(form.price),
      unit: form.unit.trim(),
      provider: form.provider.trim(),
      in_stock: form.in_stock
    };
    
    const result = await updateProduct(editId, updates);
    if (result) {
      setProducts(p => p.map(x => x.id === editId ? { ...x, ...updates } : x));
      setEditId(null);
      setErr('');
    } else {
      setErr('Error al actualizar producto');
    }
    setLoading(false);
  };

  const toggleStock = async (id) => {
    const pr = products.find(p => p.id === id);
    const result = await updateProduct(id, { in_stock: !pr.in_stock });
    if (result) {
      setProducts(p => p.map(x => x.id === id ? { ...x, in_stock: !x.in_stock } : x));
    }
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
        <p style={{ fontSize: '13px', fontWeight: 500, color: '#666' }}>{products.length} productos</p>
        {!showForm && !editId && <button onClick={() => { setShowForm(true); setErr(''); }} style={{ padding: '6px 14px', background: '#0066cc', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>+ Nuevo producto</button>}
      </div>

      {(showForm || editId) && (
        <div style={{ padding: '1rem', background: 'white', border: `1px solid ${editId ? '#f57c00' : '#0066cc'}`, borderRadius: '6px', marginBottom: '1rem' }}>
          <p style={{ fontWeight: 500, fontSize: '14px', color: editId ? '#f57c00' : '#0066cc', margin: 0, marginBottom: '1rem' }}>{editId ? 'Editar' : 'Nuevo'} producto</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '1rem' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Nombre *</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} style={{ width: '100%', padding: '6px', border: '1px solid #ddd', borderRadius: '4px' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Categoría</label>
              <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} style={{ width: '100%', padding: '6px', border: '1px solid #ddd', borderRadius: '4px' }}>
                {['Cereales', 'Legumbres', 'Semillas', 'Harinas', 'Té y Café', 'Aceites', 'Aseo', 'Dulces', 'Pan', 'Miel', 'Aliños'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Proveedor *</label>
              <input type="text" value={form.provider} onChange={e => setForm(p => ({ ...p, provider: e.target.value }))} style={{ width: '100%', padding: '6px', border: '1px solid #ddd', borderRadius: '4px' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Precio CLP *</label>
              <input type="number" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} style={{ width: '100%', padding: '6px', border: '1px solid #ddd', borderRadius: '4px' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>Unidad *</label>
              <input type="text" placeholder="Kg, 500 gr, un..." value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))} style={{ width: '100%', padding: '6px', border: '1px solid #ddd', borderRadius: '4px' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" id="stock" checked={form.in_stock} onChange={e => setForm(p => ({ ...p, in_stock: e.target.checked }))} />
              <label htmlFor="stock" style={{ fontSize: '12px', cursor: 'pointer', margin: 0 }}>Con stock</label>
            </div>
          </div>
          {err && <p style={{ fontSize: '12px', color: '#d32f2f', margin: '0 0 1rem 0' }}>{err}</p>}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={editId ? handleEdit : handleSaveNew} disabled={loading} style={{ flex: 1, padding: '6px', background: editId ? '#f57c00' : '#0066cc', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}>{loading ? 'Guardando...' : editId ? 'Actualizar' : 'Agregar'}</button>
            <button onClick={() => { setShowForm(false); setEditId(null); setErr(''); }} style={{ flex: 1, padding: '6px', background: 'white', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Cancelar</button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: '1rem' }}>
        <input type="text" placeholder="Buscar..." value={srch} onChange={e => setSrch(e.target.value)} style={{ width: '100%', padding: '6px', border: '1px solid #ddd', borderRadius: '4px' }} />
      </div>

      {vis.map(pr => (
        <div key={pr.id} style={{ padding: '1rem', background: 'white', border: '1px solid #eee', borderRadius: '6px', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: '13px', fontWeight: 500, margin: 0 }}>{pr.name}</p>
            <p style={{ fontSize: '11px', color: '#666', margin: '4px 0 0' }}>{pr.category} · {pr.provider} · {pr.unit} · ${pr.price.toLocaleString('es-CL')}</p>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={() => toggleStock(pr.id)} style={{ fontSize: '10px', fontWeight: 500, padding: '2px 7px', borderRadius: '4px', border: '0.5px solid', cursor: 'pointer', background: pr.in_stock ? '#e8f5e9' : '#f5f5f5', borderColor: pr.in_stock ? '#4CAF50' : '#ddd', color: pr.in_stock ? '#0a7e0f' : '#999' }}>{pr.in_stock ? '✓ Stock' : 'Sin stock'}</button>
            <button onClick={() => startEdit(pr)} style={{ fontSize: '10px', padding: '2px 7px', border: '0.5px solid #ddd', background: 'white', borderRadius: '4px', cursor: 'pointer', color: '#666' }}>Editar</button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function AdminPeriodo({ period, setPeriod, families, sealed }) {
  const [dates, setDates] = useState({ date_from: period?.date_from || '', date_to: period?.date_to || '', date_delivery: period?.date_delivery || '' });
  const [loading, setLoading] = useState(false);

  const na = families.filter(f => f.role === 'familia');
  const sc = Object.keys(sealed).length;
  const pct = Math.round(sc / na.length * 100);

  const handleSaveDates = async () => {
    setLoading(true);
    const result = await updatePeriod(period.id, dates);
    if (result) {
      setPeriod(p => ({ ...p, ...dates }));
    }
    setLoading(false);
  };

  return (
    <div>
      <div style={{ padding: '1.5rem', background: 'white', borderRadius: '6px', border: '1px solid #eee', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <div>
            <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>Período activo</p>
            <p style={{ fontSize: '20px', fontWeight: 600, margin: '6px 0 0' }}>{period?.label}</p>
          </div>
          <span style={{ fontSize: '10px', fontWeight: 600, padding: '4px 10px', borderRadius: '10px', background: '#e8f5e9', color: '#0a7e0f' }}>Activo</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
          {[{ l: 'Familias', v: na.length }, { l: 'Sellados', v: sc }, { l: 'Completitud', v: pct + '%' }].map(m => (
            <div key={m.l} style={{ padding: '1rem', background: '#f9f9f9', borderRadius: '4px', textAlign: 'center' }}>
              <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>{m.l}</p>
              <p style={{ fontSize: '18px', fontWeight: 600, margin: '6px 0 0' }}>{m.v}</p>
            </div>
          ))}
        </div>

        <div style={{ height: '6px', background: '#f5f5f5', borderRadius: '3px', marginBottom: '1.5rem' }}>
          <div style={{ height: '6px', width: pct + '%', background: '#4CAF50', borderRadius: '3px' }} />
        </div>

        <p style={{ fontSize: '13px', fontWeight: 500, margin: 0, marginBottom: '1rem' }}>Fechas importantes (visibles para todas las familias)</p>
        <div style={{ display: 'grid', gap: '10px', marginBottom: '1.5rem' }}>
          {[{ key: 'date_from', l: 'Apertura de pedidos' }, { key: 'date_to', l: 'Cierre de pedidos' }, { key: 'date_delivery', l: 'Fecha de entrega' }].map(f => (
            <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <label style={{ fontSize: '12px', color: '#666', minWidth: '180px' }}>{f.l}</label>
              <input type="date" value={dates[f.key]} onChange={e => setDates(p => ({ ...p, [f.key]: e.target.value }))} style={{ flex: 1, padding: '6px', border: '1px solid #ddd', borderRadius: '4px' }} />
            </div>
          ))}
        </div>

        <button onClick={handleSaveDates} disabled={loading} style={{ width: '100%', padding: '8px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 500, fontSize: '13px' }}>{loading ? 'Guardando...' : '✓ Guardar fechas'}</button>
      </div>
    </div>
  );
}