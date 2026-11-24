const UsuarioIdentidad = require("../models/UsuarioIdentidad");
const Usuario = require('../models/Usuario');
const { accesoIdentidad } = require('../services/identidadAcceso');
module.exports = async (solicitud, respuesta, siguiente) => {
  try {
    const usuario = await Usuario.findByPk(solicitud.user.id, { attributes: ['id', 'phoneVerified'] });
    if (!usuario?.phoneVerified) return respuesta.status(403).json({
      error: 'Confirma tu número de celular para continuar.', code: 'TELEFONO_NO_VERIFICADO'
    });
    const identidad = await UsuarioIdentidad.findOne({ where: { userId: solicitud.user.id } });
    if (identidad?.verificationStatus === 'verificado') return siguiente();
    const esViaje = solicitud.baseUrl.endsWith('/viajes');
    if (esViaje && !(await accesoIdentidad(usuario.id, false)).verificacionIdentidadRequerida) return siguiente();
    return respuesta.status(403).json({
      error: esViaje ? 'Completaste tus 10 viajes. Verifica tu CI y realiza la prueba de vida para solicitar otro.'
        : 'Verifica tu CI y realiza la prueba de vida antes de registrarte como conductor.',
      code: 'IDENTIDAD_REQUERIDA'
    });
  } catch {respuesta.status(503).json({ error: 'No se pudo comprobar la identidad. Intenta nuevamente.' });}
};
