import React, { useState, useEffect, useMemo } from 'react';
import { getPurchaseOrders, sendPurchaseOrder, deletePurchaseOrder } from './supabaseClient';
import { ordenesVencidasSinConfirmar } from './calculos';

// ─── CONSOLIDADO Y ÓRDENES DE COMPRA ─────────────────────────────────────────
// Responde la pregunta que hasta ahora se hacía a mano: cuánto hay que comprarle
// a cada proveedor este período. Agrupa todos los pedidos sellados por proveedor
// y producto, y desde ahí dispara la orden de compra por correo.

const clp = n => '$' + Math.round(n || 0).toLocaleString('es-CL');

function parseItems(ord) {
  try { return Array.isArray(ord.items) ? ord.items : JSON.parse(ord.items); } catch { return []; }
}

export function AdminConsolidado({ families, sealed, products, providers, period }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [sendingId, setSendingId] = useState(null);
  const [msg, setMsg] = useState(null); // { tipo:'ok'|'err', texto }
  const [estado, setEstado] = useState(null); // config del envío, desde /api/estado

  useEffect(() => {
    if (!period) { setLoading(false); return; }
    let cancelled = false;
    getPurchaseOrders(period.id).then(data => {
      if (!cancelled) { setOrders(data); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [period]);

  // Saber si estamos en modo prueba ANTES de enviar evita el accidente de
  // dispararle un correo real a un proveedor creyendo que era un ensayo.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/estado')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setEstado(d); })
      .catch(() => { /* sin funciones serverless (npm start): se ignora */ });
    return () => { cancelled = true; };
  }, []);

  // Agrupa los pedidos sellados por proveedor → producto.
  const grupos = useMemo(() => {
    const byProvider = new Map();

    Object.entries(sealed).forEach(([famId, ord]) => {
      parseItems(ord).forEach(item => {
        if (!item || !(item.qty > 0)) return;

        // El producto se resuelve por id contra el maestro (más fiable que el
        // texto congelado dentro del pedido). Si ya no existe, se cae al texto.
        const prod = products.find(p => p.id === item.id);
        const pv = prod && prod.provider_id
          ? providers.find(p => p.id === prod.provider_id)
          : providers.find(p => p.name.toLowerCase() === String(item.pv || '').trim().toLowerCase());

        const key = pv ? pv.id : '__sin_proveedor__';
        if (!byProvider.has(key)) {
          byProvider.set(key, { provider: pv || null, lines: new Map(), total: 0, families: new Set() });
        }
        const g = byProvider.get(key);
        g.families.add(famId);

        const pid = item.id;
        if (!g.lines.has(pid)) {
          g.lines.set(pid, {
            product_id: pid,
            name: (prod && prod.name) || item.n || 'Producto desconocido',
            unit: (prod && prod.unit) || item.u || '',
            price: prod ? prod.price : (item.p || 0),
            qty: 0,
            subtotal: 0,
            porFamilia: [],
          });
        }
        const line = g.lines.get(pid);
        line.qty += item.qty;
        line.subtotal = Math.round(line.qty * line.price);
        const fam = families.find(f => f.id === famId);
        line.porFamilia.push({ name: (fam && fam.name) || famId, qty: item.qty });
      });
    });

    return Array.from(byProvider.values())
      .map(g => {
        const lines = Array.from(g.lines.values()).sort((a, b) => a.name.localeCompare(b.name));
        return { ...g, lines, total: lines.reduce((s, l) => s + l.subtotal, 0), familiesCount: g.families.size };
      })
      .sort((a, b) => b.total - a.total);
  }, [sealed, products, providers, families]);

  const ordenDe = (providerId) => orders.find(o => o.provider_id === providerId) || null;

  // Órdenes cuyo plazo venció sin respuesta. No generan ajustes: la cooperativa
  // decidió asumir que quien no contesta sí trae todo.
  const vencidas = useMemo(() => ordenesVencidasSinConfirmar(orders, period), [orders, period]);

  // Familias que todavía no sellan. Enviar la orden sin ellas significa comprarle
  // de menos al proveedor, y eso solo se descubre el día del retiro.
  const sinSellar = useMemo(
    () => (families || []).filter(f => !sealed[f.id]),
    [families, sealed]
  );

  const totalGeneral = grupos.reduce((s, g) => s + g.total, 0);
  const enviadas = orders.filter(o => o.sent_at).length;
  const confirmadas = orders.filter(o => o.status === 'confirmada').length;

  const handleSend = async (g) => {
    const pv = g.provider;
    if (!pv) return;

    // Enviar la orden con familias sin sellar significa comprarle de menos al
    // proveedor, y eso solo se descubre el día del retiro, cuando ya no hay
    // arreglo posible. Vale la pena el segundo de fricción.
    if (sinSellar.length > 0) {
      const nombres = sinSellar.map(f => '· ' + f.name).join('\n');
      const aviso = 'Todavía hay ' + sinSellar.length + ' familia' +
        (sinSellar.length === 1 ? '' : 's') + ' sin sellar su pedido:\n\n' + nombres +
        '\n\nLo que no esté sellado no entra en esta orden de compra. ¿Enviarla igual?';
      if (!window.confirm(aviso)) return;
    }

    const previa = ordenDe(pv.id);
    if (previa) {
      const txt = previa.status === 'confirmada'
        ? `${pv.name} ya confirmó su orden.\n\nSi vuelves a enviarla, se creará una orden nueva y el enlace anterior dejará de servir. La confirmación que ya dio se perderá.\n\n¿Continuar?`
        : `Ya se le envió una orden a ${pv.name}.\n\nSi envías otra, el enlace anterior dejará de funcionar.\n\n¿Continuar?`;
      if (!window.confirm(txt)) return;
    }

    setSendingId(pv.id);
    setMsg(null);

    // Solo se mandan los dos identificadores: el servidor reconstruye el
    // consolidado leyendo los pedidos sellados. Lo que se ve en esta pantalla es
    // una previsualización; la orden que sale la arma la base, no el navegador.
    const res = await sendPurchaseOrder({ periodId: period.id, providerId: pv.id });

    if (res.error) {
      setMsg({ tipo: 'err', texto: res.error });
      // Si el envío falló pero la orden quedó guardada, recargamos para que el
      // admin vea el error registrado y pueda reintentar.
      if (res.guardada) getPurchaseOrders(period.id).then(setOrders);
    } else {
      if (previa) await deletePurchaseOrder(previa.id);
      const data = await getPurchaseOrders(period.id);
      setOrders(data);
      setMsg({
        tipo: 'ok',
        texto: res.esPrueba
          ? `Orden de ${pv.name} enviada en MODO PRUEBA a ${res.enviadoA} (no al proveedor real).`
          : `Orden de ${pv.name} enviada a ${res.enviadoA}.`,
      });
    }
    setSendingId(null);
  };

  if (!period) {
    return (
      <div style={{ background: '#fff8e1', border: '1px solid #ffc107', borderRadius: '10px', padding: '1.25rem' }}>
        <p style={{ fontSize: '13px', color: '#e65100', margin: 0 }}>No hay período activo. Crea uno desde la pestaña <strong>Período</strong>.</p>
      </div>
    );
  }

  if (grupos.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem', background: 'white', borderRadius: '10px', border: '1px solid #dde8dd' }}>
        <p style={{ fontSize: '40px', margin: 0 }}>📋</p>
        <p style={{ color: '#555', fontWeight: 500, margin: '1rem 0 4px' }}>Todavía no hay pedidos sellados</p>
        <p style={{ color: '#999', fontSize: '12px', margin: 0 }}>El consolidado se arma solo a medida que las familias sellan.</p>
      </div>
    );
  }

  const estadoChip = (o) => {
    if (!o) return null;
    if (o.send_error) return { bg: '#ffebee', color: '#c62828', txt: '⚠ Error de envío' };
    if (o.status === 'confirmada') return { bg: '#e8f5e9', color: '#2e7d32', txt: '✓ Confirmada' };
    if (o.sent_at) return { bg: '#e3f2fd', color: '#1565c0', txt: '📤 Enviada, esperando' };
    return { bg: '#f5f5f5', color: '#888', txt: 'Sin enviar' };
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '1.25rem' }}>
        {[
          { l: 'Proveedores', v: grupos.length, c: '#1565c0', bg: '#e3f2fd' },
          { l: 'Órdenes enviadas', v: `${enviadas}/${grupos.length}`, c: '#e65100', bg: '#fff3e0' },
          { l: 'Confirmadas', v: `${confirmadas}/${enviadas}`, c: '#2e7d32', bg: '#e8f5e9' },
          { l: 'Total a comprar', v: clp(totalGeneral), c: '#2d5a2d', bg: '#f0f7f0' },
        ].map(m => (
          <div key={m.l} style={{ padding: '0.9rem', background: m.bg, borderRadius: '8px', textAlign: 'center' }}>
            <p style={{ fontSize: '10px', color: m.c, margin: 0, fontWeight: 600 }}>{m.l}</p>
            <p style={{ fontSize: '17px', fontWeight: 700, margin: '4px 0 0', color: m.c }}>{m.v}</p>
          </div>
        ))}
      </div>

      {estado && estado.modoPrueba && (
        <div style={{ background: '#fff8e1', border: '2px dashed #ffb300', borderRadius: '8px', padding: '11px 14px', marginBottom: '1rem' }}>
          <p style={{ fontSize: '12px', color: '#e65100', fontWeight: 700, margin: 0 }}>⚠ Modo prueba activo</p>
          <p style={{ fontSize: '11px', color: '#795548', margin: '4px 0 0', lineHeight: 1.5 }}>
            Las órdenes NO llegan a los proveedores: todas se desvían a <strong>{estado.destinoPruebas}</strong>.
            Para enviar de verdad, borra la variable <code>CORREO_PRUEBAS</code> en Vercel y vuelve a desplegar.
          </p>
        </div>
      )}

      {estado && !estado.modoPrueba && (
        <div style={{ background: '#ffebee', border: '1px solid #ef9a9a', borderRadius: '8px', padding: '11px 14px', marginBottom: '1rem' }}>
          <p style={{ fontSize: '12px', color: '#c62828', fontWeight: 700, margin: 0 }}>📮 Envío real activo</p>
          <p style={{ fontSize: '11px', color: '#666', margin: '4px 0 0', lineHeight: 1.5 }}>
            Las órdenes se enviarán directamente al correo de cada proveedor, desde {estado.remitente}.
          </p>
        </div>
      )}

      {estado && !estado.brevoConfigurado && (
        <div style={{ background: '#ffebee', border: '1px solid #ef9a9a', borderRadius: '8px', padding: '11px 14px', marginBottom: '1rem' }}>
          <p style={{ fontSize: '12px', color: '#c62828', fontWeight: 700, margin: 0 }}>⚠ Brevo no está configurado</p>
          <p style={{ fontSize: '11px', color: '#666', margin: '4px 0 0', lineHeight: 1.5 }}>
            Falta la variable <code>BREVO_API_KEY</code> en Vercel. El consolidado se puede consultar, pero ningún correo va a salir.
          </p>
        </div>
      )}

      {/* El plazo y, sobre todo, lo que pasa cuando vence. La cooperativa decidió
          asumir que un proveedor que no contesta SÍ trae todo — un supuesto sobre
          dinero que nadie ve escrito es el que después nadie recuerda haber tomado. */}
      {period.date_confirm_until && (() => {
        const limite = new Date(period.date_confirm_until + 'T23:59:59');
        const vencido = new Date() > limite;
        const txt = limite.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
        const mudas = vencidas.length;
        return (
          <div style={{ background: vencido && mudas ? '#fff3e0' : '#f1f8f1', border: `1px solid ${vencido && mudas ? '#ffb300' : '#a5d6a7'}`, borderRadius: '8px', padding: '11px 14px', marginBottom: '1rem' }}>
            <p style={{ fontSize: '12px', fontWeight: 700, color: vencido && mudas ? '#e65100' : '#2e7d32', margin: 0 }}>
              📅 Plazo de confirmación: {txt}
            </p>
            <p style={{ fontSize: '11px', color: '#666', margin: '5px 0 0', lineHeight: 1.55 }}>
              {!vencido
                ? <>Los proveedores lo ven en su correo y en la página de confirmación. Si no responden a tiempo, <strong>se asume que traen el pedido completo</strong> y se cobra así a las familias.</>
                : mudas === 0
                  ? <>El plazo venció y <strong>todos los proveedores respondieron</strong>.</>
                  : <><strong>{mudas} proveedor{mudas === 1 ? '' : 'es'} no respondió</strong> ({vencidas.map(o => o.provider_name).join(', ')}). Se asume que traen el pedido completo y se cobrará así. <strong>Insistirles por otro medio es tarea de la comisión</strong> — el sistema no lo hace solo.</>}
            </p>
          </div>
        );
      })()}

      {sinSellar.length > 0 && (
        <div style={{ background: '#fff3e0', border: '1px solid #ffb300', borderRadius: '8px', padding: '11px 14px', marginBottom: '1rem' }}>
          <p style={{ fontSize: '12px', fontWeight: 700, color: '#e65100', margin: 0 }}>
            ⏳ {sinSellar.length} familia{sinSellar.length === 1 ? '' : 's'} pendiente{sinSellar.length === 1 ? '' : 's'} por sellar
          </p>
          <p style={{ fontSize: '11px', color: '#666', margin: '5px 0 0', lineHeight: 1.55 }}>
            Lo que no esté sellado <strong>no entra en la orden de compra</strong>. Si envías ahora, a esas familias no se les comprará nada y solo se notará el día del retiro.
          </p>
          <p style={{ fontSize: '11px', color: '#8d6e63', margin: '5px 0 0' }}>
            {sinSellar.map(f => f.name).join(' · ')}
          </p>
        </div>
      )}

      {msg && (
        <div style={{ background: msg.tipo === 'ok' ? '#e8f5e9' : '#ffebee', border: `1px solid ${msg.tipo === 'ok' ? '#81c784' : '#ef9a9a'}`, borderRadius: '8px', padding: '11px 14px', marginBottom: '1rem', display: 'flex', alignItems: 'flex-start', gap: '9px' }}>
          <span style={{ flexShrink: 0 }}>{msg.tipo === 'ok' ? '✓' : '⚠'}</span>
          <p style={{ fontSize: '13px', color: msg.tipo === 'ok' ? '#2e7d32' : '#c62828', margin: 0, fontWeight: 500, lineHeight: 1.5 }}>{msg.texto}</p>
          <button onClick={() => setMsg(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: '14px', flexShrink: 0 }}>✕</button>
        </div>
      )}

      {loading && <p style={{ color: '#888', fontSize: '13px' }}>Cargando órdenes...</p>}

      {grupos.map((g, gi) => {
        const pv = g.provider;
        const key = pv ? pv.id : '__sin__';
        const o = pv ? ordenDe(pv.id) : null;
        const chip = estadoChip(o);
        const isExp = expanded === key;
        const sinCorreo = pv && !pv.email;

        return (
          <div key={key} style={{ background: 'white', border: `1px solid ${pv ? '#dde8dd' : '#ffcdd2'}`, borderRadius: '10px', marginBottom: '10px', overflow: 'hidden' }}>
            <div onClick={() => setExpanded(isExp ? null : key)}
              style={{ padding: '1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <p style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: pv ? '#333' : '#c62828' }}>
                    {pv ? pv.name : '⚠ Sin proveedor asignado'}
                  </p>
                  {pv && pv.is_member && <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 7px', borderRadius: '10px', background: '#f3e5f5', color: '#6a1b9a' }}>SOCIA</span>}
                  {chip && <span style={{ fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '10px', background: chip.bg, color: chip.color }}>{chip.txt}</span>}
                </div>
                <p style={{ fontSize: '11px', color: '#888', margin: '4px 0 0' }}>
                  {g.lines.length} producto{g.lines.length === 1 ? '' : 's'} · {g.familiesCount} familia{g.familiesCount === 1 ? '' : 's'}
                  {sinCorreo && <span style={{ color: '#c62828', fontWeight: 600 }}> · sin correo cargado</span>}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                <span style={{ fontSize: '16px', fontWeight: 700, color: '#2d5a2d', whiteSpace: 'nowrap' }}>{clp(g.total)}</span>
                <span style={{ fontSize: '12px', color: '#888' }}>{isExp ? '▲' : '▼'}</span>
              </div>
            </div>

            {isExp && (
              <div style={{ borderTop: '1px solid #f0f7f0', padding: '0.9rem 1rem', background: '#fafffe' }}>
                {!pv && (
                  <div style={{ background: '#ffebee', border: '1px solid #ef9a9a', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px' }}>
                    <p style={{ fontSize: '12px', color: '#c62828', margin: 0, fontWeight: 600 }}>Estos productos no tienen proveedor reconocido</p>
                    <p style={{ fontSize: '11px', color: '#666', margin: '4px 0 0' }}>
                      Probablemente se pidieron antes de crear la tabla de proveedores, o el producto se eliminó del maestro. Asígnales proveedor en la pestaña Productos para poder enviarles orden.
                    </p>
                  </div>
                )}

                {g.lines.map(l => (
                  <div key={l.product_id} style={{ padding: '7px 0', borderBottom: '1px solid #f0f7f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: '13px', fontWeight: 600, margin: 0, color: '#333' }}>{l.name}</p>
                        <p style={{ fontSize: '11px', color: '#999', margin: '2px 0 0' }}>
                          {l.unit} · {clp(l.price)} c/u · {l.porFamilia.map(f => `${f.name} (${f.qty})`).join(', ')}
                        </p>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <p style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: '#1565c0' }}>×{l.qty}</p>
                        <p style={{ fontSize: '12px', fontWeight: 600, margin: '1px 0 0', color: '#2d5a2d' }}>{clp(l.subtotal)}</p>
                      </div>
                    </div>
                  </div>
                ))}

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 0 0', fontSize: '14px', fontWeight: 700, color: '#2d5a2d' }}>
                  <span>Total a comprar</span><span>{clp(g.total)}</span>
                </div>

                {o && o.send_error && (
                  <div style={{ background: '#ffebee', border: '1px solid #ef9a9a', borderRadius: '8px', padding: '10px 12px', margin: '12px 0 0' }}>
                    <p style={{ fontSize: '11px', color: '#c62828', margin: 0, fontWeight: 600 }}>El correo no salió</p>
                    <p style={{ fontSize: '11px', color: '#666', margin: '3px 0 0', lineHeight: 1.5 }}>{o.send_error}</p>
                  </div>
                )}

                {o && o.status === 'confirmada' && (
                  <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: '8px', padding: '11px 13px', margin: '12px 0 0' }}>
                    <p style={{ fontSize: '12px', fontWeight: 700, color: '#2e7d32', margin: '0 0 7px' }}>
                      Respuesta del proveedor · {new Date(o.confirmed_at).toLocaleString('es-CL')}
                    </p>
                    {(o.lines || []).map((l, i) => {
                      const falta = l.available === false || (l.confirmed_qty != null && l.confirmed_qty < l.qty);
                      return (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '3px 0', fontSize: '12px' }}>
                          <span style={{ color: '#444' }}>{l.name} <span style={{ color: '#aaa' }}>×{l.qty}</span></span>
                          <span style={{ fontWeight: 600, color: falta ? '#c62828' : '#2e7d32', whiteSpace: 'nowrap' }}>
                            {l.available === false ? 'No tiene' : l.confirmed_qty != null && l.confirmed_qty < l.qty ? `Solo ${l.confirmed_qty}` : 'Completo'}
                          </span>
                        </div>
                      );
                    })}
                    {o.provider_note && (
                      <p style={{ fontSize: '12px', color: '#555', margin: '9px 0 0', paddingTop: '8px', borderTop: '1px solid #c8e6c9' }}>
                        <strong>Nota:</strong> {o.provider_note}
                      </p>
                    )}
                  </div>
                )}

                {o && o.sent_at && (
                  <p style={{ fontSize: '11px', color: '#999', margin: '10px 0 0' }}>
                    Enviada el {new Date(o.sent_at).toLocaleString('es-CL')} a {o.sent_to}
                    {o.is_test && <span style={{ color: '#e65100', fontWeight: 600 }}> · modo prueba</span>}
                  </p>
                )}

                {pv && (
                  <button onClick={() => handleSend(g)} disabled={sendingId === pv.id || sinCorreo}
                    title={sinCorreo ? 'Carga el correo del proveedor en la pestaña Proveedores' : ''}
                    style={{ width: '100%', marginTop: '13px', padding: '11px', background: sinCorreo ? '#eee' : o && o.sent_at ? '#fff8e1' : '#4CAF50', color: sinCorreo ? '#aaa' : o && o.sent_at ? '#e65100' : 'white', border: sinCorreo ? '1px solid #ddd' : o && o.sent_at ? '1px solid #ffc107' : 'none', borderRadius: '8px', cursor: sinCorreo ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '13px' }}>
                    {sendingId === pv.id ? 'Enviando...'
                      : sinCorreo ? 'Sin correo — no se puede enviar'
                      : o && o.sent_at ? '↻ Volver a enviar orden de compra'
                      : '📧 Enviar orden de compra'}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
