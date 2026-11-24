'use strict';
const servicio = require("../services/rapidaAsignacionServicio");
const Conductor = require("../models/Conductor");
const Usuario = require("../models/Usuario");
const Vehiculo = require("../models/Vehiculo");
const UsuarioIdentidad = require("../models/UsuarioIdentidad");
const ViajeParada = require("../models/ViajeParada");
const { obtenerIo: obtenerIo } = require('../socket');
const { obtenerResumenCalificaciones } = require('../services/resumenCalificaciones');

const camposNombre = ['firstNames', 'paternalSurname', 'maternalSurname'];
const nombreCompleto = identidad => camposNombre.map(campo => identidad?.[campo]?.trim()).filter(Boolean).join(' ') || null;

async function detalles(viaje, usuarioId) {
  if (!viaje) return null;
  const conductor = await Conductor.findByPk(viaje.driverId, {
    attributes: ['userId']
  });
  if (viaje.passengerId !== usuarioId && conductor?.userId !== usuarioId) return null;
  const mostrarPasajero = conductor?.userId === usuarioId && viaje.status === 'solicitado';
  const mostrarConductor = !!conductor && viaje.passengerId === usuarioId && viaje.status !== 'solicitado';
  const [identidad, vehiculo, paradas, pasajero, resumenPasajero, resumenConductor] = await Promise.all([
  conductor ?
  UsuarioIdentidad.findOne({
    where: { userId: conductor.userId },
    attributes: camposNombre
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
  }),
  mostrarPasajero ? Usuario.findByPk(viaje.passengerId, {
    attributes: ['id', 'profilePhoto', 'nombreGoogle'],
    include: [{ association: 'identity', attributes: [...camposNombre, 'verificationStatus'], required: false }]
  }) : null,
  mostrarPasajero ? obtenerResumenCalificaciones(viaje.passengerId, 'pasajero') : null,
  mostrarConductor ? obtenerResumenCalificaciones(viaje.driverId, 'conductor') : null]
  );
  const [intentos] = mostrarPasajero ? await require('../config/baseDatos').query(
    "SELECT vence_en FROM public.oferta_viaje WHERE id_viaje = :id AND id_conductor = :conductor AND estado = 'pendiente'",
    { replacements: { id: viaje.id, conductor: viaje.driverId }, esquemaFisico: true }
  ) : [[]];
  const datos = viaje.toJSON();
  if (viaje.status === 'solicitado' && !mostrarPasajero) datos.driverId = null;
  return {
    ...datos,
    ...(mostrarPasajero && { venceOfertaEn: intentos[0]?.vence_en }),
    driverName: viaje.status === 'solicitado' && !mostrarPasajero ? null : nombreCompleto(identidad),
    ...(resumenConductor && { driverRating: resumenConductor.rating, driverTrips: resumenConductor.trips }),
    vehicle: viaje.status === 'solicitado' && !mostrarPasajero ? null : vehiculo,
    stops: paradas,
    ...(pasajero && {
      passenger: {
        name: pasajero.identity?.verificationStatus === 'verificado' ? nombreCompleto(pasajero.identity) : pasajero.nombreGoogle,
        photo: pasajero.profilePhoto || null,
        verified: pasajero.identity?.verificationStatus === 'verificado',
        ...resumenPasajero
      }
    })
  };
}
const rutaApi = (accion) => async (solicitud, respuesta) => {
  try {
    const viaje = await detalles(await accion(solicitud), solicitud.user.id);
    const ahora = Date.now();
    respuesta.json({
      ride: viaje,
      serverTime: new Date(ahora).toISOString(),
      segundosRestantes: viaje?.status === 'solicitado'
        ? Math.max(0, Math.ceil((new Date(viaje.venceOfertaEn ?? viaje.expiresAt).getTime() - ahora) / 1000))
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
  servicio.responderConductor(solicitud.params.rideId, solicitud.user.id, true)
  ),
  rechazar: rutaApi((solicitud) =>
    servicio.responderConductor(solicitud.params.rideId, solicitud.user.id, false)
  ),
  cancelar: rutaApi((solicitud) =>
  servicio.cancelarReserva(solicitud.user.id, solicitud.params.rideId)
  )
};
