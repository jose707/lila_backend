module.exports = (_Solicitud, respuesta, siguiente) => {
  if (process.env.FACE_LIVENESS_ENABLED === 'true') return siguiente();
  return respuesta.status(503).json({
    error: 'La prueba de vida está desactivada temporalmente; usa la captura de selfie del registro.'
  });
};
