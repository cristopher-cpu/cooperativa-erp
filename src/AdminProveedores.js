import React, { useState } from 'react';
import { addProvider, updateProvider, deleteProvider, syncProviderNameOnProducts } from './supabaseClient';

// ─── PROVEEDORES ──────────────────────────────────────────────────────────────
// Los proveedores dejaron de ser texto libre dentro de cada producto y pasaron a
// ser una entidad propia (Fase 2, etapa 1). products.provider_id apunta acá, y
// products.provider (texto) se mantiene sincronizado para no romper la búsqueda
// del catálogo ni los items ya congelados dentro de sealed_orders.

export function AdminProveedores({ providers, setProviders, products, setProducts }) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const emptyForm = { name: '', email: '', contact: '', phone: '', notes: '', is_member: false, active: true };
  const [form, setForm] = useState(emptyForm);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [srch, setSrch] = useState('');

  const countFor = (pid) => products.filter(p => p.provider_id === pid).length;
  const sinCorreo = providers.filter(p => p.active && !p.email);

  // Varios proveedores con el mismo correo solo puede significar que son de relleno.
  // Sin este aviso es demasiado fácil llegar al Go Live mandándole todas las órdenes
  // a la misma casilla y creer que salieron.
  const correosRepetidos = (() => {
    const g = {};
    providers.filter(p => p.active && p.email).forEach(p => {
      const k = p.email.trim().toLowerCase();
      (g[k] = g[k] || []).push(p.name);
    });
    return Object.entries(g).filter(([, names]) => names.length > 1);
  })();

  const startNew = () => { setForm(emptyForm); setEditId(null); setShowForm(true); setErr(''); };

  const startEdit = (pv) => {
    setForm({
      name: pv.name || '', email: pv.email || '', contact: pv.contact || '',
      phone: pv.phone || '', notes: pv.notes || '',
      is_member: !!pv.is_member, active: pv.active !== false
    });
    setEditId(pv.id); setShowForm(false); setErr('');
  };

  const cancel = () => { setShowForm(false); setEditId(null); setErr(''); };

  const validate = () => {
    if (!form.name.trim()) return 'El nombre es obligatorio';
    if (form.email.trim() && !form.email.includes('@')) return 'El correo no parece válido';
    const dup = providers.find(p => p.name.toLowerCase() === form.name.trim().toLowerCase() && p.id !== editId);
    if (dup) return 'Ya existe un proveedor llamado "' + dup.name + '"';
    return '';
  };

  const handleSave = async () => {
    const v = validate();
    if (v) { setErr(v); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      contact: form.contact.trim() || null,
      phone: form.phone.trim() || null,
      notes: form.notes.trim() || null,
      is_member: form.is_member,
      active: form.active,
    };

    if (editId) {
      const prev = providers.find(p => p.id === editId);
      const result = await updateProvider(editId, payload);
      if (result && result.error) { setErr(result.error); setSaving(false); return; }
      setProviders(p => p.map(x => x.id === editId ? { ...x, ...payload } : x));
      // El nombre está denormalizado en products.provider: hay que propagarlo o el
      // catálogo seguiría mostrando el nombre antiguo.
      if (prev && prev.name !== payload.name) {
        await syncProviderNameOnProducts(editId, payload.name);
        setProducts(p => p.map(x => x.provider_id === editId ? { ...x, provider: payload.name } : x));
      }
      setEditId(null);
    } else {
      const result = await addProvider(payload);
      if (result && result.error) { setErr(result.error); setSaving(false); return; }
      setProviders(p => [...p, result].sort((a, b) => a.name.localeCompare(b.name)));
      setShowForm(false);
    }
    setErr('');
    setSaving(false);
  };

  const handleDelete = async (pv) => {
    const n = countFor(pv.id);
    if (n > 0) {
      alert('No se puede eliminar "' + pv.name + '": tiene ' + n + ' producto' + (n === 1 ? '' : 's') + ' asociado' + (n === 1 ? '' : 's') + '.\n\nReasigna esos productos a otro proveedor, o desactívalo para que deje de aparecer al crear productos sin perder el historial.');
      return;
    }
    if (!window.confirm('¿Eliminar definitivamente a "' + pv.name + '"?')) return;
    const result = await deleteProvider(pv.id);
    if (result && result.error) { alert('Error al eliminar: ' + result.error); return; }
    setProviders(p => p.filter(x => x.id !== pv.id));
  };

  const toggleActive = async (pv) => {
    const result = await updateProvider(pv.id, { active: !pv.active });
    if (result && result.error) { alert('Error: ' + result.error); return; }
    setProviders(p => p.map(x => x.id === pv.id ? { ...x, active: !x.active } : x));
  };

  const vis = providers.filter(p => !srch || p.name.toLowerCase().includes(srch.toLowerCase()));

  const field = (label, key, opts) => {
    const o = opts || {};
    return (
      <div style={{ gridColumn: o.full ? 'span 2' : 'auto' }}>
        <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '3px' }}>{label}</label>
        <input type={o.type || 'text'} placeholder={o.ph || ''} value={form[key]}
          onChange={e => { const val = e.target.value; setForm(p => ({ ...p, [key]: val })); setErr(''); }}
          style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }} />
      </div>
    );
  };

  const renderForm = () => (
    <div style={{ padding: '1rem', background: 'white', border: '1px solid ' + (editId ? '#ffa726' : '#90caf9'), borderRadius: '8px', marginBottom: '1rem' }}>
      <p style={{ fontWeight: 600, fontSize: '14px', color: editId ? '#e65100' : '#1565c0', margin: '0 0 1rem' }}>
        {editId ? 'Editar proveedor' : 'Nuevo proveedor'}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
        {field('Nombre *', 'name', { full: true, ph: 'Ej: El Granero' })}
        {field('Correo electrónico', 'email', { type: 'email', ph: 'correo@proveedor.cl' })}
        {field('Teléfono', 'phone', { ph: '+56 9 ...' })}
        {field('Persona de contacto', 'contact', { ph: 'Nombre de quien atiende' })}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '14px', paddingBottom: '4px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_member} onChange={e => setForm(p => ({ ...p, is_member: e.target.checked }))} />
            Socia productora
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.active} onChange={e => setForm(p => ({ ...p, active: e.target.checked }))} />
            Activo
          </label>
        </div>
        {field('Notas', 'notes', { full: true, ph: 'Condiciones, plazos de entrega, mínimos...' })}
      </div>
      {form.is_member && (
        <p style={{ fontSize: '11px', color: '#6a1b9a', margin: '0 0 10px' }}>
          Marcada como socia productora: recibirá un mensaje más cercano en vez de la orden de compra formal.
        </p>
      )}
      {err && <p style={{ fontSize: '12px', color: '#c62828', margin: '0 0 10px' }}>{err}</p>}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={handleSave} disabled={saving}
          style={{ flex: 1, padding: '8px', background: editId ? '#e65100' : '#1565c0', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
          {saving ? 'Guardando...' : editId ? 'Actualizar' : 'Agregar proveedor'}
        </button>
        <button onClick={cancel}
          style={{ flex: 1, padding: '8px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
          Cancelar
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <p style={{ fontSize: '13px', fontWeight: 500, color: '#666', margin: 0 }}>
          {providers.filter(p => p.active).length} activos · {providers.filter(p => p.is_member).length} socias productoras
        </p>
        {!showForm && !editId && (
          <button onClick={startNew}
            style={{ padding: '6px 14px', background: '#1565c0', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
            + Nuevo proveedor
          </button>
        )}
      </div>

      {sinCorreo.length > 0 && (
        <div style={{ background: '#fff8e1', border: '1px solid #ffc107', borderRadius: '8px', padding: '10px 14px', marginBottom: '1rem' }}>
          <p style={{ fontSize: '12px', color: '#e65100', fontWeight: 600, margin: 0 }}>
            ⚠ {sinCorreo.length} proveedor{sinCorreo.length === 1 ? '' : 'es'} sin correo
          </p>
          <p style={{ fontSize: '11px', color: '#666', margin: '4px 0 0' }}>
            No se les podrá enviar la orden de compra hasta que lo completes: {sinCorreo.map(p => p.name).join(', ')}.
          </p>
        </div>
      )}

      {correosRepetidos.length > 0 && (
        <div style={{ background: '#e3f2fd', border: '2px dashed #64b5f6', borderRadius: '8px', padding: '10px 14px', marginBottom: '1rem' }}>
          <p style={{ fontSize: '12px', color: '#1565c0', fontWeight: 700, margin: 0 }}>📮 Correos provisionales detectados</p>
          {correosRepetidos.map(([correo, names]) => (
            <p key={correo} style={{ fontSize: '11px', color: '#555', margin: '4px 0 0', lineHeight: 1.5 }}>
              <strong>{names.length} proveedores</strong> comparten <strong>{correo}</strong>: {names.join(', ')}.
            </p>
          ))}
          <p style={{ fontSize: '11px', color: '#666', margin: '6px 0 0', lineHeight: 1.5 }}>
            Sus órdenes de compra llegarán todas a la misma casilla. Reemplaza estos correos por los reales antes del Go Live.
          </p>
        </div>
      )}

      {(showForm || editId) && renderForm()}

      <input type="text" placeholder="Buscar proveedor..." value={srch} onChange={e => setSrch(e.target.value)}
        style={{ width: '100%', padding: '7px 12px', border: '1px solid #dde8dd', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box', marginBottom: '1rem' }} />

      {vis.map(pv => {
        const n = countFor(pv.id);
        return (
          <div key={pv.id} style={{ background: 'white', border: '1px solid ' + (pv.active ? '#dde8dd' : '#eee'), borderRadius: '8px', padding: '0.9rem 1rem', marginBottom: '8px', opacity: pv.active ? 1 : 0.6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
                  <p style={{ fontSize: '14px', fontWeight: 700, margin: 0, color: '#333' }}>{pv.name}</p>
                  {pv.is_member && <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 7px', borderRadius: '10px', background: '#f3e5f5', color: '#6a1b9a' }}>SOCIA</span>}
                  {!pv.active && <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 7px', borderRadius: '10px', background: '#f5f5f5', color: '#999' }}>INACTIVO</span>}
                  <span style={{ fontSize: '10px', color: '#888' }}>{n} producto{n === 1 ? '' : 's'}</span>
                </div>
                <p style={{ fontSize: '11px', margin: '4px 0 0', color: pv.email ? '#555' : '#c62828', fontWeight: pv.email ? 400 : 600 }}>
                  {pv.email ? '✉ ' + pv.email : '✉ sin correo — no puede recibir órdenes de compra'}
                  {pv.contact && <span style={{ color: '#888' }}> · {pv.contact}</span>}
                  {pv.phone && <span style={{ color: '#888' }}> · {pv.phone}</span>}
                </p>
                {pv.notes && <p style={{ fontSize: '11px', color: '#999', margin: '3px 0 0', fontStyle: 'italic' }}>{pv.notes}</p>}
              </div>
              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                <button onClick={() => startEdit(pv)}
                  style={{ fontSize: '10px', padding: '4px 10px', border: '1px solid #dde8dd', background: 'white', borderRadius: '5px', cursor: 'pointer', color: '#555' }}>
                  Editar
                </button>
                <button onClick={() => toggleActive(pv)}
                  style={{ fontSize: '10px', padding: '4px 10px', border: '1px solid #dde8dd', background: 'white', borderRadius: '5px', cursor: 'pointer', color: '#555' }}>
                  {pv.active ? 'Desactivar' : 'Activar'}
                </button>
                <button onClick={() => handleDelete(pv)} title={n > 0 ? 'Tiene productos asociados' : 'Eliminar'}
                  style={{ fontSize: '10px', padding: '4px 9px', border: '1px solid #ffcdd2', background: n > 0 ? '#fafafa' : '#fff5f5', borderRadius: '5px', cursor: 'pointer', color: n > 0 ? '#ccc' : '#c62828' }}>
                  ✕
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
