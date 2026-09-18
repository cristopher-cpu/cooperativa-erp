import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getAllPeriods, getSealedOrders, getAdjustments, getPurchaseOrders,
  getBodega, getBodegaAssignments, getPeriodCharges, getChargeExemptions,
} from './supabaseClient';
import { construirCargos, clp } from './calculos';
import { REPORTES, hojaPortada, nombreArchivo } from './reportes';
import { descargarXlsx } from './excel';

// ─── REPORTES ────────────────────────────────────────────────────────────────
//
// Cinco planillas, cualquiera de los períodos, activos o cerrados.
//
// ── Por qué se puede elegir el período ──────────────────────────────────────
//
// El plan lo pedía explícitamente: los reportes tienen que seguir disponibles
// para períodos cerrados. La cooperativa rinde cuentas de ciclos terminados, y
// un reporte que solo sabe del mes en curso obliga a guardar copias a mano —que
// es exactamente lo que se está reemplazando.
//
// Se leen las tablas vivas filtrando `period_id`, no `periods.summary`: el
// resumen que se guarda al cerrar tiene los totales pero no las líneas, ni los
// faltantes, ni la bodega.
//
// ── Por qué se cargan los datos al elegir y no antes ────────────────────────
//
// Son seis consultas por período. Traerlas para los doce períodos al abrir la
// pestaña gastaría la cuota de Supabase en datos que nadie pidió, y el proyecto
// está en el plan gratuito.

export function AdminReportes({ families, products, providers, currentAdmin, period: periodoActivo }) {
  const [periodos, setPeriodos] = useState([]);
  const [elegido, setElegido] = useState(null);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [generando, setGenerando] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    getAllPeriods().then(ps => {
      const lista = (ps || []).slice().sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return String(b.closed_at || b.created_at || '').localeCompare(String(a.closed_at || a.created_at || ''));
      });
      setPeriodos(lista);
      setElegido((periodoActivo && lista.find(p => p.id === periodoActivo.id)) || lista[0] || null);
      setCargando(false);
    }).catch(() => { setErr('No se pudieron cargar los períodos.'); setCargando(false); });
    // periodoActivo solo define la preselección inicial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cargarDatos = useCallback(async (p) => {
    if (!p) return;
    setDatos(null); setErr('');
    try {
      const [ordenes, ajustes, pos, bodega, asignaciones, charges, exemptions] = await Promise.all([
        getSealedOrders(p.id),
        getAdjustments(p.id),
        getPurchaseOrders(p.id),
        getBodega(p.id),
        getBodegaAssignments(p.id),
        getPeriodCharges(p.id),
        getChargeExemptions(p.id),
      ]);

      // Los pedidos llegan como lista y se necesitan por familia. `getSealedOrders`
      // ya viene ordenado por `sealed_at`, así que si una familia tuviera dos filas
      // —lo que la base todavía no impide— gana la última, igual que en App.js.
      const sealed = {};
      (ordenes || []).forEach(o => { sealed[o.family_id] = o; });

      setDatos({
        sealed,
        ajustes: ajustes || [],
        purchaseOrders: pos || [],
        bodega: bodega || [],
        asignaciones: asignaciones || [],
        cargos: construirCargos({ charges, exemptions: exemptions || [], period: p }),
        faltanAjustes: ajustes === null,
      });
    } catch (e) {
      setErr('No se pudieron cargar los datos de ' + p.label + '. Revisa la conexión.');
    }
  }, []);

  useEffect(() => { cargarDatos(elegido); }, [elegido, cargarDatos]);

  const resumen = useMemo(() => {
    if (!datos || !elegido) return null;
    const pedidos = Object.keys(datos.sealed).length;
    return {
      pedidos,
      retirados: Object.values(datos.sealed).filter(o => o.retired).length,
      ajustes: datos.ajustes.length,
      bodega: datos.bodega.length,
      cargos: datos.cargos.lista.length,
    };
  }, [datos, elegido]);

  const generar = async (rep) => {
    if (!elegido || !datos) return;
    setGenerando(rep.id); setErr('');
    try {
      const contexto = { period: elegido, families, products, providers, ...datos };
      const hojas = [
        hojaPortada({
          period: elegido, cargos: datos.cargos,
          quien: currentAdmin ? currentAdmin.name : '', titulo: rep.titulo,
        }),
        ...rep.hojas(contexto),
      ];
      descargarXlsx(hojas, nombreArchivo(elegido, rep.id));
    } catch (e) {
      console.error('generar reporte:', e);
      setErr('No se pudo generar "' + rep.titulo + '": ' + e.message);
    }
    setGenerando(null);
  };

  // Todo en un archivo. Es lo que se manda por correo a fin de ciclo, y armarlo
  // con cinco descargas sueltas es cinco veces la posibilidad de olvidar una.
  const generarTodo = async () => {
    if (!elegido || !datos) return;
    setGenerando('__todo__'); setErr('');
    try {
      const contexto = { period: elegido, families, products, providers, ...datos };
      const hojas = [
        hojaPortada({
          period: elegido, cargos: datos.cargos,
          quien: currentAdmin ? currentAdmin.name : '', titulo: 'Reporte completo del período',
        }),
      ];
      REPORTES.forEach(rep => { hojas.push(...rep.hojas(contexto)); });
      descargarXlsx(hojas, nombreArchivo(elegido, 'completo'));
    } catch (e) {
      console.error('generar reporte completo:', e);
      setErr('No se pudo generar el reporte completo: ' + e.message);
    }
    setGenerando(null);
  };

  if (cargando) return <p style={{ color: '#888', fontSize: '13px' }}>Cargando períodos...</p>;

  if (!periodos.length) {
    return (
      <div style={{ background: '#fff8e1', border: '1px solid #ffc107', borderRadius: '10px', padding: '1.25rem' }}>
        <p style={{ fontSize: '13px', color: '#e65100', margin: 0 }}>Todavía no hay períodos de los que sacar reportes.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Elegir período */}
      <div style={{ background: 'white', border: '1px solid #dde8dd', borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}>
        <p style={{ fontSize: '11px', color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>
          De qué período
        </p>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {periodos.map(p => {
            const act = elegido && elegido.id === p.id;
            return (
              <button key={p.id} onClick={() => setElegido(p)}
                style={{
                  padding: '6px 13px', borderRadius: '18px', cursor: 'pointer', fontSize: '12px',
                  fontWeight: act ? 700 : 400,
                  border: '1px solid ' + (act ? '#1565c0' : '#dde8dd'),
                  background: act ? '#1565c0' : 'white',
                  color: act ? 'white' : '#555',
                }}>
                {p.label}
                <span style={{ fontSize: '10px', opacity: 0.8 }}> {p.active ? '· activo' : '· cerrado'}</span>
              </button>
            );
          })}
        </div>

        {elegido && !datos && !err && (
          <p style={{ fontSize: '12px', color: '#888', margin: '10px 0 0' }}>Cargando datos de {elegido.label}...</p>
        )}

        {resumen && (
          <p style={{ fontSize: '11px', color: '#888', margin: '10px 0 0', lineHeight: 1.6 }}>
            {resumen.pedidos} pedido{resumen.pedidos === 1 ? '' : 's'} sellado{resumen.pedidos === 1 ? '' : 's'} ·
            {' '}{resumen.retirados} retirado{resumen.retirados === 1 ? '' : 's'} ·
            {' '}{resumen.ajustes} faltante{resumen.ajustes === 1 ? '' : 's'} o extra{resumen.ajustes === 1 ? '' : 's'} ·
            {' '}{resumen.bodega} ítem{resumen.bodega === 1 ? '' : 's'} en bodega ·
            {' '}{resumen.cargos} cargo{resumen.cargos === 1 ? '' : 's'} fijo{resumen.cargos === 1 ? '' : 's'} de {clp(datos.cargos.total)}
          </p>
        )}
      </div>

      {err && (
        <div style={{ background: '#ffebee', border: '1px solid #ef9a9a', borderRadius: '8px', padding: '11px 14px', marginBottom: '1rem' }}>
          <p style={{ fontSize: '13px', color: '#c62828', margin: 0, fontWeight: 500 }}>{err}</p>
        </div>
      )}

      {datos && datos.faltanAjustes && (
        <div style={{ background: '#fff8e1', border: '1px solid #ffc107', borderRadius: '8px', padding: '10px 13px', marginBottom: '1rem' }}>
          <p style={{ fontSize: '11px', color: '#e65100', margin: 0, lineHeight: 1.6 }}>
            La tabla de faltantes y extras no existe todavía (falta <code>004_ajustes_pedido.sql</code>).
            Los reportes salen igual, pero sin faltantes ni extras y con los totales sin descontar.
          </p>
        </div>
      )}

      {elegido && !elegido.active && (
        <div style={{ background: '#eceff1', border: '1px solid #b0bec5', borderRadius: '8px', padding: '10px 13px', marginBottom: '1rem' }}>
          <p style={{ fontSize: '11px', color: '#455a64', margin: 0, lineHeight: 1.6 }}>
            🔒 <strong>{elegido.label}</strong> está cerrado. Los reportes salen completos, pero las columnas
            de saldo muestran el saldo de <strong>hoy</strong>, no el que la familia traía entonces: la base guarda un
            solo saldo por familia y se va actualizando. Lo que se cobró de verdad está en la columna
            <strong> Cobrado al cerrar</strong>, que quedó escrita en el pedido ese día. La portada de cada archivo lo repite.
          </p>
        </div>
      )}

      {/* Todo junto */}
      <button onClick={generarTodo} disabled={!datos || !!generando}
        style={{ width: '100%', padding: '12px', background: datos ? '#2e7d32' : '#bdbdbd', color: 'white', border: 'none', borderRadius: '10px', cursor: datos && !generando ? 'pointer' : 'default', fontWeight: 700, fontSize: '14px', marginBottom: '1rem' }}>
        {generando === '__todo__' ? 'Generando...' : '📗 Descargar todo en un archivo' + (elegido ? ' — ' + elegido.label : '')}
      </button>

      {/* Uno por uno */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px' }}>
        {REPORTES.map(rep => (
          <div key={rep.id} style={{ background: 'white', border: '1px solid #dde8dd', borderRadius: '10px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <p style={{ fontSize: '13px', fontWeight: 700, color: '#333', margin: 0 }}>{rep.ic} {rep.titulo}</p>
            <p style={{ fontSize: '11px', color: '#888', margin: 0, lineHeight: 1.6, flex: 1 }}>{rep.descripcion}</p>
            <button onClick={() => generar(rep)} disabled={!datos || !!generando}
              style={{ padding: '8px', background: datos ? '#e3f2fd' : '#f5f5f5', color: datos ? '#1565c0' : '#aaa', border: '1px solid ' + (datos ? '#90caf9' : '#e0e0e0'), borderRadius: '7px', cursor: datos && !generando ? 'pointer' : 'default', fontWeight: 600, fontSize: '12px' }}>
              {generando === rep.id ? 'Generando...' : '↓ Descargar .xlsx'}
            </button>
          </div>
        ))}
      </div>

      <p style={{ fontSize: '10px', color: '#bbb', margin: '1rem 0 0', lineHeight: 1.6 }}>
        Los archivos se generan en tu navegador y no pasan por ningún servidor. Cada uno abre con una
        hoja de portada que dice de qué período es, qué cargos tenía y cuándo se generó — para que dos
        archivos en la misma carpeta no sean indistinguibles.
      </p>
    </div>
  );
}
