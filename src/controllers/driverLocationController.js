// backend/src/controllers/driverLocationController.js
const { Driver, DriverLocation, Ride } = require('../models');
const sequelize = require('../config/database');

// Native foreground tracking uses this endpoint while React Native is backgrounded.
// The ride and driver are checked on every update so an old service cannot keep
// tracking after cancellation, completion, logout, or reassignment.
exports.updateActiveRideLocation = async (req, res) => {
  try {
    const { latitude, longitude, heading, speed } = req.body;
    if (![latitude, longitude].every(Number.isFinite) ||
        Math.abs(latitude) > 90 || Math.abs(longitude) > 180 ||
        (heading != null && (!Number.isFinite(heading) || heading < 0 || heading >= 360)) ||
        (speed != null && (!Number.isFinite(speed) || speed < 0))) {
      return res.status(400).json({ error: 'Ubicación inválida.' });
    }
    const driver = await Driver.findOne({ where: { userId: req.user.id } });
    if (!driver) return res.status(403).json({ error: 'Conductor no encontrado.' });
    const ride = await Ride.findByPk(req.params.rideId);
    if (!ride || ride.driverId !== driver.id ||
        !['accepted', 'arrived', 'in_progress'].includes(ride.status)) {
      return res.status(409).json({ error: 'El viaje ya no está activo.' });
    }

    const values = {
      location_recorded_at: new Date(),
      location: sequelize.fn('ST_GeomFromText', `POINT(${longitude} ${latitude})`, 4326),
      ...(heading != null ? { heading } : {}),
      ...(speed != null ? { speed } : {}),
    };
    const [location, created] = await DriverLocation.findOrCreate({
      where: { driver_id: driver.id },
      defaults: { driver_id: driver.id, heading: null, speed: null, ...values, is_online: true },
    });
    if (!created) await location.update(values);

    const { getIO } = require('../socket');
    getIO().to(`ride:${ride.id}`).emit('driver:location:changed', {
      rideId: ride.id,
      driverId: driver.id,
      latitude,
      longitude,
      heading: heading ?? null,
      speed: speed ?? null,
      timestamp: new Date().toISOString(),
    });
    return res.json({ success: true });
  } catch (error) {
    console.error('Foreground ride location:', error);
    return res.status(500).json({ error: 'No se pudo actualizar la ubicación.' });
  }
};

// Idempotent fallback for background transitions when the socket is already suspended.
exports.setCurrentDriverOffline = async (req, res) => {
  try {
    const driver = await Driver.findOne({ where: { userId: req.user.id } });
    if (!driver) return res.status(403).json({ error: 'Conductor no encontrado.' });
    await DriverLocation.update(
      { is_online: false },
      { where: { driver_id: driver.id } },
    );
    const { getIO } = require('../socket');
    const io = getIO();
    if (typeof io.in === 'function') {
      const sockets = await io.in(`user:${req.user.id}`).fetchSockets();
      await Promise.all(sockets.map(socket => socket.leave('drivers:available')));
    }
    return res.json({ success: true });
  } catch (error) {
    console.error('Background driver offline:', error);
    return res.status(500).json({ error: 'No se pudo desconectar al conductor.' });
  }
};

exports.updateLocation = async (req, res) => {
  try {
    const { driverId, latitude, longitude, heading, speed, is_online } =
      req.body;

    // Validate required fields
    if (!driverId || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: driverId, latitude, longitude',
      });
    }

    // Validate coordinates
    if (
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid coordinates. Latitude: -90 to 90, Longitude: -180 to 180',
      });
    }

    // Check if driver exists
    const driver = await Driver.findByPk(driverId);
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
      });
    }

    const point = sequelize.where(
      sequelize.fn('ST_GeomFromText', `POINT(${longitude} ${latitude})`, 4326),
      sequelize.col('location'),
    );

    if (driver.userId !== req.user.id) {
      return res.status(403).json({ error: 'No puedes modificar la ubicación de otro conductor.' });
    }

    const [location, created] = await DriverLocation.findOrCreate({
      where: { driver_id: driverId },
      defaults: {
        driver_id: driverId,
        location_recorded_at: new Date(),
        location: sequelize.fn(
          'ST_GeomFromText',
          `POINT(${longitude} ${latitude})`,
          4326,
        ),
        heading: heading || null,
        speed: speed || null,
        is_online: is_online !== undefined ? is_online : true,
      },
    });

    // If already exists, update it
    if (!created) {
      location.location_recorded_at = new Date();
      location.location = sequelize.fn(
        'ST_GeomFromText',
        `POINT(${longitude} ${latitude})`,
        4326,
      );
      if (heading !== undefined) location.heading = heading;
      if (speed !== undefined) location.speed = speed;
      if (is_online !== undefined) location.is_online = is_online;
      await location.save();
    }

    console.log(
      `✅ [driverLocationController] Location updated for driver ${driverId}: (${latitude}, ${longitude})`,
    );

    return res.status(200).json({
      success: true,
      message: 'Location updated successfully',
      data: {
        driver_id: location.driver_id,
        latitude,
        longitude,
        heading: location.heading,
        speed: location.speed,
        is_online: location.is_online,
        updated_at: location.updated_at,
      },
    });
  } catch (error) {
    console.error(
      '❌ [driverLocationController] Error updating location:',
      error,
    );
    return res.status(500).json({
      success: false,
      message: 'Error updating location',
      error: error.message,
    });
  }
};

exports.getDriverLocation = async (req, res) => {
  try {
    const { driverId } = req.params;

    const location = await DriverLocation.findByPk(driverId, {
      include: [
        {
          model: Driver,
          as: 'driver',
          attributes: ['id', 'userId'],
        },
      ],
      raw: false,
    });

    if (!location) {
      return res.status(404).json({
        success: false,
        message: 'Driver location not found',
      });
    }

    // Extract coordinates from geometry
    const coordinates = location.location?.coordinates;

    return res.status(200).json({
      success: true,
      data: {
        driver_id: location.driver_id,
        latitude: coordinates ? coordinates[1] : null,
        longitude: coordinates ? coordinates[0] : null,
        heading: location.heading,
        speed: location.speed,
        is_online: location.is_online,
        updated_at: location.updated_at,
      },
    });
  } catch (error) {
    console.error(
      '❌ [driverLocationController] Error fetching location:',
      error,
    );
    return res.status(500).json({
      success: false,
      message: 'Error fetching location',
      error: error.message,
    });
  }
};

exports.getNearbyDrivers = async (req, res) => {
  try {
    const { latitude, longitude, radiusKm = 5 } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: latitude, longitude',
      });
    }

    // Convert radius to meters
    const radiusMeters = radiusKm * 1000;

    // Query drivers within radius using ST_DWithin
    const nearbyDrivers = await sequelize.query(
      `
      SELECT
        dl.driver_id,
        d.id,
        d."userId",
        CONCAT_WS(' ', ui.first_names, ui.paternal_surname, ui.maternal_surname) AS name,
        u."profilePhoto",
        ST_Y(dl.location) as latitude,
        ST_X(dl.location) as longitude,
        dl.heading,
        dl.speed,
        dl.is_online,
        dl.updated_at,
        ST_Distance(
          dl.location,
          ST_GeomFromText('POINT(${longitude} ${latitude})', 4326)::geography
        ) as distance_meters
      FROM driver_locations dl
      JOIN drivers d ON dl.driver_id = d.id
      JOIN users u ON d."userId" = u.id
      LEFT JOIN user_identities ui ON ui.user_id = u.id
      WHERE dl.is_online = true
      AND ST_DWithin(
        dl.location::geography,
        ST_GeomFromText('POINT(${longitude} ${latitude})', 4326)::geography,
        ${radiusMeters}
      )
      ORDER BY distance_meters ASC
      `,
      { type: sequelize.QueryTypes.SELECT },
    );

    return res.status(200).json({
      success: true,
      data: nearbyDrivers.map(d => ({
        driver_id: d.driver_id,
        driver_user_id: d.userId,
        name: d.name,
        profile_photo: d.profilePhoto,
        latitude: parseFloat(d.latitude),
        longitude: parseFloat(d.longitude),
        heading: d.heading,
        speed: d.speed,
        is_online: d.is_online,
        distance_km: (d.distance_meters / 1000).toFixed(2),
        updated_at: d.updated_at,
      })),
      count: nearbyDrivers.length,
      radius_km: parseFloat(radiusKm),
    });
  } catch (error) {
    console.error(
      '❌ [driverLocationController] Error finding nearby drivers:',
      error,
    );
    return res.status(500).json({
      success: false,
      message: 'Error finding nearby drivers',
      error: error.message,
    });
  }
};

exports.getOnlineDrivers = async (req, res) => {
  try {
    const locations = await DriverLocation.findAll({
      where: { is_online: true },
      include: [
        {
          model: Driver,
          as: 'driver',
          attributes: ['id', 'userId'],
          include: [
            {
              model: sequelize.models.User,
              as: 'user',
              attributes: ['id', 'name', 'profilePhoto'],
            },
          ],
        },
      ],
      attributes: {
        exclude: ['location'],
      },
      raw: false,
    });

    const drivers = locations.map(loc => {
      const coordinates = loc.location?.coordinates;
      return {
        driver_id: loc.driver_id,
        driver: loc.driver,
        latitude: coordinates ? coordinates[1] : null,
        longitude: coordinates ? coordinates[0] : null,
        heading: loc.heading,
        speed: loc.speed,
        is_online: loc.is_online,
        updated_at: loc.updated_at,
      };
    });

    return res.status(200).json({
      success: true,
      data: drivers,
      count: drivers.length,
    });
  } catch (error) {
    console.error(
      '❌ [driverLocationController] Error fetching online drivers:',
      error,
    );
    return res.status(500).json({
      success: false,
      message: 'Error fetching online drivers',
      error: error.message,
    });
  }
};

exports.setDriverOnlineStatus = async (req, res) => {
  try {
    const { driverId, is_online } = req.body;

    if (!driverId || is_online === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: driverId, is_online',
      });
    }

    const owner = await Driver.findOne({ where: { id: driverId, userId: req.user.id } });
    if (!owner || typeof is_online !== 'boolean') return res.status(403).json({ error: 'Disponibilidad no autorizada.' });
    const location = await DriverLocation.findByPk(driverId);

    if (!location) {
      return res.status(404).json({
        success: false,
        message: 'Driver location not found',
      });
    }

    location.is_online = is_online;
    await location.save();

    console.log(
      `✅ [driverLocationController] Driver ${driverId} online status set to ${is_online}`,
    );

    return res.status(200).json({
      success: true,
      message: 'Driver online status updated successfully',
      data: {
        driver_id: location.driver_id,
        is_online: location.is_online,
      },
    });
  } catch (error) {
    console.error(
      '❌ [driverLocationController] Error updating online status:',
      error,
    );
    return res.status(500).json({
      success: false,
      message: 'Error updating online status',
      error: error.message,
    });
  }
};
