// backend/src/middleware/autenticacion.js
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');

const cuentaDesactivada = {
  code: 'CUENTA_DESACTIVADA',
  error: 'Tu cuenta ha sido deshabilitada. Contacta al administrador para más información.'
};
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

async function validarSesion(token) {
  let datos;
  try {
    datos = jwt.verify(token, process.env.JWT_SECRET || 'secret');
  } catch {
    throw Object.assign(new Error('Token inválido o expirado'), { status: 401 });
  }
  if (typeof datos?.id !== 'string' || !uuid.test(datos.id)) {
    throw Object.assign(new Error('Token inválido'), { status: 401 });
  }
  const usuario = await Usuario.findByPk(datos.id, { attributes: ['id', 'isActive'] });
  if (!usuario) throw Object.assign(new Error('Sesión inválida'), { status: 401 });
  if (!usuario.isActive) {
    throw Object.assign(new Error(cuentaDesactivada.error), { status: 403, code: cuentaDesactivada.code });
  }
  return datos;
}

const autenticacionIntermediario = async (solicitud, respuesta, siguiente) => {
  try {
    const token = solicitud.headers.authorization?.split(' ')[1];

    if (!token) {
      console.warn('⚠️ Token no proporcionado en request');
      console.warn('   Headers:', Object.keys(solicitud.headers));
      return respuesta.status(401).json({
        error: 'Token no proporcionado',
        message: 'Agregue Authorization: Bearer <token> en los headers'
      });
    }

    solicitud.user = await validarSesion(token);
  } catch (error) {
    if (error.code === cuentaDesactivada.code) return respuesta.status(403).json(cuentaDesactivada);
    if (error.status === 401) return respuesta.status(401).json({ error: error.message });
    console.error('Error al consultar la sesión:', error.original?.code ?? error.name);
    return respuesta.status(503).json({ error: 'No se pudo comprobar la sesión. Intenta nuevamente.' });
  }
  return siguiente();
};

const administradorIntermediario = (solicitud, respuesta, siguiente) => {
  if (solicitud.user.role !== 'administrador') {
    return respuesta.status(403).json({
      error: 'No tienes permisos de administrador'
    });
  }
  siguiente();
};

const conductorIntermediario = (solicitud, respuesta, siguiente) => {
  if (solicitud.user.role !== 'conductor') {
    return respuesta.status(403).json({
      error: 'Solo los conductores pueden acceder a este recurso'
    });
  }
  siguiente();
};

module.exports = {
  cuentaDesactivada,
  validarSesion,
  autenticacionIntermediario: autenticacionIntermediario,
  adminIntermediario: administradorIntermediario,
  conductorIntermediario: conductorIntermediario
};
