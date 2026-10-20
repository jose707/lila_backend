'use strict';
const service = require('../services/quickAssignmentService');
const Driver = require('../models/Driver');
const Vehicle = require('../models/Vehicle');
const UserIdentity = require('../models/UserIdentity');
const RideWaypoint = require('../models/RideWaypoint');
const { getIO } = require('../socket');
async function details(ride) {
  if (!ride) return null;
  const driver = await Driver.findByPk(ride.driverId, {
    attributes: ['userId'],
  });
  const [identity, vehicle, stops] = await Promise.all([
    driver
      ? UserIdentity.findOne({
          where: { userId: driver.userId },
          attributes: ['firstNames', 'paternalSurname'],
        })
      : null,
    Vehicle.findOne({
      where: {
        driver_id: ride.driverId,
        status: 'active',
        vehicle_type: ride.vehicle_type_requested,
      },
      attributes: ['brand', 'model', 'color', 'plate'],
      order: [['id', 'ASC']],
    }),
    RideWaypoint.findAll({
      where: { ride_id: ride.id },
      attributes: ['address', 'sequence'],
      order: [['sequence', 'ASC']],
    }),
  ]);
  return {
    ...ride.toJSON(),
    driverName: identity
      ? [identity.firstNames, identity.paternalSurname]
          .filter(Boolean)
          .join(' ')
      : 'Conductor verificado',
    vehicle,
    stops,
  };
}
const endpoint = action => async (req, res) => {
  try {
    const ride = await action(req);
    res.json({
      ride: await details(ride),
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    const conflict = ['23505', '23514', '40P01'].includes(error.original?.code);
    res.status(error.status || (conflict ? 409 : 500)).json({
      error: error.status
        ? error.message
        : conflict
        ? 'La disponibilidad cambió. Intenta de nuevo.'
        : 'No se pudo procesar la asignación.',
      code:
        error.code || (conflict ? 'ASSIGNMENT_CONFLICT' : 'ASSIGNMENT_ERROR'),
    });
    if (!error.status && !conflict)
      console.error('Quick assignment:', error.message);
  }
};
module.exports = {
  reserve: endpoint(req =>
    service.reserve(req.user.id, req.body, stage => {
      try {
        getIO()
          .to('user:' + req.user.id)
          .emit('ride:assignment:progress', {
            requestKey: req.body.requestKey,
            stage,
          });
      } catch {
        /* HTTP remains authoritative when sockets are unavailable. */
      }
    }),
  ),
  current: endpoint(req =>
    service.current(req.user.id, req.query.role === 'driver'),
  ),
  get: endpoint(req => service.get(req.user.id, req.params.rideId)),
  confirm: endpoint(req =>
    service.finishReservation(req.user.id, req.params.rideId, true),
  ),
  cancel: endpoint(req =>
    service.finishReservation(req.user.id, req.params.rideId, false),
  ),
};
