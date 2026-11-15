const { cuentaDesactivada, validarSesion } = require('../../middleware/autenticacion');

const socketAutenticacionIntermediario = async (socket, siguiente) => {
  try {
    const token =
    socket.handshake.auth?.token ||
    socket.handshake.headers?.authorization?.split(' ')[1];

    if (!token) {
      return siguiente(new Error('AUTH_ERROR: Token no proporcionado'));
    }

    socket.user = await validarSesion(token);
  } catch (error) {
    if (error.code === cuentaDesactivada.code) {
      return siguiente(Object.assign(new Error(cuentaDesactivada.error), { data: cuentaDesactivada }));
    }
    return siguiente(new Error(error.status === 401
      ? 'AUTH_ERROR: Token inválido o expirado'
      : 'No se pudo comprobar la sesión'));
  }
  return siguiente();
};

module.exports = { socketAutenticacionIntermediario: socketAutenticacionIntermediario };
