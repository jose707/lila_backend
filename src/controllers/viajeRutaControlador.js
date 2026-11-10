'use strict';

const Viaje = require("../models/Viaje");
const ViajeParada = require("../models/ViajeParada");
const Conductor = require("../models/Conductor");
const ConductorUbicacion = require('../models/ConductorUbicacion');
const { conduccionRutaPolilinea: conduccionRutaPolilinea } = require("../services/asignacionRouting");

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

    const recalcular = solicitud.query?.recalcular === '1';
    let origen = coordenadas(viaje.pickupLocation);
    if (recalcular) {
      if (viaje.status !== 'en_curso')
        return respuesta.status(409).json({ error: 'El viaje no está en curso.' });
      const ubicacion = await ConductorUbicacion.findByPk(viaje.driverId);
      origen = coordenadas(ubicacion?.location);
      const registrada = new Date(ubicacion?.location_recorded_at).getTime();
      if (!origen || !Number.isFinite(registrada) || Date.now() - registrada > 60000)
        return respuesta.status(409).json({ error: 'No hay una ubicación reciente del conductor.' });
    }
    const paradas = [...(viaje.waypoints ?? [])]
      .filter((parada) => !recalcular || !parada.arrived_at && !parada.departed_at)
      .sort((primero, segundo) => primero.sequence - segundo.sequence);
    const puntos = [
    origen,
    ...paradas.map((parada) => coordenadas(parada.location)),
    coordenadas(viaje.dropoffLocation)];

    if (puntos.some((punto) => !punto))
    return respuesta.status(422).json({ error: 'El recorrido contiene ubicaciones inválidas.' });

    const polilinea = await conduccionRutaPolilinea(puntos);
    return respuesta.json({ polyline: polilinea });
  } catch (error) {
    return respuesta.status(error.status || 500).json({
      error: error.message || 'No se pudo trazar el recorrido.',
      code: error.code || 'ROUTING_UNAVAILABLE'
    });
  }
}

module.exports = { obtenerViajeRuta: obtenerViajeRuta };
