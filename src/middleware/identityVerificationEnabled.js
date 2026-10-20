module.exports = (_req, res, next) => {
  if (process.env.IDENTITY_VERIFICATION_ENABLED === 'true') return next();
  return res.status(503).json({
    error: 'El registro de CI y la prueba de vida están temporalmente desactivados.',
  });
};
