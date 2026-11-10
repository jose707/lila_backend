const UsuarioIdentidad = require("../models/UsuarioIdentidad");
module.exports = async (solicitud, respuesta, siguiente) => {
  // Temporalmente permite continuar a pasajeros con celular verificado.
  // Al reactivar CI + prueba de vida, establecer IDENTITY_VERIFICATION_ENABLED=true.
  if (process.env.IDENTITY_VERIFICATION_ENABLED !== 'true') return siguiente();
  try {
    const identidad = await UsuarioIdentidad.findOne({ where: { userId: solicitud.user.id } });
    if (identidad?.verificationStatus !== 'verificado') return respuesta.status(403).json({ error: 'Completa la verificación de identidad antes de iniciar esta operación.' });
    siguiente();
  } catch {respuesta.status(503).json({ error: 'No se pudo comprobar la identidad. Intenta nuevamente.' });}
};
