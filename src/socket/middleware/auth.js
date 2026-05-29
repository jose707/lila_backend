const jwt = require('jsonwebtoken');

const socketAuthMiddleware = (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.split(' ')[1];

    if (!token) {
      return next(new Error('AUTH_ERROR: Token no proporcionado'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    socket.user = decoded;
    next();
  } catch (error) {
    next(new Error('AUTH_ERROR: Token inválido o expirado'));
  }
};

module.exports = { socketAuthMiddleware };
