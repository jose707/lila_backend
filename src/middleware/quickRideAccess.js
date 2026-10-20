'use strict';
const Ride = require('../models/Ride');
const Driver = require('../models/Driver');

// Legacy trip actions must also respect the assigned driver/passenger identities.
module.exports = role => async (req, res, next) => {
  try {
    const ride = await Ride.findByPk(req.params.rideId || req.params.id);
    if (!ride || ride.requestMode !== 'quick_assignment') return next();
    const passenger = ride.passengerId === req.user.id;
    const driver = await Driver.findOne({ where: { userId: req.user.id } });
    const assigned = driver?.id === ride.driverId;
    if (
      !(role === 'passenger'
        ? passenger
        : role === 'driver'
        ? assigned
        : passenger || assigned)
    ) {
      return res.status(403).json({ error: 'Este viaje no te pertenece.' });
    }
    return next();
  } catch (error) {
    return next(error);
  }
};
