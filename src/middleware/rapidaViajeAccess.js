'use strict';
const Viaje = require("../models/Viaje");
const Conductor = require("../models/Conductor");

// Legacy trip actions must also respect the assigned driver/passenger identities.
module.exports = (rol) => async (solicitud, respuesta, siguiente) => {
  try {
    const viaje = await Viaje.findByPk(solicitud.params.rideId || solicitud.params.id);
    if (!viaje || viaje.requestMode !== 'asignacion_rapida') return siguiente();
    const pasajero = viaje.passengerId === solicitud.user.id;
    const conductor = await Conductor.findOne({ where: { userId: solicitud.user.id } });
    const assigned = conductor?.id === viaje.driverId;
    if (
    !(rol === 'pasajero' ?
    pasajero :
    rol === 'conductor' ?
    assigned :
    pasajero || assigned))
    {
      return respuesta.status(403).json({ error: 'Este viaje no te pertenece.' });
    }
    return siguiente();
  } catch (error) {
    return siguiente(error);
  }
};
