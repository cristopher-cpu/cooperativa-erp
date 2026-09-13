import React, { useState } from 'react';
import { clp } from './calculos';

// ─── CUMPLIMIENTO DE PROVEEDORES ─────────────────────────────────────────────
// Dos cosas distintas que conviene no confundir:
//
//   PUNTUALIDAD  ¿contestó, y antes del plazo? Es orden administrativo.
//   PALABRA      de lo que dijo que traía, ¿cuánto llegó? Es lo que cuesta plata.
//
// Un proveedor que confirma todo y después no aparece hace más daño que uno que
// avisa a tiempo que no tiene: el primero deja a las familias sin su producto
// cuando ya no queda margen para conseguirlo en otra parte, y con la plata ya
// cobrada.

function BarraPct({ valor, color }) {
  if (valor == null) return <span style={{ fontSize: '11px', color: '#bbb' }}>sin datos</span>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
      <div style={{ flex: 1, height: '6px', background: '#eee', borderRadius: '3px', minWidth: '40px' }}>
        <div style={{ height: '6px', width: valor + '%', background: color, borderRadius: '3px' }} />
      </div>
      <span style={{ fontSize: '12px', fontWeight: 700, color, minWidth: '34px', textAlign: 'right' }}>{valor}%</span>
    </div>
  );
}

export function CumplimientoProveedores({ filas }) {
  const [abierto, setAbierto] = useState(null);

  if (filas === null) {
    return <p style={{ color: '#888', fontSize: '13px', margin: '0 0 12px' }}>Cargando cumplimiento de proveedores...</p>;
  }

  if (!filas.length) {
    return (
      <div style={{ background: 'white', border: '1px solid #dde8dd', borderRadius: '10px', padding: '1.25rem', marginBottom: '12px' }}>
        <p style={{ fontSize: '13px', fontWeight: 700, color: '#333', margin: '0 0 5px' }}>🤝 Cumplimiento de proveedores</p>
        <p style={{ fontSize: '12px', color: '#999', margin: 0 }}>
          Todavía no se ha enviado ninguna orden de compra. El indicador aparece en cuanto haya órdenes con respuesta.
        </p>
      </div>
    );
  }

  const colorPct = v => v == null ? '#bbb' : v >= 80 ? '#2e7d32' : v >= 50 ? '#e65100' : '#c62828';

  return (
    <div style={{ background: 'white', border: '1px solid #dde8dd', borderRadius: '10px', padding: '1.25rem', marginBottom: '12px' }}>
      <p style={{ fontSize: '13px', fontWeight: 700, color: '#333', margin: '0 0 4px' }}>🤝 Cumplimiento de proveedores</p>
      <p style={{ fontSize: '11px', color: '#888', margin: '0 0 14px', lineHeight: 1.5 }}>
        Sobre todo el histórico, no solo este período: a un proveedor se lo juzga por su costumbre, no por un mes.
        Las respuestas que la comisión tuvo que ir a buscar por teléfono cuentan como respuesta, pero se muestran aparte.
      </p>

      <div style={{ display: 'flex', gap: '14px', marginBottom: '10px', fontSize: '10px', color: '#888', flexWrap: 'wrap' }}>
        <span><strong style={{ color: '#1565c0' }}>Responde</strong> · contestó la orden</span>
        <span><strong style={{ color: '#6a1b9a' }}>A tiempo</strong> · antes del plazo</span>
        <span><strong style={{ color: '#2e7d32' }}>Palabra</strong> · de lo confirmado, cuánto llegó</span>
        <span><strong style={{ color: '#4527a0' }}>Solo/a</strong> · respondió sin que hubiera que llamarlo</span>
      </div>

      {filas.map(f => {
        const exp = abierto === f.id;
        return (
          <div key={f.id} style={{ borderTop: '1px solid #f0f0f0', padding: '10px 0' }}>
            <div onClick={() => setAbierto(exp ? null : f.id)} style={{ cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '13px', color: '#333' }}>{f.name}</strong>
                {f.is_member && <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '8px', background: '#f3e5f5', color: '#6a1b9a' }}>SOCIA</span>}
                <span style={{ fontSize: '10px', color: '#999' }}>{f.enviadas} orden{f.enviadas === 1 ? '' : 'es'}</span>
                {f.sinResponder > 0 && (
                  <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 7px', borderRadius: '8px', background: '#fff3e0', color: '#e65100' }}>
                    {f.sinResponder} sin responder
                  </span>
                )}
                {f.porComision > 0 && (
                  <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 7px', borderRadius: '8px', background: '#ede7f6', color: '#4527a0' }}>
                    📞 {f.porComision} por teléfono
                  </span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#aaa' }}>{exp ? '▲' : '▼'}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                {[
                  { l: 'Responde', v: f.pctConfirma, c: '#1565c0' },
                  { l: 'A tiempo', v: f.pctATiempo, c: '#6a1b9a' },
                  { l: 'Solo/a', v: f.pctAutonomia, c: '#4527a0' },
                  { l: 'Palabra', v: f.pctPalabra, c: colorPct(f.pctPalabra) },
                ].map(m => (
                  <div key={m.l}>
                    <p style={{ fontSize: '9px', color: '#999', margin: '0 0 3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{m.l}</p>
                    <BarraPct valor={m.v} color={m.c} />
                  </div>
                ))}
              </div>
            </div>

            {exp && (
              <div style={{ marginTop: '10px', padding: '10px 12px', background: '#fafafa', borderRadius: '7px' }}>
                <p style={{ fontSize: '11px', fontWeight: 700, color: '#666', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  De dónde salen estos números
                </p>
                {[
                  { l: 'Órdenes enviadas', v: f.enviadas },
                  { l: 'Respondidas', v: f.confirmadas + ' de ' + f.enviadas },
                  { l: 'Por el enlace, sin insistir', v: f.porSuCuenta + ' de ' + (f.confirmadas || 0) },
                  { l: 'Registradas por la comisión', v: f.porComision + (f.porComision ? ' (hubo que llamarlo)' : '') },
                  { l: 'Dentro del plazo', v: f.conLimite ? f.aTiempo + ' de ' + f.conLimite : 'ningún período tenía plazo definido' },
                  { l: 'Demora promedio en responder', v: f.horasPromedio != null ? f.horasPromedio + ' horas' : '—' },
                  { l: 'Valor que confirmó traer', v: clp(f.valorConfirmado) },
                  { l: 'De eso, faltó al entregar', v: clp(f.faltoTrasConfirmar) },
                ].map(r => (
                  <div key={r.l} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '3px 0', fontSize: '12px' }}>
                    <span style={{ color: '#666' }}>{r.l}</span>
                    <span style={{ fontWeight: 600, color: '#333', textAlign: 'right' }}>{r.v}</span>
                  </div>
                ))}
                {f.pctPalabra != null && f.pctPalabra < 100 && (
                  <p style={{ fontSize: '11px', color: '#c62828', margin: '8px 0 0', lineHeight: 1.5 }}>
                    Confirmó {clp(f.valorConfirmado)} y faltaron {clp(f.faltoTrasConfirmar)} al entregar. Son promesas que la cooperativa ya había cobrado a las familias.
                  </p>
                )}
                {f.pctPalabra == null && (
                  <p style={{ fontSize: '11px', color: '#999', margin: '8px 0 0' }}>
                    Aún no hay confirmaciones con entrega registrada para medir la palabra cumplida.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
