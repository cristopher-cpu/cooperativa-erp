// GET /api/estado
//
// Le dice al panel cómo está configurado el envío de correo, para que el admin
// vea ANTES de apretar el botón si está en modo prueba o si le va a llegar de
// verdad al proveedor. No expone la clave, solo si existe.

const { CORREO_PRUEBAS, REMITENTE } = require('./_lib/correo');
const { haySecreto } = require('./_lib/sesion');
const { hayServiceKey } = require('./_lib/db');

// Este endpoint es público: no exponemos direcciones completas para no
// regalárselas a un recolector de correos que pase por aquí.
function enmascarar(correo) {
  if (!correo) return null;
  const [u, dom] = String(correo).split('@');
  if (!dom) return '***';
  const visible = u.slice(0, 2);
  return visible + '*'.repeat(Math.max(3, u.length - 2)) + '@' + dom;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    modoPrueba: !!CORREO_PRUEBAS,
    destinoPruebas: enmascarar(CORREO_PRUEBAS),
    remitente: enmascarar(REMITENTE.email),
    remitenteNombre: REMITENTE.name,
    brevoConfigurado: !!process.env.BREVO_API_KEY,

    // Si RLS ya está encendido y falta una de estas dos, el síntoma es una
    // pantalla vacía sin explicación. Decir cuál falta es la diferencia entre
    // diez minutos y una tarde. Se publica solo el booleano, nunca el valor:
    // con el secreto JWT cualquiera se emite un token de administrador, y con la
    // clave de servicio RLS deja de servir para nada.
    sesionFirmada: haySecreto(),
    claveDeServicio: hayServiceKey(),
  });
};
