import React, { useState, useMemo } from 'react';
import {
  addPeriodCharge, updatePeriodCharge, deletePeriodCharge,
  addChargeExemption, deleteChargeExemption, addAdminLog,
} from './supabaseClient';
import { clp, cuentaDeFamilia, ajustesPorFamilia } from './calculos';
import { rolesDe } from './perfiles';

// ─── CARGOS FIJOS DEL PERÍODO ────────────────────────────────────────────────
//
// Antes era un número: $4.000 para todas, sin nombre. Dos cosas no cabían ahí.
//
// La primera es que la cooperativa cobra varias cosas distintas —cuota
// administrativa, fondo de bodega, aporte a capacitación— y un total de $5.500
// sin desglose es la pregunta que la comisión recibe en la puerta de la bodega y
// no puede contestar.
//
// La segunda es eximir a una familia. Hoy la única forma era descontárselo a
// mano del saldo, y eso no deja escrito POR QUÉ: exactamente el problema que la
// migración 004 resolvió para los faltantes. Eximir es mover plata de la
// cooperativa y la decisión la toma una persona, así que el motivo es
// obligatorio y queda firmado con quién lo concedió.

export function AdminCargos({ period, cargos, recargar, families = [], currentAdmin, puedeEximir = true }) {
  const [form, setForm] = useState(null);      // { id?, name, amount, note }
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState('');
  const [exForm, setExForm] = useState(null);  // { chargeId, familyId, reason }
  const [abierto, setAbierto] = useState(null);

  // Las exenciones se conceden a socias que piden, no a proveedores ni a
  // entidades: la lista es la misma que ve el cierre de período.
  const fams = useMemo(
    () => families.filter(f => rolesDe(f).includes('familia')).sort((a, b) => a.name.localeCompare(b.name)),
    [families]
  );

  if (cargos.faltaMigracion) {
    return (
      <div style={{ background: '#fff8e1', border: '1px solid #ffc107', borderRadius: '10px', padding: '1.1rem', marginBottom: '1rem' }}>
        <p style={{ fontSize: '13px', fontWeight: 700, color: '#e65100', margin: '0 0 6px' }}>
          Cargo fijo: {clp(cargos.total)} — sin desglose todavía
        </p>
        <p style={{ fontSize: '12px', color: '#666', margin: 0, lineHeight: 1.6 }}>
          Para poder cobrar varios cargos con nombre propio y eximir familias, ejecuta{' '}
          <code>db/migrations/007_cargos_multiples_y_exenciones.sql</code> en Supabase
          (SQL Editor → Run) y vuelve a entrar. Mientras tanto se sigue cobrando el cargo único
          que ya estaba, sin perder nada.
        </p>
      </div>
    );
  }

  const guardar = async () => {
    if (!form.name.trim()) { setErr('El cargo necesita un nombre'); return; }
    const monto = parseInt(form.amount, 10);
    if (isNaN(monto) || monto < 0) { setErr('El monto debe ser un número mayor o igual a cero'); return; }

    setGuardando(true); setErr('');
    const datos = { name: form.name.trim(), amount: monto, note: form.note.trim() || null };
    const res = form.id
      ? await updatePeriodCharge(form.id, datos)
      : await addPeriodCharge({ ...datos, period_id: period.id, sort: cargos.lista.length,
          created_by: currentAdmin?.id || null, created_by_name: currentAdmin?.name || null });

    if (res && res.error) { setErr(res.error); setGuardando(false); return; }
    if (currentAdmin) {
      addAdminLog({
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        admin_id: currentAdmin.id, admin_name: currentAdmin.name,
        action: form.id ? 'cargo_editado' : 'cargo_creado',
        details: datos.name + ' — ' + clp(datos.amount) + ' en ' + period.label,
      });
    }
    await recargar();
    setForm(null); setGuardando(false);
  };

  const borrar = async (c) => {
    const nExentas = cargos.exentasDe(c.id);
    if (!window.confirm(
      '¿Eliminar el cargo "' + c.name + '" de ' + clp(c.amount) + '?\n\n' +
      'Dejará de cobrarse a todas las familias de ' + period.label +
      (nExentas ? '\nSe eliminan también las ' + nExentas + ' exenciones que tenía.' : '') +
      '\n\nLos períodos cerrados conservan sus propios cargos y no cambian.'
    )) return;

    const res = await deletePeriodCharge(c.id);
    if (res && res.error) { setErr(res.error); return; }
    if (currentAdmin) {
      addAdminLog({
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        admin_id: currentAdmin.id, admin_name: currentAdmin.name,
        action: 'cargo_eliminado',
        details: c.name + ' — ' + clp(c.amount) + ' en ' + period.label,
      });
    }
    await recargar();
  };

  const eximir = async () => {
    if (!exForm.familyId) { setErr('Elige la familia'); return; }
    if (!exForm.reason.trim()) { setErr('El motivo es obligatorio: eximir es mover plata y tiene que quedar escrito por qué'); return; }

    setGuardando(true); setErr('');
    const fam = fams.find(f => f.id === exForm.familyId);
    const cargo = cargos.lista.find(c => c.id === exForm.chargeId);
    const res = await addChargeExemption({
      period_id: period.id,
      charge_id: exForm.chargeId,
      family_id: exForm.familyId,
      reason: exForm.reason.trim(),
      granted_by: currentAdmin?.id || null,
      granted_by_name: currentAdmin?.name || null,
    });
    if (res && res.error) { setErr(res.error); setGuardando(false); return; }
    if (currentAdmin) {
      addAdminLog({
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        admin_id: currentAdmin.id, admin_name: currentAdmin.name,
        action: 'exencion_concedida',
        details: (fam?.name || exForm.familyId) + ' eximida de ' + (cargo?.name || '') +
                 ' (' + clp(cargo?.amount || 0) + ') en ' + period.label + ': ' + exForm.reason.trim(),
      });
    }
    await recargar();
    setExForm(null); setGuardando(false);
  };

  const quitarExencion = async (ex, cargo) => {
    const fam = fams.find(f => f.id === ex.family_id);
    if (!window.confirm(
      '¿Quitar la exención de ' + (fam?.name || ex.family_id) + ' sobre "' + cargo.name + '"?\n\n' +
      'Volverá a pagar ' + clp(cargo.amount) + ' en ' + period.label + '.'
    )) return;
    const res = await deleteChargeExemption(ex.id);
    if (res && res.error) { setErr(res.error); return; }
    if (currentAdmin) {
      addAdminLog({
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        admin_id: currentAdmin.id, admin_name: currentAdmin.name,
        action: 'exencion_quitada',
        details: (fam?.name || ex.family_id) + ' vuelve a pagar ' + cargo.name + ' en ' + period.label,
      });
    }
    await recargar();
  };

  const exencionesDe = (chargeId) => cargos.exenciones.filter(e => e.charge_id === chargeId);

  return (
    <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #dde8dd', padding: '1rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <div>
          <p style={{ fontSize: '11px', color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
            Cargos fijos de {period.label}
          </p>
          <p style={{ fontSize: '22px', fontWeight: 700, margin: '4px 0 0', color: '#1565c0' }}>
            {clp(cargos.total)}
            <span style={{ fontSize: '11px', fontWeight: 400, color: '#aaa' }}> · por familia sin exenciones</span>
          </p>
        </div>
        {!form && (
          <button onClick={() => { setForm({ name: '', amount: '', note: '' }); setErr(''); }}
            style={{ padding: '6px 14px', background: '#1565c0', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
            + Agregar cargo
          </button>
        )}
      </div>

      {err && !form && !exForm && <p style={{ fontSize: '12px', color: '#c62828', margin: '0 0 8px', fontWeight: 500 }}>{err}</p>}

      {cargos.descalzado && (
        <div style={{ background: '#fff8e1', border: '1px solid #ffc107', borderRadius: '8px', padding: '10px 13px', marginBottom: '10px' }}>
          <p style={{ fontSize: '11px', color: '#e65100', margin: 0, lineHeight: 1.6 }}>
            ⚠ El período tiene guardado un total de <strong>{clp(cargos.descalzado.columna)}</strong> pero los
            cargos de acá suman <strong>{clp(cargos.descalzado.cargos)}</strong>. Suele pasar cuando se creó el
            período y la copia de cargos no alcanzó a completarse. <strong>Se cobra lo de acá</strong>: revisa que
            estén todos antes de cerrar el período.
          </p>
        </div>
      )}

      {cargos.lista.length === 0 && !form && (
        <p style={{ fontSize: '12px', color: '#999', margin: '0 0 8px', lineHeight: 1.6 }}>
          Este período no cobra ningún cargo fijo. Las familias pagan solo sus productos.
        </p>
      )}

      {cargos.lista.map(c => {
        const exs = exencionesDe(c.id);
        const exp = abierto === c.id;
        return (
          <div key={c.id} style={{ border: '1px solid #eef3ee', borderRadius: '8px', marginBottom: '7px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '9px 11px', background: '#fafffe', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '150px' }}>
                <p style={{ fontSize: '13px', fontWeight: 600, margin: 0, color: '#333' }}>{c.name}</p>
                {c.note && <p style={{ fontSize: '10px', color: '#999', margin: '2px 0 0' }}>{c.note}</p>}
              </div>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#1565c0', whiteSpace: 'nowrap' }}>{clp(c.amount)}</span>
              <button onClick={() => setAbierto(exp ? null : c.id)}
                style={{ fontSize: '10px', padding: '3px 9px', borderRadius: '10px', cursor: 'pointer', fontWeight: 600,
                         border: '1px solid ' + (exs.length ? '#81c784' : '#e0e0e0'),
                         background: exs.length ? '#e8f5e9' : 'white', color: exs.length ? '#2e7d32' : '#999' }}>
                {exs.length ? exs.length + ' exenta' + (exs.length === 1 ? '' : 's') : 'sin exenciones'} {exp ? '▲' : '▼'}
              </button>
              <button onClick={() => { setForm({ id: c.id, name: c.name, amount: String(c.amount), note: c.note || '' }); setErr(''); }}
                style={{ fontSize: '10px', padding: '3px 9px', background: 'white', border: '1px solid #dde8dd', borderRadius: '5px', cursor: 'pointer', color: '#555' }}>
                Editar
              </button>
              <button onClick={() => borrar(c)}
                style={{ width: '22px', height: '22px', border: '1px solid #ffcdd2', background: '#fff5f5', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', color: '#c62828' }}>✕</button>
            </div>

            {exp && (
              <div style={{ borderTop: '1px solid #eef3ee', padding: '9px 11px' }}>
                {exs.length === 0 && (
                  <p style={{ fontSize: '11px', color: '#aaa', margin: '0 0 8px' }}>Todas las familias pagan este cargo.</p>
                )}
                {exs.map(ex => {
                  const fam = fams.find(f => f.id === ex.family_id);
                  return (
                    <div key={ex.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 9px', background: '#e8f5e9', borderRadius: '6px', marginBottom: '5px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '11px' }}>🕊</span>
                      <div style={{ flex: 1, minWidth: '140px' }}>
                        <p style={{ fontSize: '12px', fontWeight: 600, margin: 0, color: '#2e7d32' }}>{fam?.name || ex.family_id}</p>
                        <p style={{ fontSize: '10px', color: '#666', margin: '2px 0 0' }}>
                          {ex.reason}
                          {ex.granted_by_name && <span style={{ color: '#aaa' }}> · lo concedió {ex.granted_by_name}</span>}
                        </p>
                      </div>
                      {puedeEximir && (
                        <button onClick={() => quitarExencion(ex, c)}
                          style={{ fontSize: '10px', padding: '3px 8px', background: 'white', border: '1px solid #c8e6c9', borderRadius: '5px', cursor: 'pointer', color: '#555' }}>
                          Quitar
                        </button>
                      )}
                    </div>
                  );
                })}

                {!puedeEximir ? (
                  <p style={{ fontSize: '11px', color: '#999', margin: 0 }}>
                    Eximir a una familia lo decide Administración o Balance Contable.
                  </p>
                ) : exForm && exForm.chargeId === c.id ? (
                  <div style={{ background: 'white', border: '1px solid #90caf9', borderRadius: '7px', padding: '10px', marginTop: '6px' }}>
                    <select value={exForm.familyId} onChange={e => { setExForm(p => ({ ...p, familyId: e.target.value })); setErr(''); }}
                      style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '12px', marginBottom: '7px', boxSizing: 'border-box' }}>
                      <option value="">— Familia a eximir —</option>
                      {fams.filter(f => !exs.some(e => e.family_id === f.id)).map(f => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                    <input type="text" placeholder="Motivo (obligatorio): acuerdo de asamblea, situación de la familia..."
                      value={exForm.reason} onChange={e => { setExForm(p => ({ ...p, reason: e.target.value })); setErr(''); }}
                      style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '12px', marginBottom: '7px', boxSizing: 'border-box' }} />
                    {err && <p style={{ fontSize: '11px', color: '#c62828', margin: '0 0 7px', fontWeight: 500 }}>{err}</p>}
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={eximir} disabled={guardando}
                        style={{ flex: 1, padding: '7px', background: '#2e7d32', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '12px' }}>
                        {guardando ? 'Guardando...' : 'Eximir de ' + clp(c.amount)}
                      </button>
                      <button onClick={() => { setExForm(null); setErr(''); }}
                        style={{ padding: '7px 13px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setExForm({ chargeId: c.id, familyId: '', reason: '' }); setErr(''); }}
                    style={{ fontSize: '11px', padding: '6px 11px', background: '#e8f5e9', color: '#2e7d32', border: '1px solid #a5d6a7', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>
                    🕊 Eximir una familia de este cargo
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {form && (
        <div style={{ background: '#f8fbff', border: '1px solid #90caf9', borderRadius: '8px', padding: '11px', marginTop: '8px' }}>
          <p style={{ fontSize: '12px', fontWeight: 700, color: '#1565c0', margin: '0 0 8px' }}>
            {form.id ? 'Editar cargo' : 'Nuevo cargo fijo'}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px', marginBottom: '8px' }}>
            <input type="text" placeholder="Nombre: cuota administrativa, fondo de bodega..." value={form.name}
              onChange={e => { setForm(p => ({ ...p, name: e.target.value })); setErr(''); }} autoFocus
              style={{ padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '12px', boxSizing: 'border-box' }} />
            <input type="number" placeholder="Monto CLP" value={form.amount}
              onChange={e => { setForm(p => ({ ...p, amount: e.target.value })); setErr(''); }}
              style={{ padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '12px', fontWeight: 600, textAlign: 'right', boxSizing: 'border-box' }} />
          </div>
          <input type="text" placeholder="Para qué es (opcional, lo ve la familia junto al monto)" value={form.note}
            onChange={e => setForm(p => ({ ...p, note: e.target.value }))}
            style={{ width: '100%', padding: '7px', border: '1px solid #dde8dd', borderRadius: '6px', fontSize: '12px', marginBottom: '8px', boxSizing: 'border-box' }} />
          {err && <p style={{ fontSize: '11px', color: '#c62828', margin: '0 0 8px', fontWeight: 500 }}>{err}</p>}
          <div style={{ display: 'flex', gap: '7px' }}>
            <button onClick={guardar} disabled={guardando}
              style={{ flex: 1, padding: '8px', background: '#1565c0', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '12px' }}>
              {guardando ? 'Guardando...' : form.id ? 'Guardar cambios' : 'Agregar cargo'}
            </button>
            <button onClick={() => { setForm(null); setErr(''); }}
              style={{ padding: '8px 14px', background: 'white', border: '1px solid #dde8dd', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Cancelar</button>
          </div>
        </div>
      )}

      <p style={{ fontSize: '10px', color: '#bbb', margin: '9px 0 0', lineHeight: 1.6 }}>
        Los cargos son de <strong>este</strong> período. Al crear el siguiente se copian con sus montos
        (las exenciones no: volver a eximir a una familia es una decisión nueva cada ciclo).
        Un período cerrado conserva para siempre los cargos que tuvo.
      </p>
    </div>
  );
}

// ─── LO QUE EL PERÍODO IMPLICA vs. LO QUE SE REGISTRÓ ────────────────────────
//
// El flujo de caja solo mostraba los movimientos que alguien tipeó a mano. Los
// cargos fijos, los pedidos y los ajustes no aparecían en ninguna parte: se
// marcaba un retiro con cargos incluidos y el flujo seguía en cero.
//
// Esto no inventa movimientos. Muestra las dos cifras separadas —lo que el
// período DEBERÍA recaudar según los pedidos, y lo que efectivamente está
// registrado como ingreso— y la diferencia entre ambas, que es lo que queda por
// cobrar. Mezclarlas en un solo número sería justamente lo que impide cuadrar
// contra los comprobantes de transferencia.
//
// Todo se deriva de tablas que ya existen: cero costo, cero columnas nuevas.
// Cada fila dice de dónde sale, porque una cifra sin procedencia es una cifra
// que nadie puede defender en una asamblea.

export function ResumenDelPeriodo({ period, families = [], sealed = {}, ajustes = [], cargos, entries = [], sinCashFlow = false }) {
  const [abierto, setAbierto] = useState(false);

  const datos = useMemo(() => {
    const porFam = ajustesPorFamilia(ajustes);
    const conPedido = families.filter(f => rolesDe(f).includes('familia') && sealed[f.id]);

    let productos = 0, cargosTotal = 0, noConf = 0, falt = 0, extras = 0, delPeriodo = 0;
    const porCargo = new Map(cargos.lista.map(c => [c.id, { ...c, familias: 0, monto: 0, exentas: 0 }]));

    conPedido.forEach(f => {
      const cuenta = cuentaDeFamilia({
        ord: sealed[f.id], ajustes: porFam.get(f.id) || [],
        cargo: cargos.de(f.id), saldo: 0,   // el saldo se muestra aparte
      });
      productos += cuenta.subtotal;
      cargosTotal += cuenta.cargo;
      noConf += cuenta.noConfirmados;
      falt += cuenta.faltantes;
      extras += cuenta.extras;
      delPeriodo += cuenta.delPeriodo;

      cargos.desgloseDe(f.id).forEach(c => {
        const acc = porCargo.get(c.id);
        if (!acc) return;
        if (c.exenta) acc.exentas++;
        else { acc.familias++; acc.monto += c.amount; }
      });
    });

    const ingresos = entries.filter(e => e.type === 'ingreso').reduce((s, e) => s + (e.amount || 0), 0);
    const egresos = entries.filter(e => e.type === 'egreso').reduce((s, e) => s + (e.amount || 0), 0);

    // Saldos que las familias traían de antes, contados aparte: bajan lo que hay
    // que cobrar este mes, pero no son plata que entró este mes.
    const aFavor = families.filter(f => (f.balance || 0) > 0).reduce((s, f) => s + f.balance, 0);
    const enContra = families.filter(f => (f.balance || 0) < 0).reduce((s, f) => s + Math.abs(f.balance), 0);

    return {
      conPedido: conPedido.length, productos, cargosTotal, noConf, falt, extras, delPeriodo,
      ingresos, egresos, aFavor, enContra,
      porCobrar: delPeriodo - ingresos,
      porCargo: Array.from(porCargo.values()),
    };
  }, [families, sealed, ajustes, cargos, entries]);

  if (!period) return null;

  const filas = [
    { l: 'Productos pedidos', v: datos.productos, mostrar: true,
      de: datos.conPedido + ' pedidos sellados · suma de sealed_orders.total' },
    { l: 'Cargos fijos', v: datos.cargosTotal, mostrar: datos.cargosTotal !== 0,
      de: cargos.lista.length + ' cargo' + (cargos.lista.length === 1 ? '' : 's') + ' aplicados familia por familia, descontando exenciones' },
    { l: '📭 No confirmados por el proveedor', v: datos.noConf, mostrar: datos.noConf !== 0,
      de: 'order_adjustments tipo no_confirmado — no se les cobra' },
    { l: '❗ Faltantes del retiro', v: datos.falt, mostrar: datos.falt !== 0,
      de: 'order_adjustments tipo faltante — quedan a favor de la familia' },
    { l: '➕ Extras por cobrar', v: datos.extras, mostrar: datos.extras !== 0,
      de: 'order_adjustments tipo extra que todavía no están marcados como pagados' },
  ].filter(r => r.mostrar);

  return (
    <div style={{ background: 'white', border: '1px solid #dde8dd', borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', gap: '8px', flexWrap: 'wrap' }}>
        <p style={{ fontSize: '11px', color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
          Qué implica {period.label}
        </p>
        <button onClick={() => setAbierto(!abierto)}
          style={{ fontSize: '10px', padding: '3px 9px', background: 'white', border: '1px solid #dde8dd', borderRadius: '10px', cursor: 'pointer', color: '#888' }}>
          {abierto ? '▲ ocultar de dónde sale cada cifra' : '▼ de dónde sale cada cifra'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '9px', marginBottom: '12px' }}>
        {[
          { l: 'Debería recaudar', v: datos.delPeriodo, c: '#1565c0', bg: '#e3f2fd',
            ay: 'Pedidos + cargos + ajustes, familia por familia' },
          // Con la tabla cash_flow caída no se muestra "$0": un cero es una
          // afirmación —nadie pagó— y acá el hecho es que no se sabe.
          ...(sinCashFlow ? [] : [
            { l: 'Ingresos registrados', v: datos.ingresos, c: '#2e7d32', bg: '#e8f5e9',
              ay: 'Movimientos de tipo ingreso en este período' },
            { l: datos.porCobrar >= 0 ? 'Falta por cobrar' : 'Cobrado de más',
              v: Math.abs(datos.porCobrar), c: datos.porCobrar > 0 ? '#e65100' : '#2e7d32',
              bg: datos.porCobrar > 0 ? '#fff3e0' : '#e8f5e9',
              ay: 'La diferencia entre las dos cifras anteriores' },
            { l: 'Egresos registrados', v: datos.egresos, c: '#c62828', bg: '#ffebee',
              ay: 'Pagos a proveedores, fletes y demás gastos anotados' },
          ]),
        ].map(m => (
          <div key={m.l} style={{ padding: '0.8rem', background: m.bg, borderRadius: '8px', textAlign: 'center' }} title={m.ay}>
            <p style={{ fontSize: '10px', color: m.c, margin: 0, fontWeight: 600, lineHeight: 1.3 }}>{m.l}</p>
            <p style={{ fontSize: '16px', fontWeight: 700, margin: '4px 0 0', color: m.c }}>{clp(m.v)}</p>
            {abierto && <p style={{ fontSize: '9px', color: m.c, opacity: 0.75, margin: '4px 0 0', lineHeight: 1.4 }}>{m.ay}</p>}
          </div>
        ))}
      </div>

      <p style={{ fontSize: '10px', color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 5px' }}>Desglose de lo que debería recaudar</p>
      {filas.map(r => (
        <div key={r.l} style={{ padding: '5px 0', borderBottom: '1px solid #f4f8f4' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: '#555' }}>{r.l}</span>
            <span style={{ fontWeight: 600, color: r.v < 0 ? '#2e7d32' : '#333' }}>{r.v < 0 ? '− ' : ''}{clp(Math.abs(r.v))}</span>
          </div>
          {abierto && <p style={{ fontSize: '9px', color: '#bbb', margin: '2px 0 0' }}>{r.de}</p>}
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', fontSize: '13px', fontWeight: 700, color: '#2d5a2d' }}>
        <span>Total del período</span><span>{clp(datos.delPeriodo)}</span>
      </div>

      {/* Los cargos, cargo por cargo: es lo que el perfil contable tiene que
          rendir, y lo que el total agregado escondía. */}
      {cargos.lista.length > 0 && (
        <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #f0f7f0' }}>
          <p style={{ fontSize: '10px', color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 5px' }}>Recaudación por cargo</p>
          {datos.porCargo.map(c => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0', fontSize: '12px', borderBottom: '1px solid #f4f8f4' }}>
              <span style={{ color: '#555' }}>
                {c.name} <span style={{ color: '#aaa', fontSize: '10px' }}>
                  {clp(c.amount)} × {c.familias} familia{c.familias === 1 ? '' : 's'}
                  {c.exentas > 0 && ' · ' + c.exentas + ' exenta' + (c.exentas === 1 ? '' : 's')}
                </span>
              </span>
              <span style={{ fontWeight: 600, color: '#1565c0', whiteSpace: 'nowrap' }}>{clp(c.monto)}</span>
            </div>
          ))}
        </div>
      )}

      {/* El saldo anterior no es plata de este mes, y sumarlo acá haría que el
          flujo del período no cuadre con sus propios comprobantes. */}
      {(datos.aFavor > 0 || datos.enContra > 0) && (
        <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #f0f7f0' }}>
          <p style={{ fontSize: '10px', color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 5px' }}>
            Saldos que vienen de antes
          </p>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {datos.aFavor > 0 && (
              <span style={{ fontSize: '12px', color: '#2e7d32' }}>
                A favor de las familias: <strong>{clp(datos.aFavor)}</strong>
              </span>
            )}
            {datos.enContra > 0 && (
              <span style={{ fontSize: '12px', color: '#c62828' }}>
                Pendiente de familias: <strong>{clp(datos.enContra)}</strong>
              </span>
            )}
          </div>
          <p style={{ fontSize: '9px', color: '#bbb', margin: '4px 0 0', lineHeight: 1.5 }}>
            Van aparte a propósito: bajan lo que hay que cobrar este mes, pero no son plata
            que entró en {period.label}. Se aplican al cerrar el período.
          </p>
        </div>
      )}
    </div>
  );
}
