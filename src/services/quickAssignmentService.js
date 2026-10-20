'use strict';
const { Op } = require('sequelize');
const sequelize = require('../config/database');
const Ride = require('../models/Ride');
const Driver = require('../models/Driver');
const User = require('../models/User');
const RideWaypoint = require('../models/RideWaypoint');
const { getIO } = require('../socket');
const routing = require('./assignmentRouting');
const {
  RADIUS_METERS,
  RESERVATION_SECONDS,
  LOCATION_MAX_AGE_SECONDS,
  ACTIVE_STATUSES,
  pickupSurcharge,
  roundMoney,
  fail,
  validatePoint,
} = require('./quickAssignmentPolicy');

async function publish(ride) {
  const driver = await Driver.findByPk(ride.driverId);
  const payload = {
    rideId: ride.id,
    status: ride.status,
    expiresAt: ride.expiresAt,
  };
  const io = getIO();
  io.to(`user:${ride.passengerId}`).emit('ride:assignment', payload);
  if (driver) io.to(`user:${driver.userId}`).emit('ride:assignment', payload);
  io.to(`ride:${ride.id}`).emit('ride:status:changed', payload);
}

async function expireReservations() {
  const [rows] =
    await sequelize.query(`UPDATE rides SET status = 'expired', updated_at = NOW()
    WHERE request_mode = 'quick_assignment' AND status = 'requested' AND expires_at <= clock_timestamp()
    RETURNING id, passenger_id AS "passengerId", driver_id AS "driverId", status, expires_at AS "expiresAt"`);
  await Promise.allSettled(rows.map(publish));
}

async function reserveOnce(passengerId, input, progress) {
  const {
    pickupLocation,
    dropoffLocation,
    vehicleTypeRequested,
    paymentMethod = 'cash',
    requestKey,
  } = input;
  const waypoints = input.waypoints ?? [];
  if (
    !validatePoint(pickupLocation) ||
    !validatePoint(dropoffLocation) ||
    !Array.isArray(waypoints) ||
    waypoints.length > 8 ||
    !waypoints.every(validatePoint) ||
    !['taxi', 'minibus', 'bus', 'motorcycle'].includes(vehicleTypeRequested) ||
    !['cash', 'qr'].includes(paymentMethod) ||
    typeof requestKey !== 'string' ||
    !/^[a-zA-Z0-9_-]{16,100}$/.test(requestKey)
  ) {
    throw fail(
      400,
      'Revisa origen, destino, vehículo, pago e identificador de solicitud.',
    );
  }
  await expireReservations();
  // Hold the passenger row to serialize retries and concurrent requests from multiple devices.
  const ride = await sequelize.transaction(async transaction => {
    await User.findByPk(passengerId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const previous = await Ride.findOne({
      where: { passengerId, requestKey },
      transaction,
    });
    if (previous) return previous;
    const active = await Ride.findOne({
      where: {
        passengerId,
        [Op.or]: [
          { status: { [Op.in]: ACTIVE_STATUSES } },
          {
            status: { [Op.in]: ['requested', 'offered'] },
            expiresAt: { [Op.gt]: new Date() },
          },
        ],
      },
      transaction,
    });
    if (active) {
      if (active.requestMode === 'quick_assignment') return active;
      throw fail(409, 'Ya tienes un viaje o solicitud activa.', 'ACTIVE_RIDE');
    }
    const [[area]] = await sequelize.query(
      `SELECT * FROM get_service_area(ST_SetSRID(ST_MakePoint(:lng,:lat),4326))`,
      {
        replacements: {
          lng: pickupLocation.longitude,
          lat: pickupLocation.latitude,
        },
        transaction,
      },
    );
    if (!area) {
      const [[{ count }]] = await sequelize.query(
        'SELECT COUNT(*) AS count FROM service_areas WHERE is_active = true',
        { transaction },
      );
      if (Number(count))
        throw fail(
          422,
          'El punto de recogida está fuera de cobertura.',
          'OUT_OF_SERVICE_AREA',
        );
    }
    progress('locating');
    const [candidates] = await sequelize.query(
      `SELECT d.id, ST_Y(dl.location) AS latitude, ST_X(dl.location) AS longitude
      FROM drivers d JOIN driver_locations dl ON dl.driver_id = d.id
      WHERE d.status = 'approved' AND d.deleted_at IS NULL AND d.user_id <> :passengerId
        AND dl.is_online = true AND dl.location_recorded_at > clock_timestamp() - make_interval(secs => :maxAge)
        AND EXISTS (SELECT 1 FROM vehicles v WHERE v.driver_id = d.id AND v.status = 'active'
          AND v.deleted_at IS NULL AND v.vehicle_type = :vehicleType)
        AND NOT EXISTS (SELECT 1 FROM rides r WHERE r.driver_id = d.id AND r.deleted_at IS NULL AND
          (r.status IN ('accepted','arrived','in_progress') OR (r.request_mode = 'quick_assignment' AND r.status = 'requested')))
        AND ST_DWithin(dl.location::geography, ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography, :radius)
      ORDER BY ST_Distance(dl.location::geography, ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography), d.id
      LIMIT 1 FOR UPDATE OF d SKIP LOCKED`,
      {
        replacements: {
          passengerId,
          maxAge: LOCATION_MAX_AGE_SECONDS,
          vehicleType: vehicleTypeRequested,
          lng: pickupLocation.longitude,
          lat: pickupLocation.latitude,
          radius: RADIUS_METERS,
        },
        transaction,
      },
    );
    const candidate = candidates[0];
    if (!candidate)
      throw fail(
        409,
        'No hay conductores disponibles dentro de 3 km.',
        'NO_DRIVERS',
      );
    progress('assigning');
    const trip = await routing.drivingRoute([
      pickupLocation,
      ...waypoints,
      dropoffLocation,
    ]);
    const pickup = await routing.drivingRoute([candidate, pickupLocation]);
    const baseFare = Number(area?.base_fare ?? 12);
    const farePerKm = Number(area?.fare_per_km ?? 0.5);
    const farePerMinute = Number(area?.fare_per_minute ?? 0.58);
    const totalFare = Math.round(
      baseFare +
        (trip.distance / 1000) * farePerKm +
        Math.ceil(trip.duration / 60) * farePerMinute,
    );
    const surcharge = pickupSurcharge(pickup.distance);
    const [[{ now }]] = await sequelize.query(
      'SELECT clock_timestamp() AS now',
      { transaction },
    );
    const point = value => ({
      type: 'Point',
      coordinates: [value.longitude, value.latitude],
    });
    const reserved = await Ride.create(
      {
        passengerId,
        driverId: candidate.id,
        requestMode: 'quick_assignment',
        requestKey,
        pickupLocation: point(pickupLocation),
        pickup_address: pickupLocation.address,
        dropoffLocation: point(dropoffLocation),
        dropoff_address: dropoffLocation.address,
        vehicle_type_requested: vehicleTypeRequested,
        paymentMethod,
        distance: trip.distance,
        duration: trip.duration,
        baseFare,
        farePerKm,
        farePerMinute,
        totalFare,
        finalFare: roundMoney(totalFare + surcharge),
        pickupDistance: pickup.distance,
        pickupDuration: pickup.duration,
        pickupSurcharge: surcharge,
        service_area_id: area?.id ?? null,
        status: 'requested',
        expiresAt: new Date(
          new Date(now).getTime() + RESERVATION_SECONDS * 1000,
        ),
      },
      { transaction },
    );
    if (waypoints.length)
      await RideWaypoint.bulkCreate(
        waypoints.map((wp, index) => ({
          ride_id: reserved.id,
          sequence: index + 1,
          location: point(wp),
          address: wp.address,
        })),
        { transaction },
      );
    // Old negotiation offers must no longer be selectable while this driver is reserved.
    await sequelize.query(
      `UPDATE ride_offers SET status = 'expired' WHERE driver_id = :id AND status = 'pending'`,
      {
        replacements: { id: candidate.id },
        transaction,
      },
    );
    return reserved;
  });
  await publish(ride).catch(error =>
    console.warn('Assignment notification:', error.message),
  );
  return ride;
}

async function current(userId, asDriver = false) {
  await expireReservations();
  const driver = asDriver ? await Driver.findOne({ where: { userId } }) : null;
  if (asDriver && !driver) return null;
  return Ride.findOne({
    where: {
      ...(asDriver ? { driverId: driver.id } : { passengerId: userId }),
      requestMode: 'quick_assignment',
      status: { [Op.in]: ['requested', ...ACTIVE_STATUSES] },
    },
    order: [['createdAt', 'DESC']],
  });
}

async function get(userId, id) {
  await expireReservations();
  const ride = await Ride.findByPk(id);
  if (!ride || ride.requestMode !== 'quick_assignment')
    throw fail(404, 'Reserva no encontrada.');
  if (ride.passengerId !== userId) {
    const driver = await Driver.findOne({ where: { userId } });
    if (!driver || driver.id !== ride.driverId)
      throw fail(403, 'Este viaje no te pertenece.');
  }
  return ride;
}

async function finishReservation(passengerId, id, confirm) {
  let newlyAssigned = false;
  const ride = await sequelize.transaction(async transaction => {
    const reserved = await Ride.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!reserved || reserved.requestMode !== 'quick_assignment')
      throw fail(404, 'Reserva no encontrada.');
    if (reserved.passengerId !== passengerId)
      throw fail(403, 'Este viaje no te pertenece.');
    if (reserved.status !== 'requested') return reserved; // Idempotent, never revive terminal states.
    const [[{ valid }]] = await sequelize.query(
      'SELECT :expires::timestamptz > clock_timestamp() AS valid',
      {
        replacements: { expires: reserved.expiresAt },
        transaction,
      },
    );
    let status = !valid ? 'expired' : confirm ? 'accepted' : 'cancelled';
    if (status === 'accepted') {
      const [available] = await sequelize.query(
        `SELECT d.id FROM drivers d JOIN driver_locations dl ON dl.driver_id = d.id
        WHERE d.id = :id AND d.status = 'approved' AND d.deleted_at IS NULL AND dl.is_online = true
          AND dl.location_recorded_at > clock_timestamp() - make_interval(secs => :maxAge)
          AND ST_DWithin(dl.location::geography, (SELECT pickup_location::geography FROM rides WHERE id = :rideId), :radius)
          AND EXISTS (SELECT 1 FROM vehicles v WHERE v.driver_id = d.id AND v.status = 'active'
            AND v.deleted_at IS NULL AND v.vehicle_type = :vehicleType)`,
        {
          replacements: {
            id: reserved.driverId,
            maxAge: LOCATION_MAX_AGE_SECONDS,
            radius: RADIUS_METERS,
            rideId: reserved.id,
            vehicleType: reserved.vehicle_type_requested,
          },
          transaction,
        },
      );
      if (!available.length) status = 'expired';
    }
    newlyAssigned = status === 'accepted';
    return reserved.update(
      {
        status,
        ...(newlyAssigned
          ? { acceptedAt: sequelize.literal('clock_timestamp()') }
          : {}),
        ...(status === 'cancelled'
          ? { cancelledBy: 'passenger', cancelledAt: new Date() }
          : {}),
      },
      { transaction },
    );
  });
  await publish(ride).catch(error =>
    console.warn('Assignment notification:', error.message),
  );
  if (newlyAssigned) {
    const { notify } = require('./notificationService');
    const driver = await Driver.findByPk(ride.driverId);
    if (driver)
      notify({
        userId: driver.userId,
        type: 'ride_accepted',
        title: 'Tienes un viaje asignado',
        body: 'El pasajero confirmó. Dirígete al punto de recogida.',
        data: { ride_id: ride.id },
      });
  }
  return ride;
}

async function reserve(
  passengerId,
  input,
  progress = () => {},
  { searchWindowMs = 5000, searchIntervalMs = 500 } = {},
) {
  const deadline = Date.now() + searchWindowMs;
  let busyDriverRetries = 0;
  for (;;) {
    try {
      return await reserveOnce(passengerId, input, progress);
    } catch (error) {
      if (error.code === 'NO_DRIVERS') {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw error;
        // Each failed attempt rolls back before waiting, so no database lock is held.
        await new Promise(resolve =>
          setTimeout(resolve, Math.min(searchIntervalMs, remaining)),
        );
        continue;
      }
      // A legacy acceptance can win between candidate selection and insertion.
      // Roll back and select again; the unique database index is the final arbiter.
      if (
        busyDriverRetries++ >= 2 ||
        error.original?.constraint !== 'rides_one_busy_driver'
      )
        throw error;
    }
  }
}
module.exports = {
  reserve,
  current,
  get,
  finishReservation,
  expireReservations,
};
