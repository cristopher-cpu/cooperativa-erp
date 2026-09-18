import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getFamilies, getProducts, getSealedOrders, getPeriod, getProviders, loginFamily,
  sealOrder, unsealOrder, markRetired, updateFamilyBalance,
  getBodega, getBodegaAssignments, addBodegaAssignment, deleteBodegaAssignment, getAdjustments,
  getPurchaseOrders, getPeriodCharges, getChargeExemptions
} from './supabaseClient';
import {
  TIPOS, clp, cuentaDeFamilia, parseItems, estadoPedidos, estadoConfirmacionPorProducto,
  ESTADOS_CONFIRMACION, construirCargos,
} from './calculos';
import './App.css';
import { AdminFamilias, AdminProductos, AdminPeriodo, AdminPedidos, AdminRetiros, AdminDashboard, AdminFlujoCaja, AdminBodega, AdminLogs, AdminAnalytics } from './AdminComponents';
import { AdminProveedores } from './AdminProveedores';
import { AdminConsolidado } from './AdminConsolidado';
import { AdminAjustes } from './AdminAjustes';
import { AdminReportes } from './AdminReportes';
import { AdminImportar } from './AdminImportar';
import { FamiliaAjustes } from './FamiliaAjustes';
import { esDelPanel, tabsVisibles, etiquetasDe, esAdmin, tieneRol } from './perfiles';

function App() {
  const [families, setFamilies] = useState([]);
  const [products, setProducts] = useState([]);
  const [providers, setProviders] = useState([]);
  const [sealed, setSealed] = useState({});
  const [period, setPeriod] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [carts, setCarts] = useState({});

  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => { if (!cancelled) setLoading(false); }, 12000);

    async function loadData() {
      try {
        const [fams, prods, per, provs] = await Promise.all([getFamilies(), getProducts(), getPeriod(), getProviders()]);
        if (cancelled) return;
        setFamilies(fams);
        setProducts(prods);
        setPeriod(per);
        setProviders(provs);
        // Sealed orders load in a dedicated effect keyed on period.id (see below),
        // so they always re-sync when the active period changes (e.g. after closing one).
      } catch (error) {
        console.error('Error cargando datos:', error);
      } finally {
        if (!cancelled) {
          clearTimeout(timeout);
          setLoading(false);
        }
      }
    }
    loadData();
    return () => { cancelled = true; clearTimeout(timeout); };
  }, []);

  // Re-sync sealed orders whenever the active period changes (mount, or after closing a period).
  // This prevents the previous period's orders from lingering and blocks double-charging on re-close.
  useEffect(() => {
    if (!period?.id) { setSealed({}); return; }
    let cancelled = false;
    getSealedOrders(period.id).then(orders => {
      if (cancelled) return;
      const map = {};
      orders.forEach(o => { map[o.family_id] = o; });
      setSealed(map);
      setCarts({});
    });
    return () => { cancelled = true; };
  }, [period?.id]);

  const login = u => setUser(u);
  const logout = () => setUser(null);

  // ── Cargos fijos del período ──────────────────────────────────────────────
  //
  // El cargo era un escalar (`period.fixed_charge`) que viajaba a veinte
  // lugares. Ahora son varios cargos con nombre y una familia puede estar
  // eximida de alguno, así que "el cargo" pasó a ser una pregunta con
  // parámetro: cuánto le corresponde a ESTA familia. `construirCargos` responde
  // las dos —el total sin exenciones y el de cada familia— y se pasa el objeto
  // completo, no el número, para que ninguna pantalla vuelva a sumar por su
  // cuenta y muestre una cifra distinta de la de al lado.
  const [charges, setCharges] = useState(null);       // null = falta la migración 007
  const [exemptions, setExemptions] = useState([]);

  const cargarCargos = useCallback(async () => {
    if (!period?.id) { setCharges(null); setExemptions([]); return; }
    const [c, e] = await Promise.all([getPeriodCharges(period.id), getChargeExemptions(period.id)]);
    setCharges(c);
    setExemptions(e || []);
  }, [period?.id]);

  useEffect(() => { cargarCargos(); }, [cargarCargos]);

  const cargos = useMemo(
    () => construirCargos({ charges, exemptions, period }),
    [charges, exemptions, period]
  );

  const sealOrderLocal = async (fid, items, total) => {
    if (!period) return;
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
    const items = typeof ord.items === 'string' ? JSON.parse(ord.items) : ord.items;

    // Hay que BORRAR la fila, no solo sacarla del estado de React. Al volver a
    // sellar se inserta una fila nueva con otro id, así que sin este borrado cada
    // "Modificar" dejaba un pedido huérfano en la base. De ahí salieron los tres
    // pedidos duplicados de la familia `ale` en P109.
    const ok = await unsealOrder(ord.id);
    if (!ok) {
      alert('No se pudo abrir el pedido para modificarlo. Revisa tu conexión e intenta de nuevo.');
      return;
    }

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
    return (
      <div style={{ padding: '2rem', textAlign: 'center', fontSize: '18px', background: 'linear-gradient(160deg, #f0f7f0 0%, #e3f2e3 100%)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ animation: 'fadeIn 0.4s ease both' }}>
          <div className="coop-spinner" />
          <div style={{ fontSize: '34px', marginBottom: '0.5rem' }} className="pulse-emoji">🛒</div>
          <p style={{ color: '#2e7d32', fontWeight: 600, margin: 0 }}>Cargando Cooperativa</p>
          <div className="coop-loadbar" />
          <p style={{ color: '#9bbf9b', fontSize: '12px', marginTop: '10px' }}>Conectando con la base de datos…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Welcome families={families} onLogin={login} period={period} />;
  }

  if (esDelPanel(user)) {
    return (
      <AdminApp
        user={user}
        families={families}
        setFamilies={setFamilies}
        products={products}
        setProducts={setProducts}
        providers={providers}
        setProviders={setProviders}
        sealed={sealed}
        setSealed={setSealed}
        period={period}
        setPeriod={setPeriod}
        cargos={cargos}
        recargarCargos={cargarCargos}
        logout={logout}
        carts={carts}
        setCarts={setCarts}
        sealOrderLocal={sealOrderLocal}
        unsealOrderLocal={unsealOrderLocal}
        markRetiredLocal={markRetiredLocal}
        updateFamilyBalance={updateFamilyBalance}
      />
    );
  }

  return (
    <FamilyApp
      user={user}
      families={families}
      setFamilies={setFamilies}
      products={products}
      sealed={sealed}
      sealOrderLocal={sealOrderLocal}
      unsealOrderLocal={unsealOrderLocal}
      carts={carts}
      setCarts={setCarts}
      period={period}
      cargos={cargos}
      logout={logout}
    />
  );
}

// ─── WELCOME / LOGIN ──────────────────────────────────────────────────────────

function Welcome({ families, onLogin, period }) {
  const [loginFam, setLoginFam] = useState(null);
  const [pin, setPin] = useState('');
  const [pinErr, setPinErr] = useState('');

  // Por perfiles, no por `role`: una familia con Retiro o Balance Contable
  // tiene `role === 'familia'` (se mantiene sincronizado por compatibilidad) y
  // aparecía entre las familias comunes, sin señal de que entra al panel.
  const admins = families.filter(f => esDelPanel(f));
  const fams = families.filter(f => !esDelPanel(f));

  const [verificando, setVerificando] = useState(false);

  const selectFam = (f) => { setLoginFam(f); setPin(''); setPinErr(''); };

  // El PIN se verifica en el servidor. Antes se comparaba aquí, contra un PIN en
  // texto plano que la base mandaba al navegador de cualquiera.
  const tryLogin = async () => {
    if (!loginFam || verificando) return;
    setVerificando(true);
    setPinErr('');
    const res = await loginFamily(loginFam.id, pin);
    setVerificando(false);
    if (res.error) { setPinErr(res.error); return; }
    // Se entra con lo que devuelve el servidor, no con la fila que ya teníamos.
    onLogin(res.family || loginFam);
  };

  if (loginFam) {
    // Quien entra al panel, no solo Admin: /api/login mide la exigencia de PIN
    // por lo que la cuenta puede VER, y esta pantalla tiene que anticipar lo
    // mismo o el aviso no coincide con lo que después pasa.
    const isAdmin = esDelPanel(loginFam);
    const color = isAdmin ? '#1565c0' : '#4CAF50';
    return (
      <div style={{ background: 'linear-gradient(160deg, #f0f7f0 0%, #e6f2e6 55%, #e0f0ea 100%)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
        <div className="modal-card" style={{ background: 'white', borderRadius: '16px', padding: '2rem', width: '100%', maxWidth: '340px', boxShadow: '0 12px 40px rgba(45,90,45,0.14)' }}>
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: color, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', fontWeight: 700, margin: '0 auto 12px' }}>{loginFam.initials}</div>
            <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 6px', color: '#222' }}>{loginFam.name}</h2>
            {isAdmin && (
              <span style={{ display: 'inline-flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'center' }}>
                {etiquetasDe(loginFam).map(e => (
                  <span key={e.id} style={{ fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '10px', background: e.color, color: 'white' }}>
                    {e.ic} {e.corto}
                  </span>
                ))}
              </span>
            )}
          </div>

          {loginFam.pin_set_at ? (
            <div>
              <p style={{ fontSize: '13px', color: '#666', textAlign: 'center', margin: '0 0 1rem' }}>Ingresa tu PIN de acceso</p>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pin}
                onChange={e => { setPin(e.target.value.replace(/[^0-9]/g, '')); setPinErr(''); }}
                onKeyDown={e => e.key === 'Enter' && tryLogin()}
                autoFocus
                placeholder="• • • •"
                style={{ width: '100%', padding: '12px', textAlign: 'center', fontSize: '26px', border: `2px solid ${pinErr ? '#ef9a9a' : '#dde8dd'}`, borderRadius: '10px', letterSpacing: '6px', boxSizing: 'border-box', outline: 'none', marginBottom: '8px' }}
              />
              {pinErr && <p style={{ fontSize: '12px', color: '#c62828', textAlign: 'center', margin: '0 0 10px', fontWeight: 500 }}>{pinErr}</p>}
              <button onClick={tryLogin} disabled={verificando}
                style={{ width: '100%', padding: '11px', background: color, color: 'white', border: 'none', borderRadius: '8px', cursor: verificando ? 'wait' : 'pointer', fontWeight: 700, fontSize: '15px', marginBottom: '10px', opacity: verificando ? 0.7 : 1 }}>
                {verificando ? 'Verificando...' : 'Entrar'}
              </button>
            </div>
          ) : (
            <div>
              <div style={{ padding: '10px', background: isAdmin ? '#ffebee' : '#f5f5f5', borderRadius: '8px', marginBottom: '1rem', textAlign: 'center' }}>
                <p style={{ fontSize: '12px', color: isAdmin ? '#c62828' : '#aaa', margin: 0, fontWeight: isAdmin ? 600 : 400 }}>
                  {isAdmin
                    ? 'Esta cuenta tiene acceso al panel de la cooperativa y no tiene PIN. Por seguridad no puede entrar hasta que Administración le asigne uno.'
                    : 'Sin PIN configurado — acceso directo'}
                </p>
              </div>
              {/* Aunque no haya PIN se pasa por el servidor: es él quien decide si
                  se puede entrar, no el navegador. */}
              <button onClick={tryLogin} disabled={verificando}
                style={{ width: '100%', padding: '11px', background: color, color: 'white', border: 'none', borderRadius: '8px', cursor: verificando ? 'wait' : 'pointer', fontWeight: 700, fontSize: '15px', marginBottom: '10px', opacity: verificando ? 0.7 : 1 }}>
                {verificando ? 'Verificando...' : 'Entrar'}
              </button>
              {pinErr && <p style={{ fontSize: '12px', color: '#c62828', textAlign: 'center', margin: '0 0 10px', fontWeight: 500 }}>{pinErr}</p>}
            </div>
          )}

          <button onClick={() => setLoginFam(null)}
            style={{ width: '100%', padding: '8px', background: 'white', border: '1px solid #dde8dd', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: '#666' }}>
            ← Volver
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', background: 'linear-gradient(160deg, #f0f7f0 0%, #e6f2e6 55%, #e0f0ea 100%)', minHeight: '100vh' }}>
      <div style={{ textAlign: 'center', marginBottom: '3rem', animation: 'fadeInUp 0.5s ease both' }}>
        <div style={{ fontSize: '48px', marginBottom: '12px' }} className="pulse-emoji">🛒</div>
        <h1 style={{ fontSize: '28px', marginBottom: '8px', fontWeight: 700, color: '#2d5a2d', letterSpacing: '-0.02em' }}>Cooperativa de Compras</h1>
        <p style={{ color: '#666', margin: 0, fontSize: '14px' }}>{period?.label} · {period?.month}</p>
      </div>

      {admins.length > 0 && (
        <>
          <h2 style={{ fontSize: '11px', fontWeight: 600, color: '#888', textTransform: 'uppercase', marginBottom: '0.75rem', letterSpacing: '0.08em' }}>Comisiones</h2>
          <div className="stagger-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2.5rem' }}>
            {admins.map(f => (
              <button key={f.id} onClick={() => selectFam(f)}
                style={{ padding: '1.25rem', border: '1.5px solid #2196F3', borderRadius: '10px', background: 'white', cursor: 'pointer', textAlign: 'left', boxShadow: '0 1px 4px rgba(33,150,243,0.08)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#1565c0', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700, flexShrink: 0 }}>{f.initials}</div>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: '15px', color: '#1565c0', display: 'block' }}>{f.name}</strong>
                  <span style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '3px' }}>
                    {etiquetasDe(f).map(e => (
                      <span key={e.id} style={{ fontSize: '9px', fontWeight: 700, padding: '2px 6px', borderRadius: '8px', background: e.bg, color: e.color }}>
                        {e.ic} {e.corto}
                      </span>
                    ))}
                  </span>
                  {f.pin_set_at && <span style={{ fontSize: "9px", color: "#aaa" }}>🔒</span>}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <h2 style={{ fontSize: '11px', fontWeight: 600, color: '#888', textTransform: 'uppercase', marginBottom: '0.75rem', letterSpacing: '0.08em' }}>Familias ({fams.length})</h2>
      <div className="stagger-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
        {fams.map(f => (
          <button key={f.id} onClick={() => selectFam(f)}
            style={{ padding: '1rem 1.25rem', border: '1px solid #dde8dd', borderRadius: '10px', background: 'white', cursor: 'pointer', textAlign: 'left', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#4CAF50', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700 }}>{f.initials}</div>
              <strong style={{ fontSize: '14px', flex: 1 }}>{f.name}</strong>
              {f.pin_set_at && <span style={{ fontSize: "10px", color: "#aaa" }}>🔒</span>}
            </div>
            {f.balance !== 0 && (
              <p style={{ fontSize: '11px', color: f.balance > 0 ? '#2e7d32' : '#c62828', margin: 0, fontWeight: 500 }}>
                {f.balance > 0 ? 'Saldo a favor' : 'Saldo pendiente'}: ${Math.abs(f.balance).toLocaleString('es-CL')}
              </p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── FAMILY APP ───────────────────────────────────────────────────────────────

function FamilyApp({ user, families, setFamilies, products, sealed, sealOrderLocal, unsealOrderLocal, carts, setCarts, period, cargos, logout }) {
  const [tab, setTab] = useState('catalog');
  const [cat, setCat] = useState('all');
  const [srch, setSrch] = useState('');
  const [conf, setConf] = useState(false);
  const [bodega, setBodega] = useState([]);
  const [bodegaAssignments, setBodegaAssignments] = useState([]);
  const [reservingItem, setReservingItem] = useState(null);
  const [reserveQty, setReserveQty] = useState('');
  const [reserveErr, setReserveErr] = useState('');
  const [reserveSaving, setReserveSaving] = useState(false);

  const [ajustes, setAjustes] = useState([]);
  // Lo que los proveedores respondieron. Sin esto la familia veía su total a
  // pagar sin enterarse de que el proveedor ya había avisado que no traía algo.
  const [ordenesProv, setOrdenesProv] = useState([]);

  useEffect(() => {
    if (!period) return;
    Promise.all([
      getBodega(period.id), getBodegaAssignments(period.id), getAdjustments(period.id),
      getPurchaseOrders(period.id),
    ]).then(([itms, asns, ajs, ocs]) => {
      setBodega(itms);
      setBodegaAssignments(asns);
      setAjustes((ajs || []).filter(a => a.family_id === user.id));
      setOrdenesProv(ocs || []);
    });
  }, [period, user.id]);

  const cart = useMemo(() => carts[user.id] || {}, [carts, user.id]);
  const setCart = fn => setCarts(p => ({ ...p, [user.id]: fn(p[user.id] || {}) }));
  const add = id => setCart(p => ({ ...p, [id]: (p[id] || 0) + 1 }));
  const sub = id => setCart(p => ({ ...p, [id]: Math.max(0, (p[id] || 0) - 1) }));

  const currentUser = (families && families.find(f => f.id === user.id)) || user;

  // Cuánto de cargo fijo le toca a ESTA familia: el total del período menos los
  // cargos de los que está eximida.
  const cargo = cargos.de(currentUser.id);
  const misCargos = cargos.desgloseDe(currentUser.id);

  const items = useMemo(() =>
    Object.entries(cart).filter(([, q]) => q > 0).map(([id, qty]) => {
      const pr = products.find(x => x.id === parseInt(id));
      return pr ? { ...pr, qty, sub: pr.price * qty } : null;
    }).filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cart, products]
  );

  const total = items.reduce((s, i) => s + i.sub, 0);
  const cnt = items.reduce((s, i) => s + i.qty, 0);
  const ord = sealed[user.id];
  const saldo = currentUser.balance || 0;

  const getBodegaRemaining = (itemId) => {
    const item = bodega.find(i => i.id === itemId);
    if (!item) return 0;
    const used = bodegaAssignments.filter(a => a.bodega_id === itemId).reduce((s, a) => s + parseFloat(a.quantity), 0);
    return Math.max(0, parseFloat(item.quantity) - used);
  };

  const myReservations = bodegaAssignments.filter(a => a.family_id === user.id);

  const handleReserve = async () => {
    if (!reservingItem) return;
    const qty = parseFloat(reserveQty);
    if (isNaN(qty) || qty <= 0) { setReserveErr('Cantidad inválida'); return; }
    const remaining = getBodegaRemaining(reservingItem.id);
    if (qty > remaining + 0.001) { setReserveErr('Solo quedan ' + remaining + ' ' + reservingItem.unit); return; }
    setReserveSaving(true);
    const totalValue = Math.round(qty * reservingItem.price);
    const asn = {
      id: Date.now().toString(),
      bodega_id: reservingItem.id,
      family_id: user.id,
      family_name: user.name,
      product_name: reservingItem.product_name,
      quantity: qty,
      total_value: totalValue,
      period_id: period.id,
    };
    const result = await addBodegaAssignment(asn);
    if (result) {
      setBodegaAssignments(p => [result, ...p]);
      const newBal = (currentUser.balance || 0) - totalValue;
      await updateFamilyBalance(user.id, newBal);
      setFamilies(p => p.map(f => f.id === user.id ? { ...f, balance: newBal } : f));
      setReservingItem(null);
      setReserveQty('');
      setReserveErr('');
    } else { setReserveErr('Error al reservar'); }
    setReserveSaving(false);
  };

  const handleCancelReservation = async (asn) => {
    await deleteBodegaAssignment(asn.id);
    setBodegaAssignments(p => p.filter(a => a.id !== asn.id));
    const newBal = (currentUser.balance || 0) + asn.total_value;
    await updateFamilyBalance(user.id, newBal);
    setFamilies(p => p.map(f => f.id === user.id ? { ...f, balance: newBal } : f));
  };
  const cats = ['all', ...new Set(products.map(p => p.category).filter(Boolean))];
  const vis = useMemo(() =>
    products.filter(p => (cat === 'all' || p.category === cat) && (!srch || p.name.toLowerCase().includes(srch.toLowerCase()) || p.provider.toLowerCase().includes(srch.toLowerCase()))),
    [cat, srch, products]
  );

  // Si los pedidos están abiertos lo decide estadoPedidos(), igual que en el
  // panel: la comisión puede cerrarlos antes de la fecha y eso tiene que valer
  // acá también, o una familia seguiría modificando un pedido ya comprado.
  const now = new Date();
  const ventana = estadoPedidos(period, now);
  const noAbierto = ventana.fase === 'por_abrir';
  const cerrado = ventana.cerrados;
  const puedeOrdenar = ventana.abiertos;

  const daysLeft = period?.date_to ? Math.ceil((new Date(period.date_to + 'T23:59:59') - now) / 864e5) : null;
  const daysToDelivery = period?.date_delivery ? Math.ceil((new Date(period.date_delivery + 'T23:59:59') - now) / 864e5) : null;
  const alertaCierre = daysLeft !== null && daysLeft >= 0 && daysLeft <= 1;
  const alertaEntrega = daysToDelivery !== null && daysToDelivery >= 0 && daysToDelivery <= 1;

  const cuenta = cuentaDeFamilia({ ord, ajustes, cargo, saldo });

  const ordItems = useMemo(() => parseItems(ord), [ord]);

  const estadoProd = useMemo(
    () => estadoConfirmacionPorProducto(ordenesProv, period, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ordenesProv, period]
  );

  // Lo que el proveedor ya avisó que no trae, pero que todavía nadie descontó.
  // Sigue sumando en el total: decirlo es más honesto que mostrar una cifra que
  // la familia sabe que va a cambiar.
  const porDescontar = useMemo(() => {
    const caidos = ordItems.filter(i => i.qty > 0).filter(i => {
      const ec = estadoProd.get(i.id);
      if (!ec || ec.estado !== 'no_disponible') return false;
      return !ajustes.some(a => a.product_id === i.id && a.type === 'no_confirmado');
    });
    return { items: caidos, monto: caidos.reduce((sum, i) => sum + i.p * i.qty, 0) };
  }, [ordItems, estadoProd, ajustes]);

  return (
    <div style={{ background: '#f0f7f0', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ padding: '0.75rem 1rem', background: 'linear-gradient(180deg, #ffffff 0%, #f6faf6 100%)', borderBottom: '1px solid #dde8dd', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 2px 12px rgba(45,90,45,0.06)', position: 'sticky', top: 0, zIndex: 30, backdropFilter: 'saturate(1.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '20px' }}>🛒</span>
          <div>
            <strong style={{ fontSize: '14px', color: '#2d5a2d' }}>Cooperativa</strong>
            <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>{period?.label}</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#4CAF50', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700 }}>{user.initials}</div>
          <span style={{ fontSize: '12px', fontWeight: 500 }}>{user.name}</span>
          <button onClick={logout} style={{ padding: '4px 10px', border: '1px solid #dde8dd', borderRadius: '6px', background: 'white', cursor: 'pointer', fontSize: '11px', color: '#555' }}>Salir</button>
        </div>
      </div>

      {/* Alertas período */}
      {period && (
        <>
          {noAbierto && (
            <div style={{ padding: '0.6rem 1rem', background: '#e3f2fd', borderBottom: '1px solid #90caf9', fontSize: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span>📅</span>
              <span style={{ color: '#1565c0', fontWeight: 500 }}>
                Pedidos abren el {new Date(period.date_from).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
              </span>
            </div>
          )}
          {cerrado && (
            <div style={{ padding: '0.6rem 1rem', background: '#fbe9e7', borderBottom: '1px solid #ffab91', fontSize: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span>🔒</span>
              <span style={{ color: '#bf360c', fontWeight: 500 }}>{ventana.texto} — ya no se puede modificar</span>
            </div>
          )}
          {!noAbierto && !cerrado && (alertaCierre || alertaEntrega) && (
            <div style={{ padding: '0.6rem 1rem', background: '#fff8e1', borderBottom: '1px solid #ffe082', fontSize: '12px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              {alertaCierre && daysLeft === 0 && <span style={{ color: '#e65100', fontWeight: 700 }}>⏰ ¡Hoy cierra el período de pedidos!</span>}
              {alertaCierre && daysLeft === 1 && <span style={{ color: '#e65100', fontWeight: 700 }}>⏰ Mañana cierra el período de pedidos</span>}
              {alertaEntrega && daysToDelivery === 0 && <span style={{ color: '#2e7d32', fontWeight: 700 }}>🚚 ¡Hoy es la entrega!</span>}
              {alertaEntrega && daysToDelivery === 1 && <span style={{ color: '#2e7d32', fontWeight: 700 }}>🚚 Mañana es la entrega</span>}
            </div>
          )}
          {!noAbierto && !cerrado && !alertaCierre && !alertaEntrega && (
            <div style={{ padding: '0.5rem 1rem', background: '#e8f5e9', borderBottom: '1px solid #c8e6c9', fontSize: '12px', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, color: '#2e7d32' }}>{period.label}</span>
              {period.date_from && <span>📅 {new Date(period.date_from).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })} — {new Date(period.date_to).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}</span>}
              {period.date_delivery && <span>🚚 Entrega: {new Date(period.date_delivery).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}</span>}
              {ord?.retired && <span style={{ fontWeight: 600, color: '#2e7d32' }}>✓ Pedido entregado</span>}
            </div>
          )}
        </>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', background: 'white', borderBottom: '1px solid #dde8dd', overflowX: 'auto' }}>
        {[{ id: 'catalog', l: 'Catálogo', ic: '📦' }, { id: 'order', l: 'Mi Pedido', ic: '🛒', bdg: cnt }, { id: 'dates', l: 'Fechas', ic: '📅' }, { id: 'balance', l: 'Mi Saldo', ic: '💰' }].map(n => (
          <button key={n.id} onClick={() => setTab(n.id)}
            style={{ flex: 1, padding: '0.75rem 0.5rem', border: 'none', borderBottom: tab === n.id ? '2px solid #4CAF50' : '2px solid transparent', background: 'none', cursor: 'pointer', color: tab === n.id ? '#2e7d32' : '#666', fontWeight: tab === n.id ? 600 : 400, fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', position: 'relative', whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: '15px' }}>{n.ic}</span>
            {n.l}
            {n.bdg > 0 && !ord && <span style={{ position: 'absolute', top: '4px', right: '6px', background: '#f44336', color: 'white', fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: '10px' }}>{n.bdg}</span>}
          </button>
        ))}
      </div>

      <div style={{ padding: '1rem' }} className="tab-panel" key={tab}>
        {/* CATÁLOGO */}
        {tab === 'catalog' && (
          <div>
            {ord && (
              <div style={{ marginBottom: '1rem', padding: '10px 14px', borderRadius: '8px', background: ord.retired ? '#e8f5e9' : '#e3f2fd', border: `1px solid ${ord.retired ? '#81c784' : '#64b5f6'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ fontSize: '13px', fontWeight: 600, color: ord.retired ? '#2e7d32' : '#1565c0', margin: 0 }}>{ord.retired ? '✓ Pedido entregado' : '✓ Pedido sellado — en espera de entrega'}</p>
                  <p style={{ fontSize: '11px', color: '#666', margin: '3px 0 0' }}>{ord.retired ? 'Entregado el ' + new Date(ord.retired_at).toLocaleString('es-CL') : 'Sellado el ' + new Date(ord.sealed_at).toLocaleString('es-CL')}</p>
                </div>
                {!ord.retired && puedeOrdenar && <button onClick={() => unsealOrderLocal(user.id)} style={{ padding: '6px 12px', background: '#fff8e1', border: '1px solid #ffc107', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 500 }}>Modificar</button>}
              </div>
            )}
            <div style={{ marginBottom: '0.75rem' }}>
              <input type="text" placeholder="Buscar producto o proveedor..." value={srch} onChange={e => setSrch(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #dde8dd', borderRadius: '8px', fontSize: '13px', background: 'white', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '0.75rem' }}>
              {cats.map(c => (
                <button key={c} onClick={() => setCat(c)}
                  style={{ padding: '5px 14px', borderRadius: '20px', border: '1px solid', cursor: 'pointer', fontSize: '11px', fontWeight: 500, background: cat === c ? '#4CAF50' : 'white', borderColor: cat === c ? '#4CAF50' : '#dde8dd', color: cat === c ? 'white' : '#555', whiteSpace: 'nowrap' }}>
                  {c === 'all' ? 'Todos' : c}
                </button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: '10px' }}>
              {vis.map(pr => {
                const qty = ord ? (ordItems.find(x => x.id === pr.id) || {}).qty || 0 : (cart[pr.id] || 0);
                const lk = !!ord || !puedeOrdenar;
                return (
                  <div key={pr.id} className="lift" style={{ padding: '0.9rem', background: 'white', border: '1px solid #dde8dd', borderRadius: '8px', opacity: pr.in_stock ? 1 : 0.55, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                    <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '4px', background: pr.in_stock ? '#e8f5e9' : '#ffebee', color: pr.in_stock ? '#2e7d32' : '#c62828' }}>{pr.in_stock ? '✓ Disponible' : 'Sin stock'}</span>
                    <p style={{ fontWeight: 600, fontSize: '12px', lineHeight: 1.35, marginTop: '8px', marginBottom: '3px', color: '#222' }}>{pr.name}</p>
                    <p style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>{pr.unit} · {pr.provider}</p>
                    <p style={{ fontWeight: 700, fontSize: '14px', marginBottom: '10px', color: '#2d5a2d' }}>${pr.price.toLocaleString('es-CL')}</p>
                    {lk
                      ? qty > 0 ? <div style={{ textAlign: 'center', fontSize: '11px', padding: '5px', background: '#f0f7f0', borderRadius: '6px', color: '#2e7d32', fontWeight: 500 }}>{qty} en pedido</div> : <div style={{ height: '28px' }} />
                      : qty === 0
                        ? <button onClick={() => pr.in_stock && add(pr.id)} disabled={!pr.in_stock} style={{ width: '100%', padding: '6px', border: `1px solid ${pr.in_stock ? '#4CAF50' : '#ccc'}`, background: pr.in_stock ? '#4CAF50' : 'white', color: pr.in_stock ? 'white' : '#aaa', borderRadius: '6px', cursor: pr.in_stock ? 'pointer' : 'not-allowed', fontSize: '12px', fontWeight: 600 }}>+ Agregar</button>
                        : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <button onClick={() => sub(pr.id)} style={{ width: '26px', height: '26px', border: '1px solid #dde8dd', background: 'white', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '14px' }}>−</button>
                            <span style={{ fontWeight: 700, fontSize: '15px' }}>{qty}</span>
                            <button onClick={() => add(pr.id)} style={{ width: '26px', height: '26px', border: '1px solid #4CAF50', background: '#4CAF50', color: 'white', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '14px' }}>+</button>
                          </div>
                    }
                  </div>
                );
              })}
            </div>

            {/* PRODUCTOS DE BODEGA */}
            {bodega.filter(item => getBodegaRemaining(item.id) > 0).length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <p style={{ fontSize: '11px', fontWeight: 700, color: '#1565c0', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  🏪 Productos disponibles en Bodega
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: '10px' }}>
                  {bodega.filter(item => getBodegaRemaining(item.id) > 0).map(item => {
                    const remaining = getBodegaRemaining(item.id);
                    const myRes = myReservations.find(r => r.bodega_id === item.id);
                    return (
                      <div key={item.id} className="lift" style={{ padding: '0.9rem', background: 'white', border: '1.5px solid #90caf9', borderRadius: '8px', boxShadow: '0 1px 3px rgba(21,101,192,0.07)' }}>
                        <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '4px', background: '#e3f2fd', color: '#1565c0' }}>🏪 Bodega</span>
                        <p style={{ fontWeight: 600, fontSize: '12px', lineHeight: 1.35, marginTop: '8px', marginBottom: '3px', color: '#222' }}>{item.product_name}</p>
                        <p style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>{item.unit} · quedan: {remaining}</p>
                        <p style={{ fontWeight: 700, fontSize: '14px', marginBottom: '10px', color: '#1565c0' }}>${parseInt(item.price).toLocaleString('es-CL')} /{item.unit}</p>
                        {myRes ? (
                          <div style={{ textAlign: 'center', fontSize: '11px', padding: '5px', background: '#e3f2fd', borderRadius: '6px', color: '#1565c0', fontWeight: 600 }}>
                            ✓ Reservado: {myRes.quantity} {item.unit}
                          </div>
                        ) : (
                          <button onClick={() => { if (puedeOrdenar) { setReservingItem(item); setReserveQty(''); setReserveErr(''); } }}
                            disabled={!puedeOrdenar}
                            style={{ width: '100%', padding: '6px', border: `1px solid ${puedeOrdenar ? '#1565c0' : '#dde8dd'}`, background: puedeOrdenar ? '#1565c0' : 'white', color: puedeOrdenar ? 'white' : '#aaa', borderRadius: '6px', cursor: puedeOrdenar ? 'pointer' : 'not-allowed', fontSize: '12px', fontWeight: 600 }}>
                            + Reservar
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* MODAL RESERVA BODEGA */}
            {reservingItem && (
              <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
                <div className="modal-card" style={{ background: 'white', borderRadius: '16px', padding: '1.5rem', width: '100%', maxWidth: '320px', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
                  <p style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 4px', color: '#1565c0' }}>🏪 Reservar de Bodega</p>
                  <p style={{ fontSize: '13px', color: '#555', margin: '0 0 1rem' }}>{reservingItem.product_name} — ${parseInt(reservingItem.price).toLocaleString('es-CL')} /{reservingItem.unit}</p>
                  <label style={{ fontSize: '12px', color: '#666', display: 'block', marginBottom: '6px' }}>
                    Cantidad ({reservingItem.unit}) — máx {getBodegaRemaining(reservingItem.id)}
                  </label>
                  <input type="number" step="0.5" placeholder="0" value={reserveQty}
                    onChange={e => { setReserveQty(e.target.value); setReserveErr(''); }}
                    autoFocus
                    style={{ width: '100%', padding: '10px', border: '2px solid #90caf9', borderRadius: '8px', fontSize: '18px', textAlign: 'center', boxSizing: 'border-box', marginBottom: '8px', outline: 'none' }} />
                  {reserveQty && parseFloat(reserveQty) > 0 && (
                    <div style={{ padding: '8px 12px', background: '#fff3e0', borderRadius: '6px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '12px', color: '#555' }}>Se cargará a tu saldo</span>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#c62828' }}>−${Math.round(parseFloat(reserveQty) * reservingItem.price).toLocaleString('es-CL')}</span>
                    </div>
                  )}
                  {reserveErr && <p style={{ fontSize: '12px', color: '#c62828', margin: '0 0 8px' }}>{reserveErr}</p>}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={handleReserve} disabled={reserveSaving}
                      style={{ flex: 1, padding: '10px', background: '#1565c0', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '14px' }}>
                      {reserveSaving ? 'Reservando...' : 'Confirmar'}
                    </button>
                    <button onClick={() => { setReservingItem(null); setReserveErr(''); }}
                      style={{ padding: '10px 14px', background: 'white', border: '1px solid #dde8dd', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* MI PEDIDO */}
        {tab === 'order' && (
          <div>
            {ord ? (
              <div>
                <div style={{ background: ord.retired ? '#e8f5e9' : '#e3f2fd', border: `1px solid ${ord.retired ? '#81c784' : '#64b5f6'}`, borderRadius: '8px', padding: '1rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ fontSize: '14px', fontWeight: 600, color: ord.retired ? '#2e7d32' : '#1565c0', margin: 0 }}>✓ {ord.retired ? 'Pedido entregado' : 'Pedido sellado'}</p>
                    <p style={{ fontSize: '11px', color: '#666', margin: '4px 0 0' }}>Sellado: {new Date(ord.sealed_at).toLocaleString('es-CL')}</p>
                  </div>
                  {!ord.retired && puedeOrdenar && <button onClick={() => unsealOrderLocal(user.id)} style={{ padding: '6px 14px', background: '#fff8e1', border: '1px solid #ffc107', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}>Modificar</button>}
                </div>
                {ordItems.filter(i => i.qty > 0).map(i => {
                  const ec = estadoProd.get(i.id);
                  const st = ESTADOS_CONFIRMACION[ec ? ec.estado : 'sin_orden'];
                  const caido = !!ec && ec.estado === 'no_disponible';
                  const apagado = caido ? { textDecoration: 'line-through', color: '#aaa' } : {};
                  return (
                    <div key={i.id} style={{ padding: '0.8rem 1rem', background: 'white', border: '1px solid ' + (caido ? '#ffcdd2' : '#dde8dd'), borderRadius: '8px', marginBottom: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontSize: '13px', fontWeight: 500, margin: 0, ...apagado }}>{i.n}</p>
                          <p style={{ fontSize: '11px', color: '#888', margin: '3px 0 0' }}>{i.pv} · {i.u}</p>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <p style={{ fontSize: '11px', color: '#888', margin: 0 }}>×{i.qty}</p>
                          <p style={{ fontSize: '13px', fontWeight: 600, margin: '2px 0 0', ...apagado }}>${(i.p * i.qty).toLocaleString('es-CL')}</p>
                        </div>
                      </div>
                      <div style={{ marginTop: '7px' }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '3px 8px', borderRadius: '10px', background: st.bg, color: st.color, display: 'inline-block' }}>
                          {st.ic} {st.txt}
                        </span>
                        {ec && ec.estado === 'parcial' && (
                          <p style={{ fontSize: '10px', color: '#8d6e63', margin: '5px 0 0', lineHeight: 1.45 }}>
                            Alcanza para {ec.confirmado} de las {ec.pedido} que pidió toda la cooperativa. La comisión reparte y te avisa si te toca menos.
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
                {/* Los ajustes se muestran uno por uno, no fundidos en el total.
                    Si a alguien le cambia lo que debe, tiene derecho a ver por qué. */}
                {ajustes.length > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    <p style={{ fontSize: '11px', fontWeight: 700, color: '#e65100', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Cambios en tu pedido
                    </p>
                    {ajustes.map(a => {
                      const cfg = TIPOS[a.type] || {};
                      return (
                        <div key={a.id} style={{ padding: '0.7rem 0.9rem', background: cfg.bg, border: `1px solid ${cfg.color}33`, borderRadius: '8px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '9px' }}>
                          <span style={{ fontSize: '15px' }}>{cfg.ic}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: '12px', fontWeight: 600, margin: 0, color: '#333' }}>
                              {a.product_name} <span style={{ color: '#888', fontWeight: 400 }}>×{a.qty}</span>
                            </p>
                            <p style={{ fontSize: '10px', color: '#777', margin: '2px 0 0' }}>
                              {a.type === 'no_confirmado' ? 'El proveedor no lo trajo — no se te cobra'
                                : a.type === 'faltante' ? 'No llegó a tu caja — se te devuelve'
                                : a.paid ? 'Extra que ya pagaste' : 'Extra que te llevaste — se suma'}
                              {a.note && ' · ' + a.note}
                            </p>
                          </div>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: cfg.color, whiteSpace: 'nowrap' }}>
                            {a.type === 'extra' && a.paid ? 'pagado' : (a.amount > 0 ? '+' : '') + clp(a.amount)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div style={{ background: 'white', border: '1px solid #c8e6c9', borderRadius: '8px', padding: '1rem', marginTop: '1rem' }}>
                  <p style={{ fontSize: '12px', fontWeight: 700, color: '#2e7d32', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Resumen del pedido</p>
                  {[
                    { l: 'Subtotal productos', v: cuenta.subtotal, mostrar: true },
                    // Cada cargo con su nombre, no un total anónimo: un cargo
                    // que la familia no puede explicar es un cargo que se
                    // discute después, por WhatsApp y sin la cifra a la vista.
                    ...misCargos.filter(c => !c.exenta).map(c => ({ l: c.name, v: c.amount, mostrar: c.amount !== 0 })),
                    ...misCargos.filter(c => c.exenta).map(c => ({
                      l: c.name + ' — estás eximida', v: 0, mostrar: true,
                    })),
                    { l: '📭 No confirmados por el proveedor', v: cuenta.noConfirmados, mostrar: cuenta.noConfirmados !== 0 },
                    { l: '❗ Faltantes en tu caja', v: cuenta.faltantes, mostrar: cuenta.faltantes !== 0 },
                    { l: '➕ Extras', v: cuenta.extras, mostrar: cuenta.extras !== 0 },
                    { l: 'Saldo anterior (' + (saldo > 0 ? 'a favor' : 'pendiente') + ')', v: -saldo, mostrar: saldo !== 0 },
                  ].filter(r => r.mostrar).map(r => (
                    <div key={r.l} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f0f7f0' }}>
                      <span style={{ fontSize: '13px', color: '#555' }}>{r.l}</span>
                      <span style={{ fontSize: '13px', fontWeight: 500, color: r.v < 0 ? '#2e7d32' : '#333' }}>
                        {r.v < 0 ? '− ' : ''}{clp(Math.abs(r.v))}
                      </span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0' }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#2d5a2d' }}>
                      {ord.charged_at ? 'Total cobrado' : 'Total a pagar'}
                    </span>
                    <span style={{ fontSize: '16px', fontWeight: 700, color: '#2d5a2d' }}>{clp(cuenta.aPagar)}</span>
                  </div>
                  <p style={{ fontSize: '10px', color: '#aaa', margin: '4px 0 0' }}>
                    {ord.charged_at
                      ? 'Descontado de tu saldo al cerrar el período.'
                      : 'Se descuenta de tu saldo cuando se cierre el período, no ahora.'}
                  </p>

                  {/* Mostrar el total sin decir que va a cambiar sería mentir a
                      medias: el proveedor ya avisó, solo falta que la comisión
                      lo registre. */}
                  {porDescontar.monto > 0 && (
                    <div style={{ background: '#fff3e0', border: '1px solid #ffcc80', borderRadius: '8px', padding: '9px 11px', marginTop: '10px' }}>
                      <p style={{ fontSize: '11px', fontWeight: 700, color: '#e65100', margin: 0 }}>
                        📭 Este total todavía va a bajar
                      </p>
                      <p style={{ fontSize: '11px', color: '#795548', margin: '4px 0 0', lineHeight: 1.5 }}>
                        El proveedor avisó que no trae {porDescontar.items.length === 1 ? 'un producto' : porDescontar.items.length + ' productos'} de
                        tu pedido, por {clp(porDescontar.monto)}. Cuando la comisión lo registre, tu total
                        quedará en aproximadamente <strong>{clp(Math.max(0, cuenta.aPagar - porDescontar.monto))}</strong>.
                      </p>
                    </div>
                  )}
                  {cuenta.quedaAFavor > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 0' }}>
                      <span style={{ fontSize: '12px', color: '#2e7d32' }}>Te quedará a favor</span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#2e7d32' }}>{clp(cuenta.quedaAFavor)}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : !puedeOrdenar ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                <p style={{ fontSize: '44px', margin: 0 }}>{noAbierto ? '📅' : '🔒'}</p>
                <p style={{ color: '#555', marginTop: '1rem', fontWeight: 500 }}>
                  {noAbierto ? 'Los pedidos aún no están disponibles' : 'El período de pedidos está cerrado'}
                </p>
                <p style={{ color: '#999', fontSize: '12px', marginTop: '4px' }}>
                  {noAbierto ? `Abren el ${new Date(period.date_from).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}` : 'Consulta con el administrador'}
                </p>
              </div>
            ) : items.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                <p style={{ fontSize: '44px', margin: 0 }}>🛒</p>
                <p style={{ color: '#555', marginTop: '1rem', fontWeight: 500 }}>Tu carrito está vacío</p>
                <p style={{ color: '#999', fontSize: '12px', marginTop: '4px' }}>Agrega productos desde el catálogo</p>
              </div>
            ) : (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '1rem' }}>
                  {[
                    { l: 'Subtotal', v: '$' + total.toLocaleString('es-CL') },
                    {
                      l: misCargos.filter(c => !c.exenta).length === 1
                        ? misCargos.find(c => !c.exenta).name
                        : 'Cargos fijos',
                      v: '$' + cargo.toLocaleString('es-CL'),
                      // El desglose en el title: en tres tarjetas angostas no
                      // cabe, y el resumen de abajo ya lo lista completo.
                      ay: misCargos.map(c => c.name + (c.exenta ? ' (exenta)' : ': $' + c.amount.toLocaleString('es-CL'))).join(' · '),
                    },
                    { l: 'Total', v: '$' + (total + cargo).toLocaleString('es-CL') },
                  ].map(m => (
                    <div key={m.l} title={m.ay || undefined} style={{ padding: '0.9rem', background: 'white', borderRadius: '8px', textAlign: 'center', border: '1px solid #dde8dd' }}>
                      <p style={{ fontSize: '10px', color: '#888', margin: 0 }}>{m.l}</p>
                      <p style={{ fontSize: '14px', fontWeight: 700, margin: '5px 0 0', color: '#2d5a2d' }}>{m.v}</p>
                    </div>
                  ))}
                </div>
                {saldo !== 0 && (
                  <div style={{ padding: '10px 12px', background: saldo > 0 ? '#e8f5e9' : '#ffebee', border: `1px solid ${saldo > 0 ? '#81c784' : '#ef9a9a'}`, borderRadius: '8px', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '13px', color: '#555' }}>Saldo anterior</span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: saldo > 0 ? '#2e7d32' : '#c62828' }}>{saldo > 0 ? 'A favor ' : 'Pendiente '} ${Math.abs(saldo).toLocaleString('es-CL')}</span>
                  </div>
                )}
                {!conf
                  ? <button onClick={() => setConf(true)} style={{ width: '100%', padding: '11px', border: 'none', background: '#4CAF50', color: 'white', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '14px', marginBottom: '1rem' }}>🔒 Sellar Pedido</button>
                  : (
                    <div style={{ background: '#fff8e1', border: '1px solid #ffc107', borderRadius: '8px', padding: '1rem', marginBottom: '1rem' }}>
                      <p style={{ fontWeight: 600, fontSize: '14px', color: '#e65100', margin: 0 }}>¿Confirmar sellado?</p>
                      <p style={{ fontSize: '12px', color: '#666', margin: '6px 0 0' }}>Podrás modificarlo mientras el período {period?.label} esté activo.</p>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '1rem' }}>
                        <button onClick={() => { sealOrderLocal(user.id, items.map(i => ({ id: i.id, n: i.name, pv: i.provider, p: i.price, u: i.unit, qty: i.qty })), total); setConf(false); setTab('catalog'); }}
                          style={{ flex: 1, padding: '8px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>Confirmar</button>
                        <button onClick={() => setConf(false)} style={{ flex: 1, padding: '8px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
                      </div>
                    </div>
                  )
                }
                {items.map(it => (
                  <div key={it.id} style={{ padding: '0.9rem 1rem', background: 'white', border: '1px solid #dde8dd', borderRadius: '8px', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: '13px', fontWeight: 500, margin: 0 }}>{it.name}</p>
                      <p style={{ fontSize: '11px', color: '#888', margin: '3px 0 0' }}>{it.provider} · {it.unit} · ${it.price.toLocaleString('es-CL')}</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginLeft: '1rem' }}>
                      <button onClick={() => sub(it.id)} style={{ width: '26px', height: '26px', border: '1px solid #dde8dd', background: 'white', borderRadius: '6px', cursor: 'pointer', fontWeight: 700 }}>−</button>
                      <span style={{ fontSize: '14px', fontWeight: 700, minWidth: '20px', textAlign: 'center' }}>{it.qty}</span>
                      <button onClick={() => add(it.id)} style={{ width: '26px', height: '26px', border: '1px solid #4CAF50', background: '#4CAF50', color: 'white', borderRadius: '6px', cursor: 'pointer', fontWeight: 700 }}>+</button>
                      <span style={{ fontSize: '12px', fontWeight: 600, minWidth: '72px', textAlign: 'right', color: '#2d5a2d' }}>${it.sub.toLocaleString('es-CL')}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <FamiliaAjustes user={user} ord={ord} period={period} products={products} ajustes={ajustes} setAjustes={setAjustes} />

            {/* RESERVAS DE BODEGA */}
            {myReservations.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <p style={{ fontSize: '11px', fontWeight: 700, color: '#1565c0', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>🏪 Reservas de Bodega</p>
                {myReservations.map(asn => (
                  <div key={asn.id} style={{ padding: '0.8rem 1rem', background: '#f8fbff', border: '1px solid #90caf9', borderRadius: '8px', marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <p style={{ fontSize: '13px', fontWeight: 500, margin: 0 }}>{asn.product_name}</p>
                      <p style={{ fontSize: '11px', color: '#888', margin: '3px 0 0' }}>{asn.quantity} unidades</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#c62828' }}>−${asn.total_value.toLocaleString('es-CL')}</span>
                      {!ord?.retired && (
                        <button onClick={() => handleCancelReservation(asn)}
                          style={{ width: '24px', height: '24px', border: '1px solid #ffcdd2', background: '#fff5f5', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', color: '#c62828', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* FECHAS */}
        {tab === 'dates' && (
          <div>
            <div style={{ background: cerrado ? '#fbe9e7' : noAbierto ? '#e3f2fd' : '#e8f5e9', border: '1px solid ' + (cerrado ? '#ffab91' : noAbierto ? '#90caf9' : '#a5d6a7'), borderRadius: '8px', padding: '11px 14px', marginBottom: '1rem' }}>
              <p style={{ fontSize: '13px', fontWeight: 700, margin: 0, color: cerrado ? '#bf360c' : noAbierto ? '#1565c0' : '#2e7d32' }}>
                {cerrado ? '🔒 Pedidos cerrados' : noAbierto ? '📅 Pedidos aún no abren' : '🛒 Pedidos abiertos'}
              </p>
              <p style={{ fontSize: '12px', color: '#666', margin: '4px 0 0' }}>{ventana.texto}</p>
            </div>

            <div style={{ display: 'grid', gap: '10px', marginBottom: '1.5rem' }}>
              {[{ ic: '📅', k: 'date_from', l: 'Apertura de pedidos', s: 'Desde este día puedes armar tu pedido' },
                { ic: '⏰', k: 'date_to', l: 'Cierre de pedidos', s: 'Último día para pedir o modificar' },
                { ic: '📨', k: 'date_confirm_until', l: 'Los proveedores confirman hasta', s: 'Antes de esta fecha sabemos qué traen y qué no' },
                { ic: '🚚', k: 'date_delivery', l: 'Entrega', s: 'El día del retiro' },
                { ic: '✏️', k: 'date_adjust_until', l: 'Avisar faltantes y extras hasta', s: 'Después de esta fecha ya no puedes reclamar por tu caja' }].map(d => {
                const iso = period && period[d.k];
                return (
                  <div key={d.l} style={{ background: 'white', borderRadius: '8px', padding: '1rem 1.1rem', display: 'flex', alignItems: 'center', gap: '1rem', border: '1px solid #dde8dd' }}>
                    <span style={{ fontSize: '26px', opacity: iso ? 1 : 0.3 }}>{d.ic}</span>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: '11px', color: '#888', margin: 0 }}>{d.l}</p>
                      <p style={{ fontSize: '15px', fontWeight: 600, margin: '2px 0 0', textTransform: 'capitalize', color: iso ? '#2d5a2d' : '#bbb' }}>
                        {iso ? new Date(iso + 'T00:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Por confirmar'}
                      </p>
                      <p style={{ fontSize: '10px', color: '#aaa', margin: '3px 0 0' }}>{d.s}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ background: 'white', borderRadius: '8px', padding: '1.1rem', border: '1px solid #dde8dd' }}>
              <p style={{ fontWeight: 600, fontSize: '13px', marginBottom: '0.75rem', margin: '0 0 0.75rem', color: '#333' }}>Estado de tu pedido</p>
              {ord ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '32px' }}>{ord.retired ? '✅' : '📦'}</span>
                  <div>
                    <p style={{ fontWeight: 600, fontSize: '14px', margin: 0 }}>{ord.retired ? 'Pedido entregado' : 'Pedido sellado — esperando entrega'}</p>
                    <p style={{ fontSize: '11px', color: '#888', margin: '4px 0 0' }}>{ord.retired ? 'Entregado el ' + new Date(ord.retired_at).toLocaleString('es-CL') : 'Sellado el ' + new Date(ord.sealed_at).toLocaleString('es-CL')}</p>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '32px' }}>📋</span>
                  <div>
                    <p style={{ fontWeight: 600, fontSize: '14px', margin: 0 }}>Sin pedido enviado</p>
                    <p style={{ fontSize: '11px', color: '#888', margin: '4px 0 0' }}>Ve al catálogo para armar y sellar tu pedido</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* MI SALDO */}
        {tab === 'balance' && (
          <SaldoFamilia user={currentUser} ord={ord} cargo={cargo} misCargos={misCargos} period={period} ajustes={ajustes} />
        )}
      </div>
    </div>
  );
}

function SaldoFamilia({ user, ord, cargo, misCargos = [], period, ajustes = [] }) {
  const saldo = user.balance || 0;
  const cuenta = cuentaDeFamilia({ ord, ajustes, cargo, saldo });
  const totalAPagar = cuenta.aPagar;
  const saldoFavor = cuenta.quedaAFavor;

  return (
    <div>
      <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #c8e6c9', padding: '1.25rem', marginBottom: '1rem', boxShadow: '0 2px 6px rgba(76,175,80,0.08)' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Saldo disponible</p>
        <p style={{ fontSize: '32px', fontWeight: 700, margin: '0 0 4px', color: saldo > 0 ? '#2e7d32' : saldo < 0 ? '#c62828' : '#333' }}>
          {saldo > 0 ? '+' : saldo < 0 ? '-' : ''} ${Math.abs(saldo).toLocaleString('es-CL')}
        </p>
        <p style={{ fontSize: '12px', color: saldo > 0 ? '#43a047' : saldo < 0 ? '#e53935' : '#888', margin: 0 }}>
          {saldo > 0 ? 'Tienes saldo a favor' : saldo < 0 ? 'Saldo pendiente de pago' : 'Al día — sin saldo pendiente'}
        </p>
      </div>

      <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #dde8dd', padding: '1.25rem', marginBottom: '1rem' }}>
        <p style={{ fontSize: '12px', fontWeight: 700, color: '#2e7d32', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' }}>Período {period?.label}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f0f7f0' }}>
            <span style={{ fontSize: '13px', color: '#555' }}>Saldo anterior</span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: saldo > 0 ? '#2e7d32' : saldo < 0 ? '#c62828' : '#888' }}>
              {saldo > 0 ? '+ ' : saldo < 0 ? '- ' : ''} ${Math.abs(saldo).toLocaleString('es-CL')}
            </span>
          </div>
          {ord ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f0f7f0' }}>
                <span style={{ fontSize: '13px', color: '#555' }}>Subtotal productos</span>
                <span style={{ fontSize: '13px', fontWeight: 500 }}>${ord.total.toLocaleString('es-CL')}</span>
              </div>
              {misCargos.map(c => (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f0f7f0' }}>
                  <span style={{ fontSize: '13px', color: c.exenta ? '#aaa' : '#555' }}>
                    {c.name}
                    {c.note && <span style={{ fontSize: '11px', color: '#bbb' }}> · {c.note}</span>}
                    {c.exenta && <span style={{ fontSize: '11px', color: '#2e7d32', fontWeight: 600 }}> · estás eximida</span>}
                  </span>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: c.exenta ? '#aaa' : '#333', textDecoration: c.exenta ? 'line-through' : 'none' }}>
                    ${Number(c.amount).toLocaleString('es-CL')}
                  </span>
                </div>
              ))}
              {[
                { l: '📭 No confirmados por el proveedor', v: cuenta.noConfirmados },
                { l: '❗ Faltantes en tu caja', v: cuenta.faltantes },
                { l: '➕ Extras', v: cuenta.extras },
              ].filter(r => r.v !== 0).map(r => (
                <div key={r.l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f0f7f0' }}>
                  <span style={{ fontSize: '13px', color: '#555' }}>{r.l}</span>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: r.v < 0 ? '#2e7d32' : '#1565c0' }}>
                    {r.v < 0 ? '− ' : '+ '}{clp(Math.abs(r.v))}
                  </span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0 0' }}>
                <span style={{ fontSize: '14px', fontWeight: 700, color: '#2d5a2d' }}>Total a pagar</span>
                <span style={{ fontSize: '17px', fontWeight: 700, color: totalAPagar > 0 ? '#c62828' : '#2e7d32' }}>${totalAPagar.toLocaleString('es-CL')}</span>
              </div>
              {saldoFavor > 0 && (
                <div style={{ marginTop: '8px', padding: '8px 12px', background: '#e8f5e9', borderRadius: '6px', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: '#2e7d32' }}>Quedará saldo a favor</span>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#2e7d32' }}>+${saldoFavor.toLocaleString('es-CL')}</span>
                </div>
              )}
            </>
          ) : (
            <div style={{ padding: '1rem 0', textAlign: 'center' }}>
              <p style={{ color: '#888', fontSize: '13px', margin: 0 }}>Aún no tienes pedido sellado en este período</p>
            </div>
          )}
        </div>
      </div>

      {ord && (
        <div style={{ background: ord.retired ? '#e8f5e9' : '#e3f2fd', border: `1px solid ${ord.retired ? '#81c784' : '#64b5f6'}`, borderRadius: '10px', padding: '1rem', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '28px' }}>{ord.retired ? '✅' : '📦'}</span>
          <div>
            <p style={{ fontWeight: 600, fontSize: '13px', margin: 0, color: ord.retired ? '#2e7d32' : '#1565c0' }}>{ord.retired ? 'Pedido entregado' : 'Pedido sellado — esperando entrega'}</p>
            <p style={{ fontSize: '11px', color: '#666', margin: '3px 0 0' }}>
              {ord.retired ? `Entregado el ${new Date(ord.retired_at).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' })}` : `Sellado el ${new Date(ord.sealed_at).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ADMIN APP ────────────────────────────────────────────────────────────────

function AdminApp({ user, families, setFamilies, products, setProducts, providers, setProviders, sealed, setSealed, period, setPeriod, cargos, recargarCargos, logout, carts, setCarts, sealOrderLocal, unsealOrderLocal, markRetiredLocal, updateFamilyBalance }) {
  const [tab, setTab] = useState('dashboard');
  const [hacerPedidoFam, setHacerPedidoFam] = useState(null);

  // OJO: esto excluye a las familias administradoras, que también piden. Es la
  // deuda técnica anotada en docs/FASE-2.md §8 — arreglarla cambia a quién se le
  // cobra plata al cerrar el período, y esa decisión es de la cooperativa.
  const na = families.filter(f => f.role === 'familia');

  // Eximir a una familia de un cargo mueve plata de la cooperativa. La
  // cooperativa pidió que lo decidan Administración y Balance Contable; los
  // demás perfiles ven las exenciones pero no las conceden ni las quitan.
  const puedeEximir = tieneRol(user, 'admin') || tieneRol(user, 'contable');

  const todasLasTabs = [
    { id: 'dashboard', l: 'Resumen', ic: '📊' },
    { id: 'analitica', l: 'Analítica', ic: '📈' },
    { id: 'pedidos', l: 'Pedidos', ic: '📋' },
    { id: 'consolidado', l: 'Consolidado', ic: '🧾' },
    { id: 'retiros', l: 'Retiros', ic: '🚚' },
    { id: 'ajustes', l: 'Faltantes y Extras', ic: '⚖️' },
    { id: 'flujo', l: 'Flujo Caja', ic: '💵' },
    { id: 'bodega', l: 'Bodega', ic: '🏪' },
    { id: 'familias', l: 'Familias', ic: '👥' },
    { id: 'proveedores', l: 'Proveedores', ic: '🚜' },
    { id: 'productos', l: 'Productos', ic: '🏷️' },
    { id: 'saldos', l: 'Saldos', ic: '💳' },
    { id: 'periodo', l: 'Período', ic: '📅' },
    { id: 'reportes', l: 'Reportes', ic: '📗' },
    { id: 'importar', l: 'Precios y formatos', ic: '📥' },
    { id: 'actividad', l: 'Actividad', ic: '📝' },
  ];

  // Cada comisión ve lo suyo. Organiza el acceso, no lo protege: mientras RLS
  // siga apagado esto decide qué se muestra, no qué se puede hacer.
  const tabs = tabsVisibles(user, todasLasTabs);
  const misEtiquetas = etiquetasDe(user);

  // Si el perfil no incluye la pestaña activa (por ejemplo tras un cambio de
  // rol), se cae a la primera que sí tenga en vez de mostrar una página vacía.
  const tabActiva = tabs.some(t => t.id === tab) ? tab : (tabs[0] ? tabs[0].id : null);

  if (hacerPedidoFam) {
    return (
      <div style={{ background: '#f0f7f0', minHeight: '100vh' }}>
        <div style={{ padding: '0.75rem 1rem', background: 'white', borderBottom: '1px solid #dde8dd', display: 'flex', alignItems: 'center', gap: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <button onClick={() => setHacerPedidoFam(null)} style={{ padding: '5px 12px', border: '1px solid #dde8dd', borderRadius: '6px', background: 'white', cursor: 'pointer', fontSize: '12px' }}>← Volver</button>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#1565c0' }}>
            {hacerPedidoFam.id === user.id ? '🛒 Mi pedido (Admin)' : `Haciendo pedido por: ${hacerPedidoFam.name}`}
          </span>
        </div>
        <FamilyApp
          user={hacerPedidoFam}
          families={families}
          setFamilies={setFamilies}
          products={products}
          sealed={sealed}
          sealOrderLocal={sealOrderLocal}
          unsealOrderLocal={unsealOrderLocal}
          carts={carts}
          setCarts={setCarts}
          period={period}
          cargos={cargos}
          logout={() => setHacerPedidoFam(null)}
        />
      </div>
    );
  }

  return (
    <div style={{ background: '#f0f7f0', minHeight: '100vh' }}>
      <div style={{ padding: '0.75rem 1rem', background: 'linear-gradient(180deg, #ffffff 0%, #f6faf6 100%)', borderBottom: '1px solid #dde8dd', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 2px 12px rgba(45,90,45,0.06)', position: 'sticky', top: 0, zIndex: 30, backdropFilter: 'saturate(1.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '20px' }}>🛒</span>
          <div>
            <strong style={{ fontSize: '14px', color: '#1565c0' }}>
              {esAdmin(user) ? 'Panel Admin — Cooperativa' : 'Panel — Cooperativa Quilpueblo'}
            </strong>
            <p style={{ fontSize: '11px', color: '#666', margin: 0 }}>{period?.label}</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {misEtiquetas.map(e => (
            <span key={e.id} title={e.descripcion}
              style={{ fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '10px', background: e.color, color: 'white', whiteSpace: 'nowrap' }}>
              {e.ic} {e.corto}
            </span>
          ))}
          <span style={{ fontSize: '12px' }}>{user.name}</span>
          <button onClick={logout} style={{ padding: '4px 10px', border: '1px solid #dde8dd', borderRadius: '6px', background: 'white', cursor: 'pointer', fontSize: '11px' }}>Salir</button>
        </div>
      </div>

      <div style={{ display: 'flex', background: 'white', borderBottom: '1px solid #dde8dd', overflowX: 'auto', alignItems: 'center' }}>
        {tabs.map(n => (
          <button key={n.id} onClick={() => setTab(n.id)}
            style={{ flex: '0 0 auto', padding: '0.7rem 0.9rem', border: 'none', borderBottom: tabActiva === n.id ? '2px solid #1565c0' : '2px solid transparent', background: 'none', cursor: 'pointer', color: tabActiva === n.id ? '#1565c0' : '#666', fontWeight: tabActiva === n.id ? 600 : 400, fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: '13px' }}>{n.ic}</span>
            {n.l}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', paddingRight: '0.75rem', flexShrink: 0 }}>
          <button onClick={() => setHacerPedidoFam(user)}
            style={{ padding: '5px 12px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 700, whiteSpace: 'nowrap' }}>
            🛒 Mi pedido
          </button>
        </div>
      </div>

      <div style={{ padding: '1rem' }} className="tab-panel" key={tabActiva}>
        {tabActiva === 'dashboard' && <AdminDashboard families={na} sealed={sealed} cargos={cargos} setTab={setTab} period={period} />}
        {tabActiva === 'analitica' && <AdminAnalytics families={families} products={products} />}
        {tabActiva === 'pedidos' && <AdminPedidos families={na} sealed={sealed} cargos={cargos} products={products} onHacerPedido={fam => setHacerPedidoFam(fam)} period={period} />}
        {tabActiva === 'consolidado' && <AdminConsolidado families={families} sealed={sealed} products={products} providers={providers} period={period} user={user} />}
        {tabActiva === 'retiros' && <AdminRetiros families={na} sealed={sealed} cargos={cargos} setSealed={setSealed} period={period} products={products} currentAdmin={user} />}
        {tabActiva === 'ajustes' && <AdminAjustes families={na} sealed={sealed} products={products} period={period} cargos={cargos} />}
        {tabActiva === 'flujo' && <AdminFlujoCaja period={period} cargos={cargos} recargarCargos={recargarCargos} families={families} setFamilies={setFamilies} sealed={sealed} currentAdmin={user} puedeEximir={puedeEximir} />}
        {tabActiva === 'bodega' && <AdminBodega period={period} families={na} setFamilies={setFamilies} products={products} currentAdmin={user} />}
        {tabActiva === 'familias' && <AdminFamilias families={families} setFamilies={setFamilies} sealed={sealed} onHacerPedido={fam => setHacerPedidoFam(fam)} currentAdmin={user} />}
        {tabActiva === 'proveedores' && <AdminProveedores providers={providers} setProviders={setProviders} products={products} setProducts={setProducts} />}
        {tabActiva === 'productos' && <AdminProductos products={products} setProducts={setProducts} providers={providers} />}
        {tabActiva === 'saldos' && <AdminSaldos families={na} sealed={sealed} cargos={cargos} setFamilies={setFamilies} updateFamilyBalance={updateFamilyBalance} />}
        {tabActiva === 'periodo' && <AdminPeriodo period={period} setPeriod={setPeriod} families={families} sealed={sealed} cargos={cargos} recargarCargos={recargarCargos} currentAdmin={user} />}
        {tabActiva === 'importar' && <AdminImportar products={products} setProducts={setProducts} providers={providers} currentAdmin={user} />}
        {tabActiva === 'reportes' && <AdminReportes families={families} products={products} providers={providers} currentAdmin={user} period={period} />}
        {tabActiva === 'actividad' && <AdminLogs />}
      </div>
    </div>
  );
}

function AdminSaldos({ families, sealed, cargos, setFamilies, updateFamilyBalance }) {
  const [editId, setEditId] = useState(null);
  const [editVal, setEditVal] = useState('');
  const [saving, setSaving] = useState(false);

  const pendientes = families.filter(f => f.balance < 0);
  const favor = families.filter(f => f.balance > 0);
  const alDia = families.filter(f => f.balance === 0);

  const saveBalance = async (fid) => {
    setSaving(true);
    const val = parseInt(editVal) || 0;
    await updateFamilyBalance(fid, val);
    setFamilies(p => p.map(f => f.id === fid ? { ...f, balance: val } : f));
    setEditId(null);
    setSaving(false);
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '1.5rem' }}>
        {[{ l: 'Saldo pendiente', v: pendientes.length, c: '#c62828', bg: '#ffebee' }, { l: 'Al día', v: alDia.length, c: '#888', bg: '#f5f5f5' }, { l: 'A favor', v: favor.length, c: '#2e7d32', bg: '#e8f5e9' }].map(m => (
          <div key={m.l} style={{ padding: '1rem', background: m.bg, borderRadius: '8px', textAlign: 'center' }}>
            <p style={{ fontSize: '10px', color: m.c, margin: 0, fontWeight: 600 }}>{m.l}</p>
            <p style={{ fontSize: '22px', fontWeight: 700, margin: '4px 0 0', color: m.c }}>{m.v}</p>
          </div>
        ))}
      </div>

      {families.map(f => {
        const ord = sealed[f.id];
        const totalPedido = ord ? ord.total + cargos.de(f.id) : 0;
        return (
          <div key={f.id} style={{ padding: '1rem', background: 'white', border: '1px solid #dde8dd', borderRadius: '8px', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#4CAF50', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700 }}>{f.initials}</div>
                <div>
                  <p style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>{f.name}</p>
                  {totalPedido > 0 && <p style={{ fontSize: '11px', color: '#888', margin: '2px 0 0' }}>Pedido: ${totalPedido.toLocaleString('es-CL')}</p>}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {editId === f.id ? (
                  <>
                    <input type="number" value={editVal} onChange={e => setEditVal(e.target.value)}
                      style={{ width: '100px', padding: '4px 8px', border: '1px solid #4CAF50', borderRadius: '6px', fontSize: '13px', textAlign: 'right' }} />
                    <button onClick={() => saveBalance(f.id)} disabled={saving} style={{ padding: '4px 10px', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}>{saving ? '...' : '✓'}</button>
                    <button onClick={() => setEditId(null)} style={{ padding: '4px 10px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '11px' }}>✕</button>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: f.balance > 0 ? '#2e7d32' : f.balance < 0 ? '#c62828' : '#888' }}>
                      {f.balance > 0 ? '+' : ''}${f.balance.toLocaleString('es-CL')}
                    </span>
                    <button onClick={() => { setEditId(f.id); setEditVal(f.balance.toString()); }}
                      style={{ padding: '3px 8px', background: 'white', border: '1px solid #dde8dd', borderRadius: '5px', cursor: 'pointer', fontSize: '10px', color: '#555' }}>Editar</button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default App;
