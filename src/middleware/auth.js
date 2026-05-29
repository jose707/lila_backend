// backend/src/middleware/auth.js
const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      console.warn('⚠️ Token no proporcionado en request');
      console.warn('   Headers:', Object.keys(req.headers));
      return res.status(401).json({
        error: 'Token no proporcionado',
        message: 'Agregue Authorization: Bearer <token> en los headers',
      });
    }

    console.log('🔐 Verificando token...');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    console.log('✅ Token válido para usuario:', decoded.id);
    req.user = decoded;
    next();
  } catch (error) {
    console.error('❌ Error en autenticación:', error.message);
    console.error(
      '   Token parcial:',
      req.headers.authorization?.substring(0, 50) + '...',
    );
    res.status(401).json({
      error: 'Token inválido o expirado',
      message: error.message,
    });
  }
};

const adminMiddleware = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'No tienes permisos de administrador',
    });
  }
  next();
};

const driverMiddleware = (req, res, next) => {
  if (req.user.role !== 'driver') {
    return res.status(403).json({
      error: 'Solo los conductores pueden acceder a este recurso',
    });
  }
  next();
};

module.exports = {
  authMiddleware,
  adminMiddleware,
  driverMiddleware,
};
