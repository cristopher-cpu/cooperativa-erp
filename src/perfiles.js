// ─── PERFILES Y QUÉ VE CADA UNO ──────────────────────────────────────────────
//
// La cooperativa trabaja por comisiones rotativas y una familia puede estar en
// dos a la vez, así que el rol es una LISTA, no un valor único.
//
// ── Advertencia importante ──────────────────────────────────────────────────
//
// Esto decide qué se MUESTRA, no qué se puede hacer. Mientras RLS siga apagado
// en Supabase, cualquiera con conocimiento técnico puede saltarse estas reglas
// escribiendo directo a la base. Es organización —que cada comisión encuentre lo
// suyo sin navegar once pestañas— no una barrera de seguridad.
//
// Cuando llegue la autenticación real, estos mismos permisos hay que expresarlos
// como políticas en la base. Esta tabla es el borrador de esas políticas.

export const PERFILES = {
  admin: {
    label: 'Administración',
    corto: 'Admin',
    descripcion: 'Acceso completo: familias, proveedores, roles, período y cierre',
    color: '#1565c0', bg: '#e3f2fd', ic: '🛠️',
  },
  proveedores: {
    label: 'Comisión Proveedores',
    corto: 'Proveedores',
    descripcion: 'Contacta proveedores, mantiene el maestro y envía las órdenes de compra',
    color: '#6a1b9a', bg: '#f3e5f5', ic: '🚜',
  },
  recepcion: {
    label: 'Comisión Recepción',
    corto: 'Recepción',
    descripcion: 'Recibe la mercadería del proveedor y la organiza para el retiro',
    color: '#00838f', bg: '#e0f7fa', ic: '📥',
  },
  retiro: {
    label: 'Comisión Retiro',
    corto: 'Retiro',
    descripcion: 'Entrega a las familias y registra faltantes y extras',
    color: '#e65100', bg: '#fff3e0', ic: '📤',
  },
  contable: {
    label: 'Balance Contable',
    corto: 'Contable',
    descripcion: 'Flujo de caja, cruce de transferencias y saldos de las familias',
    color: '#2e7d32', bg: '#e8f5e9', ic: '💵',
  },
  familia: {
    label: 'Familia',
    corto: 'Familia',
    descripcion: 'Hace pedidos. Lo tienen todas las socias.',
    color: '#555', bg: '#f5f5f5', ic: '🏠',
  },
};

// Qué pestaña del panel ve cada perfil. `admin` las ve todas y no aparece acá.
//
// Recepción y Retiro se separan a propósito: Recepción necesita el consolidado
// para cotejar contra lo que llega, y Retiro necesita los faltantes y extras del
// día de la entrega. Se solapan en Bodega, que es donde ambas trabajan.
//
// Reportes lo ven las tres comisiones que rinden cuentas hacia afuera:
// Proveedores (qué comprarle a cada uno), Retiro (faltantes y extras) y Balance
// Contable (todo el resto). Recepción no: su trabajo es de un día y se apoya en
// el consolidado en pantalla, no en planillas de períodos cerrados.
const TABS_POR_PERFIL = {
  proveedores: ['dashboard', 'consolidado', 'proveedores', 'productos', 'bodega', 'reportes'],
  recepcion:   ['dashboard', 'consolidado', 'retiros', 'bodega'],
  retiro:      ['dashboard', 'retiros', 'ajustes', 'bodega', 'pedidos', 'reportes'],
  contable:    ['dashboard', 'analitica', 'flujo', 'saldos', 'pedidos', 'reportes'],
  familia:     [],
};

export function rolesDe(fam) {
  if (!fam) return [];
  if (Array.isArray(fam.roles) && fam.roles.length) return fam.roles;
  // Antes de la migración 005 solo existe `role`. Sin esta caída, nadie tendría
  // ningún perfil y el panel quedaría vacío hasta ejecutar el SQL.
  return fam.role === 'admin' ? ['admin', 'familia'] : ['familia'];
}

export const tieneRol = (fam, rol) => rolesDe(fam).includes(rol);

// ¿Ve el panel de administración, o solo la vista de familia?
export const esDelPanel = (fam) =>
  rolesDe(fam).some(r => r !== 'familia' && PERFILES[r]);

export const esAdmin = (fam) => tieneRol(fam, 'admin');

// Pestañas visibles, en el orden en que las define el panel.
export function tabsVisibles(fam, todasLasTabs) {
  const roles = rolesDe(fam);
  if (roles.includes('admin')) return todasLasTabs;

  const permitidas = new Set();
  roles.forEach(r => (TABS_POR_PERFIL[r] || []).forEach(t => permitidas.add(t)));
  return todasLasTabs.filter(t => permitidas.has(t.id));
}

// Etiqueta corta para mostrar junto al nombre, sin repetir "Familia" que todas
// tienen y no distingue a nadie.
export function etiquetasDe(fam) {
  return rolesDe(fam).filter(r => r !== 'familia' && PERFILES[r]).map(r => ({ id: r, ...PERFILES[r] }));
}
