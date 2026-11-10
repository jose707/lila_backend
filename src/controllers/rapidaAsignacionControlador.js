'use strict';
const servicio = require("../services/rapidaAsignacionServicio");
const Conductor = require("../models/Conductor");
const Vehiculo = require("../models/Vehiculo");
const UsuarioIdentidad = require("../models/UsuarioIdentidad");
const ViajeParada = require("../models/ViajeParada");
const { obtenerIo: obtenerIo } = require('../socket');
async function detalles(viaje) {
  if (!viaje) return null;
  const conductor = await Conductor.findByPk(viaje.driverId, {
    attributes: ['userId']
  });
  const [identidad, vehiculo, paradas] = await Promise.all([
  conductor ?
  UsuarioIdentidad.findOne({
    where: { userId: conductor.userId },
    attributes: ['firstNames', 'paternalSurname']
  }) :
  null,
  Vehiculo.findOne({
    where: {
      driver_id: viaje.driverId,
      status: 'activo',
      vehicle_type: viaje.vehicle_type_requested
    },
    attributes: ['brand', 'model', 'color', 'plate'],
    order: [['id', 'ASC']]
  }),
  ViajeParada.findAll({
    where: { ride_id: viaje.id },
    attributes: ['address', 'sequence'],
    order: [['sequence', 'ASC']]
  })]
  );
  return {
    ...viaje.toJSON(),
    driverName: identidad ?
    [identidad.firstNames, identidad.paternalSurname].
    filter(Boolean).
    join(' ') :
    'Conductor verificado',
    vehicle: vehiculo,
    stops: paradas
  };
}
const rutaApi = (accion) => async (solicitud, respuesta) => {
  try {
    const viaje = await detalles(await accion(solicitud));
    const ahora = Date.now();
    respuesta.json({
      ride: viaje,
      serverTime: new Date(ahora).toISOString(),
      segundosRestantes: viaje?.status === 'solicitado'
        ? Math.max(0, Math.ceil((new Date(viaje.expiresAt).getTime() - ahora) / 1000))
        : 0
    });
  } catch (error) {
    const conflict = ['23505', '23514', '40P01'].includes(error.original?.code);
    respuesta.status(error.status || (conflict ? 409 : 500)).json({
      error: error.status ?
      error.message :
      conflict ?
      'La disponibilidad cambió. Intenta de nuevo.' :
      'No se pudo procesar la asignación.',
      code:
      error.code || (conflict ? 'ASSIGNMENT_CONFLICT' : 'ASSIGNMENT_ERROR')
    });
    if (!error.status && !conflict)
    console.error('Quick assignment:', error.message);
  }
};
module.exports = {
  reservar: rutaApi((solicitud) =>
  servicio.reservar(solicitud.user.id, solicitud.body, (etapa) => {
    try {
      obtenerIo().
      to('user:' + solicitud.user.id).
      emit('ride:assignment:progress', {
        requestKey: solicitud.body.requestKey,
        stage: etapa
      });
    } catch {

      /* HTTP remains authoritative when sockets are unavailable. */}
  })
  ),
  actual: rutaApi((solicitud) =>
  servicio.actual(solicitud.user.id, solicitud.query.role === 'conductor')
  ),
  obtener: rutaApi((solicitud) => servicio.obtener(solicitud.user.id, solicitud.params.rideId)),
  confirmar: rutaApi((solicitud) =>
  servicio.finalizarReserva(solicitud.user.id, solicitud.params.rideId, true)
  ),
  cancelar: rutaApi((solicitud) =>
  servicio.finalizarReserva(solicitud.user.id, solicitud.params.rideId, false)
  )
};
