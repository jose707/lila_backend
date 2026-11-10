// backend/src/middleware/autenticacion.js
const jwt = require('jsonwebtoken');

const autenticacionIntermediario = (solicitud, respuesta, siguiente) => {
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

    console.log('🔐 Verificando token...');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    console.log('✅ Token válido para usuario:', decoded.id);
    solicitud.user = decoded;
    siguiente();
  } catch (error) {
    console.error('❌ Error en autenticación:', error.message);

    respuesta.status(401).json({
      error: 'Token inválido o expirado',
      message: error.message
    });
  }
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
  autenticacionIntermediario: autenticacionIntermediario,
  adminIntermediario: administradorIntermediario,
  conductorIntermediario: conductorIntermediario
};
