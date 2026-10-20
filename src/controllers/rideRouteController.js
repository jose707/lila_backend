'use strict';

const Ride = require('../models/Ride');
const RideWaypoint = require('../models/RideWaypoint');
const Driver = require('../models/Driver');
const { drivingRoutePolyline } = require('../services/assignmentRouting');

const coordinates = geometry => {
  const [longitude, latitude] = geometry?.coordinates ?? [];
  if (![latitude, longitude].every(Number.isFinite)) return null;
  return { latitude, longitude };
};

async function getRideRoute(req, res) {
  try {
    const ride = await Ride.findByPk(req.params.rideId, {
      include: [{ model: RideWaypoint, as: 'waypoints', required: false }],
    });
    if (!ride) return res.status(404).json({ error: 'Viaje no encontrado.' });

    const isPassenger = ride.passengerId === req.user.id;
    const driver = !isPassenger && ride.driverId
      ? await Driver.findOne({ where: { id: ride.driverId, userId: req.user.id } })
      : null;
    if (!isPassenger && !driver)
      return res.status(403).json({ error: 'Este viaje no te pertenece.' });

    const stops = [...(ride.waypoints ?? [])].sort((a, b) => a.sequence - b.sequence);
    const points = [
      coordinates(ride.pickupLocation),
      ...stops.map(stop => coordinates(stop.location)),
      coordinates(ride.dropoffLocation),
    ];
    if (points.some(point => !point))
      return res.status(422).json({ error: 'El recorrido contiene ubicaciones inválidas.' });

    const polyline = await drivingRoutePolyline(points);
    return res.json({ polyline });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || 'No se pudo trazar el recorrido.',
      code: error.code || 'ROUTING_UNAVAILABLE',
    });
  }
}

module.exports = { getRideRoute };
