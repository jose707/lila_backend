// backend/src/utils/auxiliarToken.js
const jwt = require('jsonwebtoken');

const generarToken = (usuario) => {
  return jwt.sign(
    {
      id: usuario.id,
      email: usuario.email,
      role: usuario.role,
      name: usuario.name
    },
    process.env.JWT_SECRET || 'secret',
    {
      expiresIn: process.env.JWT_EXPIRE || '7d'
    }
  );
};

const verificarToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'secret');
  } catch (error) {
    return null;
  }
};

const decodificarToken = (token) => {
  return jwt.decode(token);
};

module.exports = {
  generarToken,
  verificarToken,
  decodificarToken
};
