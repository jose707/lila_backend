module.exports = (_req, res, next) => {
  if (process.env.FACE_LIVENESS_ENABLED === 'true') return next();
  return res.status(503).json({
    error: 'La prueba de vida está desactivada temporalmente; usa la captura de selfie del registro.',
  });
};
