const jwt = require('jsonwebtoken');

const socketAutenticacionIntermediario = (socket, siguiente) => {
  try {
    const token =
    socket.handshake.auth?.token ||
    socket.handshake.headers?.authorization?.split(' ')[1];

    if (!token) {
      return siguiente(new Error('AUTH_ERROR: Token no proporcionado'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    socket.user = decoded;
    siguiente();
  } catch (error) {
    siguiente(new Error('AUTH_ERROR: Token inválido o expirado'));
  }
};

module.exports = { socketAutenticacionIntermediario: socketAutenticacionIntermediario };
