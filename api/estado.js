// GET /api/estado
//
// Le dice al panel cómo está configurado el envío de correo, para que el admin
// vea ANTES de apretar el botón si está en modo prueba o si le va a llegar de
// verdad al proveedor. No expone la clave, solo si existe.

const { CORREO_PRUEBAS, REMITENTE } = require('./_lib/correo');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    modoPrueba: !!CORREO_PRUEBAS,
    destinoPruebas: CORREO_PRUEBAS || null,
    remitente: REMITENTE.email,
    remitenteNombre: REMITENTE.name,
    brevoConfigurado: !!process.env.BREVO_API_KEY,
  });
};
