'use strict';

const Viaje = require("../models/Viaje");
const ViajeParada = require("../models/ViajeParada");
const Conductor = require("../models/Conductor");
const ConductorUbicacion = require('../models/ConductorUbicacion');
const { conduccionRutaDetalle } = require("../services/asignacionRouting");

const coordenadas = (geometria) => {
  const [longitud, latitud] = geometria?.coordinates ?? [];
  if (![latitud, longitud].every(Number.isFinite)) return null;
  return { latitude: latitud, longitude: longitud };
};

async function obtenerViajeRuta(solicitud, respuesta) {
  try {
    const viaje = await Viaje.findByPk(solicitud.params.rideId, {
      include: [{ model: ViajeParada, as: 'waypoints', required: false }]
    });
    if (!viaje) return respuesta.status(404).json({ error: 'Viaje no encontrado.' });

    const esPasajero = viaje.passengerId === solicitud.user.id;
    const conductor = !esPasajero && viaje.driverId ?
    await Conductor.findOne({ where: { id: viaje.driverId, userId: solicitud.user.id } }) :
    null;
    if (!esPasajero && !conductor)
    return respuesta.status(403).json({ error: 'Este viaje no te pertenece.' });

    const viajeEnCurso = viaje.status === 'en_curso';
    const haciaRecogida = solicitud.query?.recogida === '1';
    if (haciaRecogida && (viaje.status !== 'aceptado' || !viaje.driverId))
      return respuesta.status(409).json({ error: 'El conductor no está en camino a la recogida.' });
    if (solicitud.query?.recalcular === '1' && !viajeEnCurso)
      return respuesta.status(409).json({ error: 'El viaje no está en curso.' });
    let origen = coordenadas(viaje.pickupLocation);
    if (viajeEnCurso || haciaRecogida) {
      const ubicacion = await ConductorUbicacion.findByPk(viaje.driverId);
      origen = coordenadas(ubicacion?.location);
      const registrada = new Date(ubicacion?.location_recorded_at).getTime();
      if (!origen || !Number.isFinite(registrada) || Date.now() - registrada > 60000)
        return respuesta.status(409).json({ error: 'No hay una ubicación reciente del conductor.' });
    }
    const paradas = [...(viaje.waypoints ?? [])]
      .filter((parada) => !viajeEnCurso || !parada.arrived_at && !parada.departed_at)
      .sort((primero, segundo) => primero.sequence - segundo.sequence);
    const puntos = haciaRecogida ? [origen, coordenadas(viaje.pickupLocation)] : [
    origen,
    ...paradas.map((parada) => coordenadas(parada.location)),
    coordenadas(viaje.dropoffLocation)];

    if (puntos.some((punto) => !punto))
    return respuesta.status(422).json({ error: 'El recorrido contiene ubicaciones inválidas.' });

    return respuesta.json(await conduccionRutaDetalle(puntos));
  } catch (error) {
    return respuesta.status(error.status || 500).json({
      error: error.message || 'No se pudo trazar el recorrido.',
      code: error.code || 'ROUTING_UNAVAILABLE'
    });
  }
}

async function obtenerRutaPrevia(solicitud, respuesta) {
  const puntos = solicitud.body?.puntos;
  if (!Array.isArray(puntos) || puntos.length < 2 || puntos.length > 10 ||
    puntos.some(punto => !punto || !Number.isFinite(punto.latitude) || !Number.isFinite(punto.longitude) ||
      Math.abs(punto.latitude) > 90 || Math.abs(punto.longitude) > 180)) {
    return respuesta.status(400).json({ error: 'Selecciona un origen, un destino y hasta ocho paradas válidas.' });
  }
  try {
    const ruta = await conduccionRutaDetalle(puntos);
    if (!Number.isFinite(ruta.distance) || !Number.isFinite(ruta.duration)) {
      return respuesta.status(503).json({ error: 'No se pudo calcular la distancia y duración del recorrido.' });
    }
    return respuesta.json(ruta);
  } catch (error) {
    return respuesta.status(error.status || 500).json({
      error: error.status ? error.message : 'No se pudo calcular la ruta.',
      code: error.code || 'ROUTING_UNAVAILABLE'
    });
  }
}

module.exports = { obtenerViajeRuta, obtenerRutaPrevia };
