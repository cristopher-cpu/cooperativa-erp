import React, { useState, useEffect, useMemo } from 'react';
import {
  getFamilies, getProducts, getSealedOrders, getPeriod,
  getInventory, getMovements, sealOrder, markRetired, addFamily,
  addProduct, updateProduct, addInventoryEntry, updatePeriod
} from './supabaseClient';
import './App.css';
import { AdminFamilias, AdminProductos, AdminPeriodo } from './AdminComponents';

const CARGO = 4000;

function App() {
  const [families, setFamilies] = useState([]);
  const [products, setProducts] = useState([]);
  const [sealed, setSealed] = useState({});
  const [period, setPeriod] = useState(null);
  const [inventory, setInventory] = useState({});
  const [movements, setMovements] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [carts, setCarts] = useState({});

  useEffect(() => {
    async function loadData() {
      try {
        const [fams, prods, per] = await Promise.all([
          getFamilies(),
          getProducts(),
          getPeriod()
        ]);
        
        setFamilies(fams);
        setProducts(prods);
        setPeriod(per);
        
        if (per) {
          const orders = await getSealedOrders(per.id);
          const orderMap = {};
          orders.forEach(o => {
            orderMap[o.family_id] = o;
          });
          setSealed(orderMap);
        }
        
        const inv = await getInventory();
        const invMap = {};
        inv.forEach(i => {
          invMap[i.product_id] = i.quantity;
        });
        setInventory(invMap);
        
        const movs = await getMovements();
        setMovements(movs);
      } catch (error) {
        console.error('Error cargando datos:', error);
      } finally {
        setLoading(false);
      }
    }
    
    loadData();
  }, []);

  const login = u => setUser(u);
  const logout = () => setUser(null);
  
  const sealOrderLocal = async (fid, items, total) => {
    const order = {
      id: Date.now().toString(),
      family_id: fid,
      period_id: period.id,
      total,
      sealed_at: new Date().toISOString(),
      retired: false,
      retired_at: null,
      items: JSON.stringify(items)
    };
    await sealOrder(order);
    setSealed(p => ({ ...p, [fid]: { ...order, items } }));
    setCarts(p => ({ ...p, [fid]: {} }));
  };

  const unsealOrderLocal = async (fid) => {
    const ord = sealed[fid];
    if (!ord || ord.retired) return;
    const items = JSON.parse(ord.items);
    const cart = {};
    items.forEach(i => { cart[i.id] = i.qty; });
    setCarts(p => ({ ...p, [fid]: cart }));
    setSealed(p => { const n = { ...p }; delete n[fid]; return n; });
  };

  const markRetiredLocal = async (fid) => {
    await markRetired(sealed[fid].id);
    setSealed(p => ({ ...p, [fid]: { ...p[fid], retired: true, retired_at: new Date().toISOString() } }));
  };

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', fontSize: '18px' }}>⏳ Cargando datos desde Supabase...</div>;
  }

  if (!user) {
    return <Welcome families={families} onLogin={login} period={period} />;
  }

  if (user.role === 'admin') {
    return <AdminApp user={user} families={families} setFamilies={setFamilies} products={products} setProducts={setProducts} sealed={sealed} setSealed={setSealed} period={period} setPeriod={setPeriod} logout={logout} />;
  }

  return <FamilyApp user={user} products={products} sealed={sealed} sealOrderLocal={sealOrderLocal} unsealOrderLocal={unsealOrderLocal} carts={carts} setCarts={setCarts} period={period} logout={logout} />;
}

function Welcome({ families, onLogin, period }) {
  const admins = families.filter(f => f.role === 'admin');
  const fams = families.filter(f => f.role === 'familia');

  return (
    <div style={{ padding: '2rem', background: '#f9f9f9', minHeight: '100vh' }}>
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1 style={{ fontSize: '32px', marginBottom: '8px', fontWeight: 600 }}>🛒 Cooperativa de Compras</h1>
        <p style={{ color: '#666', margin: 0, fontSize: '14px' }}>{period?.label} · {period?.month}</p>
      </div>

      <h2 style={{ fontSize: '12px', fontWeight: 600, color: '#666', textTransform: 'uppercase', marginBottom: '1rem', letterSpacing: '0.05em' }}>👨‍💼 Administración</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '3rem' }}>
        {admins.map(f => (
          <button
            key={f.id}
            onClick={() => onLogin(f)}
            style={{
              padding: '1.5rem',
              border: '1px solid #0066cc',
              borderRadius: '8px',
              background: 'white',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.2s'
            }}
            onMouseEnter={e => e.target.style.boxShadow = '0 4px 12px rgba(0,102,204,0.15)'}
            onMouseLeave={e => e.target.style.boxShadow = 'none'}
          >
            <strong style={{ fontSize: '16px' }}>{f.name}</strong>
            <p style={{ fontSize: '11px', color: '#0066cc', margin: '8px 0 0', fontWeight: 600 }}>🔐 ADMINISTRADOR</p>
            <p style={{ fontSize: '12px', color: '#999', margin: 0 }}>{f.email}</p>
          </button>
        ))}
      </div>

      <h2 style={{ fontSize: '12px', fontWeight: 600, color: '#666', textTransform: 'uppercase', marginBottom: '1rem', letterSpacing: '0.05em' }}>👥 Familias ({fams.length})</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        {fams.map(f => (
          <button
            key={f.id}
            onClick={() => onLogin(f)}
            style={{
              padding: '1.5rem',
              border: '1px solid #ddd',
              borderRadius: '8px',
              background: 'white',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.2s'
            }}
            onMouseEnter={e => e.target.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
            onMouseLeave={e => e.target.style.boxShadow = 'none'}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#4CAF50', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 600 }}>{f.initials}</div>
              <strong style={{ fontSize: '16px' }}>{f.name}</strong>
            </div>
            {f.balance !== 0 && (
              <p style={{ fontSize: '12px', color: f.balance > 0 ? '#0a7e0f' : '#d32f2f', margin: 0, fontWeight: 500 }}>
                {f.balance > 0 ? '✓ A favor' : '⚠ Debe'}: ${Math.abs(f.balance).toLocaleString('es-CL')}
              </p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function FamilyApp({ user, products, sealed, sealOrderLocal, unsealOrderLocal, carts, setCarts, period, logout }) {
  const [tab, setTab] = useState('catalog');
  const [cat, setCat] = useState('all');
  const [srch, setSrch] = useState('');
  const [conf, setConf] = useState(false);

  const cart = carts[user.id] || {};
  const setCart = fn => setCarts(p => ({ ...p, [user.id]: fn(p[user.id] || {}) }));
  const add = id => setCart(p => ({ ...p, [id]: (p[id] || 0) + 1 }));
  const sub = id => setCart(p => ({ ...p, [id]: Math.max(0, (p[id] || 0) - 1) }));

  const items = useMemo(() => 
    Object.entries(cart)
      .filter(([, q]) => q > 0)
      .map(([id, qty]) => {
        const pr = products.find(x => x.id === parseInt(id));
        return pr ? { ...pr, qty, sub: pr.price * qty } : null;
      })
      .filter(Boolean),
    [cart, products]
  );

  const total = items.reduce((s, i) => s + i.sub, 0);
  const cnt = items.reduce((s, i) => s + i.qty, 0);
  const ord = sealed[user.id];
  const saldo = user.balance || 0;
  const cats = ['all', ...new Set(products.map(p => p.category))];
  const vis = useMemo(() => 
    products.filter(p => (cat === 'all' || p.category === cat) && (!srch || p.name.toLowerCase().includes(srch.toLowerCase()) || p.provider.toLowerCase().includes(srch.toLowerCase()))),
    [cat, srch, products]
  );

  const daysLeft = period && period.date_to ? Math.ceil((new Date(period.date_to + 'T23:59:59') - new Date()) / 864e5) : null;

  return (
    <div style={{ background: '#f9f9f9', minHeight: '100vh' }}>
      <div style={{ padding: '0.75rem 1rem', background: 'white', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '18px' }}>🛒</span>
          <div>
            <strong style={{ fontSize: '14px' }}>Cooperativa</strong>
            <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>{period?.label}</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#4CAF50', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 600 }}>{user.initials}</div>
          <span style={{ fontSize: '12px' }}>{user.name}</span>
          <button onClick={logout} style={{ padding: '4px 10px', border: '1px solid #ddd', borderRadius: '4px', background: 'white', cursor: 'pointer', fontSize: '11px' }}>Salir</button>
        </div>
      </div>

      {period && (
        <div style={{ padding: '0.5rem 1rem', background: period.date_to && daysLeft >= 0 && daysLeft <= 5 ? '#fff3cd' : '#e8f5e9', borderBottom: '1px solid #ddd', fontSize: '12px', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 500 }}>{period.label}</span>
          {period.date_from && <span>📅 {new Date(period.date_from).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })} — {new Date(period.date_to).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}</span>}
          {period.date_delivery && <span>🚚 Entrega: {new Date(period.date_delivery).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}</span>}
          {ord?.retired && <span style={{ fontWeight: 500, color: '#0a7e0f' }}>✓ Pedido entregado</span>}
          {!ord?.retired && daysLeft !== null && daysLeft <= 5 && daysLeft >= 0 && <span style={{ fontWeight: 500, color: '#f57c00' }}>⏰ Cierra en {daysLeft} día{daysLeft !== 1 ? 's' : ''}</span>}
        </div>
      )}

      <div style={{ display: 'flex', background: 'white', borderBottom: '1px solid #eee', overflowX: 'auto' }}>
        {[{ id: 'catalog', l: 'Catálogo', ic: '📦' }, { id: 'order', l: 'Mi Pedido', ic: '🛒', bdg: cnt }, { id: 'dates', l: 'Fechas', ic: '📅' }, { id: 'balance', l: 'Mi Saldo', ic: '💰' }].map(n => (
          <button
            key={n.id}
            onClick={() => setTab(n.id)}
            style={{
              flex: 1,
              padding: '0.75rem',
              border: 'none',
              borderBottom: tab === n.id ? '2px solid #4CAF50' : '2px solid transparent',
              background: 'none',
              cursor: 'pointer',
              color: tab === n.id ? '#4CAF50' : '#666',
              fontWeight: tab === n.id ? 500 : 400,
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              position: 'relative'
            }}
          >
            <span style={{ fontSize: '16px' }}>{n.ic}</span>
            {n.l}
            {n.bdg > 0 && !ord && <span style={{ position: 'absolute', top: '4px', right: '8px', background: '#f44336', color: 'white', fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '10px' }}>{n.bdg}</span>}
          </button>
        ))}
      </div>

      <div style={{ padding: '1rem' }}>
        {tab === 'catalog' && (
          <div>
            {ord && (
              <div style={{ marginBottom: '1rem', padding: '10px 14px', borderRadius: '6px', background: ord.retired ? '#e8f5e9' : '#e3f2fd', border: `1px solid ${ord.retired ? '#81c784' : '#64b5f6'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ fontSize: '12px', fontWeight: 500, color: ord.retired ? '#0a7e0f' : '#0066cc', margin: 0 }}>{ord.retired ? '✓ Pedido entregado' : '✓ Pedido sellado — en espera de entrega'}</p>
                  <p style={{ fontSize: '11px', color: '#666', margin: '4px 0 0' }}>{ord.retired ? 'Entregado el ' + new Date(ord.retired_at).toLocaleString('es-CL') : 'Sellado el ' + new Date(ord.sealed_at).toLocaleString('es-CL')}</p>
                </div>
                {!ord.retired && period?.active && <button onClick={() => unsealOrderLocal(user.id)} style={{ padding: '6px 12px', background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>Modificar</button>}
              </div>
            )}
            <div style={{ position: 'relative', marginBottom: '0.75rem' }}>
              <input type="text" placeholder="Buscar producto o proveedor..." value={srch} onChange={e => setSrch(e.target.value)} style={{ paddingLeft: '30px', width: '100%', padding: '8px', paddingLeft: '30px', border: '1px solid #ddd', borderRadius: '4px' }} />
            </div>
            <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '0.75rem' }}>
              {cats.map(c => (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '20px',
                    border: '1px solid',
                    cursor: 'pointer',
                    fontSize: '11px',
                    background: cat === c ? '#4CAF50' : 'white',
                    borderColor: cat === c ? '#4CAF50' : '#ddd',
                    color: cat === c ? 'white' : '#666',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {c === 'all' ? 'Todo' : c}
                </button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px' }}>
              {vis.map(pr => {
                const qty = ord ? ((ord.items && Array.isArray(ord.items) ? ord.items.find(x => x.id === pr.id) : JSON.parse(ord.items).find(x => x.id === pr.id)) || {}).qty || 0 : (cart[pr.id] || 0);
                const lk = !!ord;
                return (
                  <div key={pr.id} style={{ padding: '1rem', background: 'white', border: '1px solid #eee', borderRadius: '6px', opacity: pr.in_stock ? 1 : 0.55 }}>
                    <span style={{ fontSize: '10px', fontWeight: 500, padding: '2px 6px', borderRadius: '4px', background: pr.in_stock ? '#e8f5e9' : '#ffebee', color: pr.in_stock ? '#0a7e0f' : '#d32f2f' }}>{pr.in_stock ? '✓ Disponible' : 'Sin stock'}</span>
                    <p style={{ fontWeight: 500, fontSize: '12px', lineHeight: 1.3, marginTop: '8px', marginBottom: '4px' }}>{pr.name}</p>
                    <p style={{ fontSize: '10px', color: '#666', marginBottom: '4px' }}>{pr.unit} · {pr.provider}</p>
                    <p style={{ fontWeight: 500, fontSize: '13px', marginBottom: '10px' }}>${pr.price.toLocaleString('es-CL')}</p>
                    {lk ? 
                      qty > 0 ? <div style={{ textAlign: 'center', fontSize: '11px', padding: '5px', background: '#f5f5f5', borderRadius: '4px', color: '#666' }}>{qty} en pedido</div> : <div style={{ height: '28px' }} />
                      :
                      qty === 0 ?
                        <button onClick={() => pr.in_stock && add(pr.id)} disabled={!pr.in_stock} style={{ width: '100%', padding: '6px', border: `1px solid ${pr.in_stock ? '#4CAF50' : '#ccc'}`, background: pr.in_stock ? '#4CAF50' : 'white', color: pr.in_stock ? 'white' : '#999', borderRadius: '4px', cursor: pr.in_stock ? 'pointer' : 'not-allowed', fontSize: '12px', fontWeight: 500 }}>+ Agregar</button>
                        :
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <button onClick={() => sub(pr.id)} style={{ width: '24px', height: '24px', border: '1px solid #ddd', background: 'white', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                          <span style={{ fontWeight: 500, fontSize: '14px' }}>{qty}</span>
                          <button onClick={() => add(pr.id)} style={{ width: '24px', height: '24px', border: '1px solid #4CAF50', background: '#4CAF50', color: 'white', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                        </div>
                    }
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'order' && (
          <div>
            {ord ? (
              <div>
                <div style={{ background: ord.retired ? '#e8f5e9' : '#e3f2fd', border: `1px solid ${ord.retired ? '#81c784' : '#64b5f6'}`, borderRadius: '6px', padding: '1rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ fontSize: '14px', fontWeight: 500, color: ord.retired ? '#0a7e0f' : '#0066cc', margin: 0 }}>✓ {ord.retired ? 'Pedido entregado' : 'Pedido sellado'}</p>
                    <p style={{ fontSize: '12px', color: '#666', margin: '4px 0 0' }}>Sellado: {new Date(ord.sealed_at).toLocaleString('es-CL')}</p>
                  </div>
                  {!ord.retired && period?.active && <button onClick={() => unsealOrderLocal(user.id)} style={{ padding: '6px 14px', background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Modificar</button>}
                </div>
                {(Array.isArray(ord.items) ? ord.items : JSON.parse(ord.items)).filter(i => i.qty > 0).map(i => (
                  <div key={i.id} style={{ padding: '1rem', background: 'white', border: '1px solid #eee', borderRadius: '6px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <p style={{ fontSize: '13px', fontWeight: 500, margin: 0 }}>{i.n}</p>
                      <p style={{ fontSize: '11px', color: '#666', margin: '4px 0 0' }}>{i.pv} · {i.u}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>×{i.qty}</p>
                      <p style={{ fontSize: '13px', fontWeight: 500, margin: '2px 0 0' }}>${(i.p * i.qty).toLocaleString('es-CL')}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                <p style={{ fontSize: '40px', margin: 0 }}>🛒</p>
                <p style={{ color: '#666', marginTop: '1rem' }}>Tu carrito está vacío</p>
                <p style={{ color: '#999', fontSize: '12px', marginTop: '4px' }}>Agrega productos desde el catálogo</p>
              </div>
            ) : (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '1rem' }}>
                  {[{ l: 'Subtotal', v: '$' + total.toLocaleString('es-CL') }, { l: 'Cargo fijo', v: '$' + CARGO.toLocaleString('es-CL') }, { l: 'Total', v: '$' + (total + CARGO).toLocaleString('es-CL') }].map(m => (
                    <div key={m.l} style={{ padding: '1rem', background: 'white', borderRadius: '6px', textAlign: 'center', border: '1px solid #eee' }}>
                      <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>{m.l}</p>
                      <p style={{ fontSize: '14px', fontWeight: 500, margin: '6px 0 0' }}>{m.v}</p>
                    </div>
                  ))}
                </div>
                {saldo !== 0 && (
                  <div style={{ padding: '10px', background: saldo > 0 ? '#e8f5e9' : '#ffebee', border: `1px solid ${saldo > 0 ? '#81c784' : '#ef5350'}`, borderRadius: '6px', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '13px' }}>Saldo anterior</span>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: saldo > 0 ? '#0a7e0f' : '#d32f2f' }}>{saldo > 0 ? '+ ' : ''}${Math.abs(saldo).toLocaleString('es-CL')}</span>
                  </div>
                )}
                {!conf ? (
                  <button onClick={() => setConf(true)} style={{ width: '100%', padding: '10px', border: '1px solid #4CAF50', background: '#4CAF50', color: 'white', borderRadius: '6px', cursor: 'pointer', fontWeight: 500, fontSize: '14px', marginBottom: '1rem' }}>🔒 Sellar Pedido</button>
                ) : (
                  <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '6px', padding: '1rem', marginBottom: '1rem' }}>
                    <p style={{ fontWeight: 500, fontSize: '14px', color: '#f57c00', margin: 0 }}>¿Confirmar sellado del pedido?</p>
                    <p style={{ fontSize: '13px', color: '#666', margin: '8px 0 0' }}>Podrás modificarlo mientras el período {period?.label} esté activo.</p>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '1rem' }}>
                      <button onClick={() => { sealOrderLocal(user.id, items.map(i => ({ id: i.id, n: i.name, pv: i.provider, p: i.price, u: i.unit, qty: i.qty })), total); setConf(false); setTab('catalog'); }} style={{ flex: 1, padding: '8px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 500 }}>Confirmar</button>
                      <button onClick={() => setConf(false)} style={{ flex: 1, padding: '8px', background: 'white', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer' }}>Cancelar</button>
                    </div>
                  </div>
                )}
                {items.map(it => (
                  <div key={it.id} style={{ padding: '1rem', background: 'white', border: '1px solid #eee', borderRadius: '6px', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: '13px', fontWeight: 500, margin: 0 }}>{it.name}</p>
                      <p style={{ fontSize: '11px', color: '#666', margin: '4px 0 0' }}>{it.provider} · {it.unit} · ${it.price.toLocaleString('es-CL')}</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '1rem' }}>
                      <button onClick={() => sub(it.id)} style={{ width: '24px', height: '24px', border: '1px solid #ddd', background: 'white', borderRadius: '4px', cursor: 'pointer' }}>−</button>
                      <span style={{ fontSize: '13px', fontWeight: 500, minWidth: '20px', textAlign: 'center' }}>{it.qty}</span>
                      <button onClick={() => add(it.id)} style={{ width: '24px', height: '24px', border: '1px solid #4CAF50', background: '#4CAF50', color: 'white', borderRadius: '4px', cursor: 'pointer' }}>+</button>
                      <span style={{ fontSize: '12px', fontWeight: 500, minWidth: '70px', textAlign: 'right' }}>${it.sub.toLocaleString('es-CL')}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'dates' && (
          <div>
            <div style={{ display: 'grid', gap: '12px', marginBottom: '2rem' }}>
              {[{ ic: '📅', l: 'Apertura de pedidos', v: period?.date_from ? new Date(period.date_from).toLocaleDateString('es-CL', { day: 'numeric', month: 'long' }) : 'Por confirmar' }, { ic: '⏰', l: 'Cierre de pedidos', v: period?.date_to ? new Date(period.date_to).toLocaleDateString('es-CL', { day: 'numeric', month: 'long' }) : 'Por confirmar' }, { ic: '🚚', l: 'Fecha de entrega', v: period?.date_delivery ? new Date(period.date_delivery).toLocaleDateString('es-CL', { day: 'numeric', month: 'long' }) : 'Por confirmar' }].map(d => (
                <div key={d.l} style={{ background: 'white', borderRadius: '6px', padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', border: '1px solid #eee' }}>
                  <span style={{ fontSize: '28px' }}>{d.ic}</span>
                  <div>
                    <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>{d.l}</p>
                    <p style={{ fontSize: '16px', fontWeight: 500, margin: 0 }}>{d.v}</p>
                  </div>
                </div>
              ))}
            </div>
            {period?.date_to && daysLeft !== null && daysLeft <= 5 && daysLeft >= 0 && (
              <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '6px', padding: '10px 14px', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px' }}>⏰</span>
                <p style={{ fontSize: '13px', color: '#f57c00', margin: 0 }}>El período cierra en {daysLeft} día{daysLeft !== 1 ? 's' : ''}. Asegúrate de enviar tu pedido.</p>
              </div>
            )}
            <div style={{ background: 'white', borderRadius: '6px', padding: '1.25rem', border: '1px solid #eee' }}>
              <p style={{ fontWeight: 500, fontSize: '14px', marginBottom: '1rem', margin: 0 }}>Estado de tu pedido</p>
              {ord ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '32px' }}>{ord.retired ? '✅' : '📦'}</span>
                  <div>
                    <p style={{ fontWeight: 500, fontSize: '14px', margin: 0 }}>{ord.retired ? 'Pedido entregado' : 'Pedido sellado — esperando entrega'}</p>
                    <p style={{ fontSize: '12px', color: '#666', margin: '4px 0 0' }}>{ord.retired ? 'Entregado el ' + new Date(ord.retired_at).toLocaleString('es-CL') : 'Sellado el ' + new Date(ord.sealed_at).toLocaleString('es-CL')}</p>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '32px' }}>📋</span>
                  <div>
                    <p style={{ fontWeight: 500, fontSize: '14px', margin: 0 }}>Sin pedido enviado</p>
                    <p style={{ fontSize: '12px', color: '#666', margin: '4px 0 0' }}>Ve al catálogo para armar y sellar tu pedido</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'balance' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '1.5rem' }}>
              <div style={{ padding: '1rem', background: 'white', borderRadius: '6px', border: '1px solid #eee' }}>
                <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>Saldo anterior</p>
                <p style={{ fontSize: '20px', fontWeight: 600, margin: '8px 0 0', color: saldo > 0 ? '#0a7e0f' : saldo < 0 ? '#d32f2f' : '#333' }}>${Math.abs(saldo).toLocaleString('es-CL')}</p>
              </div>
              <div style={{ padding: '1rem', background: 'white', borderRadius: '6px', border: '1px solid #eee' }}>
                <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>Pedido actual</p>
                <p style={{ fontSize: '20px', fontWeight: 600, margin: '8px 0 0' }}>${(ord ? ord.total + CARGO : items.length > 0 ? total + CARGO : 0).toLocaleString('es-CL')}</p>
              </div>
            </div>
            <div style={{ padding: '1.25rem', background: 'white', borderRadius: '6px', border: '1px solid #eee' }}>
              <p style={{ fontWeight: 500, fontSize: '14px', marginBottom: '1rem', margin: 0 }}>Resumen {period?.label}</p>
              {[{ l: 'Saldo anterior', v: saldo, c: saldo > 0 ? 'success' : saldo < 0 ? 'danger' : 'secondary' }, { l: 'Pedido período', v: ord ? ord.total + CARGO : 0, c: 'primary' }, { l: 'Total a liquidar', v: Math.max(0, (ord ? ord.total + CARGO : 0) - saldo), c: 'primary' }].map(([l, v, c], i, a) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < a.length - 1 ? '1px solid #eee' : 'none' }}>
                  <span style={{ fontSize: '13px' }}>{l}</span>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: c !== 'primary' ? { success: '#0a7e0f', danger: '#d32f2f', secondary: '#666' }[c] : '#333' }}>${v.toLocaleString('es-CL')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AdminApp({ user, families, setFamilies, products, setProducts, sealed, setSealed, period, setPeriod, logout }) {
  const [tab, setTab] = useState('dashboard');
  const na = families.filter(f => f.role === 'familia');
  const sc = Object.keys(sealed).length;
  const ret = Object.values(sealed).filter(o => o.retired).length;
  const tot = Object.values(sealed).reduce((s, o) => s + (o.total || 0) + CARGO, 0);

  return (
    <div style={{ background: '#f9f9f9', minHeight: '100vh' }}>
      <div style={{ padding: '0.75rem 1rem', background: 'white', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '18px' }}>🛒</span>
          <div>
            <strong style={{ fontSize: '14px' }}>Cooperativa - Panel Admin</strong>
            <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>{period?.label}</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '10px', fontWeight: 600, padding: '3px 8px', borderRadius: '10px', background: '#0066cc', color: 'white' }}>ADMIN</span>
          <span style={{ fontSize: '12px' }}>{user.name}</span>
          <button onClick={logout} style={{ padding: '4px 10px', border: '1px solid #ddd', borderRadius: '4px', background: 'white', cursor: 'pointer', fontSize: '11px' }}>Salir</button>
        </div>
      </div>

      <div style={{ display: 'flex', background: 'white', borderBottom: '1px solid #eee', overflowX: 'auto' }}>
        {[{ id: 'dashboard', l: 'Dashboard', ic: '📊' }, { id: 'pedidos', l: 'Pedidos', ic: '📋' }, { id: 'retiros', l: 'Retiros', ic: '🚚' }, { id: 'bodega', l: 'Bodega', ic: '📦' }, { id: 'familias', l: 'Familias', ic: '👥' }, { id: 'productos', l: 'Productos', ic: '🏷️' }, { id: 'saldos', l: 'Saldos', ic: '💳' }, { id: 'periodo', l: 'Período', ic: '📅' }].map(n => (
          <button
            key={n.id}
            onClick={() => setTab(n.id)}
            style={{
              flex: 1,
              padding: '0.75rem',
              border: 'none',
              borderBottom: tab === n.id ? '2px solid #0066cc' : '2px solid transparent',
              background: 'none',
              cursor: 'pointer',
              color: tab === n.id ? '#0066cc' : '#666',
              fontWeight: tab === n.id ? 500 : 400,
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px'
            }}
          >
            <span style={{ fontSize: '14px' }}>{n.ic}</span>
            {n.l}
          </button>
        ))}
      </div>

      <div style={{ padding: '1rem' }}>
        {tab === 'dashboard' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
              {[{ ic: '✓', l: 'Sellados', v: sc + '/' + na.length, c: 'success' }, { ic: '🚚', l: 'Retirados', v: ret + '/' + sc, c: ret === sc && sc > 0 ? 'success' : 'warning' }, { ic: '⏳', l: 'Pendientes', v: na.length - sc, c: 'secondary' }, { ic: '💰', l: 'Total consolidado', v: '$' + tot.toLocaleString('es-CL'), c: 'primary' }].map(m => (
                <div key={m.l} style={{ padding: '1.5rem', background: 'white', borderRadius: '6px', border: '1px solid #eee', textAlign: 'center' }}>
                  <span style={{ fontSize: '24px', display: 'block', marginBottom: '8px' }}>{m.ic}</span>
                  <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>{m.l}</p>
                  <p style={{ fontSize: '18px', fontWeight: 600, margin: '6px 0 0', color: m.c === 'primary' ? '#333' : { success: '#0a7e0f', warning: '#f57c00', secondary: '#999' }[m.c] }}>{m.v}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'pedidos' && (
          <div>
            <p style={{ fontSize: '13px', fontWeight: 500, color: '#666', marginBottom: '1rem' }}>Todos los pedidos — {period?.label} (Sellados: {sc}/{na.length})</p>
            {na.map(f => {
              const o = sealed[f.id];
              return (
                <div key={f.id} style={{ padding: '1rem', background: 'white', border: '1px solid #eee', borderRadius: '6px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#4CAF50', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 600 }}>{f.initials}</div>
                      <div>
                        <p style={{ fontSize: '13px', fontWeight: 500, margin: 0 }}>{f.name}</p>
                        <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>{o ? 'Sellado ' + new Date(o.sealed_at).toLocaleString('es-CL') : 'Sin pedido'}</p>
                      </div>
                    </div>
                    {o ? <span style={{ fontSize: '10px', fontWeight: 500, padding: '4px 8px', borderRadius: '6px', background: o.retired ? '#e8f5e9' : '#e3f2fd', color: o.retired ? '#0a7e0f' : '#0066cc' }}>${(o.total + CARGO).toLocaleString('es-CL')}</span> : <span style={{ fontSize: '10px', fontWeight: 500, padding: '4px 8px', borderRadius: '6px', background: '#f5f5f5', color: '#999' }}>Pendiente</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'retiros' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
              {[{ ic: '✓', l: 'Retirados', v: ret, c: 'success' }, { ic: '⏳', l: 'Pendientes', v: sc - ret, c: 'warning' }, { ic: '◯', l: 'Sin pedido', v: na.length - sc, c: 'secondary' }].map(m => (
                <div key={m.l} style={{ padding: '1rem', background: 'white', borderRadius: '6px', border: '1px solid #eee' }}>
                  <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>{m.l}</p>
                  <p style={{ fontSize: '18px', fontWeight: 600, margin: '6px 0 0', color: { success: '#0a7e0f', warning: '#f57c00', secondary: '#999' }[m.c] }}>{m.v}</p>
                </div>
              ))}
            </div>
            <p style={{ fontSize: '13px', fontWeight: 500, color: '#666', marginBottom: '1rem' }}>Pendientes de retiro</p>
            {Object.entries(sealed).filter(([, o]) => !o.retired).map(([fid, o]) => {
              const fam = families.find(f => f.id === fid);
              return (
                <div key={fid} style={{ padding: '1rem', background: 'white', border: '1px solid #eee', borderRadius: '6px', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#4CAF50', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 600 }}>{fam?.initials}</div>
                    <div>
                      <p style={{ fontSize: '13px', fontWeight: 500, margin: 0 }}>{fam?.name}</p>
                      <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>Pedido: ${(o.total + CARGO).toLocaleString('es-CL')}</p>
                    </div>
                  </div>
                  <button onClick={async () => { await markRetired(o.id); setSealed(p => ({ ...p, [fid]: { ...p[fid], retired: true, retired_at: new Date().toISOString() } })); }} style={{ padding: '6px 12px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 500 }}>✓ Marcar retirado</button>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'bodega' && <div><p style={{ fontSize: '13px', color: '#999' }}>Módulo de bodega en construcción...</p></div>}

        {tab === 'familias' && <AdminFamilias families={families} setFamilies={setFamilies} sealed={sealed} />}

        {tab === 'productos' && <AdminProductos products={products} setProducts={setProducts} />}

        {tab === 'saldos' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
              {[{ l: 'Con deuda', v: families.filter(f => f.role === 'familia' && f.balance < 0).length, c: 'danger' }, { l: 'Al día', v: families.filter(f => f.role === 'familia' && f.balance === 0).length, c: 'secondary' }, { l: 'A favor', v: families.filter(f => f.role === 'familia' && f.balance > 0).length, c: 'success' }].map(m => (
                <div key={m.l} style={{ padding: '1rem', background: 'white', borderRadius: '6px', border: '1px solid #eee' }}>
                  <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>{m.l}</p>
                  <p style={{ fontSize: '20px', fontWeight: 600, margin: '6px 0 0', color: { success: '#0a7e0f', danger: '#d32f2f', secondary: '#999' }[m.c] }}>{m.v}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'periodo' && <AdminPeriodo period={period} setPeriod={setPeriod} families={families} sealed={sealed} />}
      </div>
    </div>
  );
}

export default App;