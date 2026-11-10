module.exports = (_Solicitud, respuesta, siguiente) => {
  if (process.env.IDENTITY_VERIFICATION_ENABLED === 'true') return siguiente();
  return respuesta.status(503).json({
    error: 'El registro de CI y la prueba de vida están temporalmente desactivados.'
  });
};
