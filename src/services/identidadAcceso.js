const Viaje = require('../models/Viaje');
const LIMITE_VIAJES = 10;
async function accesoIdentidad(usuarioId, verificado) {
  const viajesCompletadosPasajero = await Viaje.count({ where: { passengerId: usuarioId, status: 'completado' } });
  return {
    viajesCompletadosPasajero,
    viajesRestantesSinVerificar: Math.max(0, LIMITE_VIAJES - viajesCompletadosPasajero),
    verificacionIdentidadRequerida: !verificado && viajesCompletadosPasajero >= LIMITE_VIAJES,
    recordarVerificacionIdentidad: !verificado && viajesCompletadosPasajero >= 8
  };
}

module.exports = { accesoIdentidad };
