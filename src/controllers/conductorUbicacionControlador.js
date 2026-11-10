// backend/src/controllers/conductorUbicacionControlador.js
const { Conductor: Conductor, ConductorUbicacion: ConductorUbicacion, Viaje: Viaje } = require('../models');
const sequelize = require("../config/baseDatos");
const { registrarPunto } = require('../services/rutaRecorrida');

// El servicio nativo de seguimiento en primer plano usa esta ruta mientras React Native está en segundo plano.
// Cada actualización comprueba el viaje y el conductor para impedir que un servicio anterior
// siga enviando ubicaciones tras cancelar o finalizar el viaje, cerrar sesión o reasignar el viaje.
exports.actualizarUbicacionViajeActivo = async (solicitud, respuesta) => {
  try {
    const { latitude: latitud, longitude: longitud, heading: rumbo, speed: velocidad } = solicitud.body;
    if (![latitud, longitud].every(Number.isFinite) ||
    Math.abs(latitud) > 90 || Math.abs(longitud) > 180 ||
    rumbo != null && (!Number.isFinite(rumbo) || rumbo < 0 || rumbo >= 360) ||
    velocidad != null && (!Number.isFinite(velocidad) || velocidad < 0)) {
      return respuesta.status(400).json({ error: 'Ubicación inválida.' });
    }
    const conductor = await Conductor.findOne({ where: { userId: solicitud.user.id } });
    if (!conductor) return respuesta.status(403).json({ error: 'Conductor no encontrado.' });
    const viaje = await Viaje.findByPk(solicitud.params.rideId);
    if (!viaje || viaje.driverId !== conductor.id ||
    !['aceptado', 'llegado', 'en_curso'].includes(viaje.status)) {
      return respuesta.status(409).json({ error: 'El viaje ya no está activo.' });
    }

    const valores = {
      location_recorded_at: new Date(),
      location: sequelize.fn('ST_GeomFromText', `POINT(${longitud} ${latitud})`, 4326),
      ...(rumbo != null ? { heading: rumbo } : {}),
      ...(velocidad != null ? { speed: velocidad } : {})
    };
    const [ubicacion, creado] = await ConductorUbicacion.findCreateFind({
      where: { driver_id: conductor.id },
      defaults: { driver_id: conductor.id, heading: null, speed: null, ...valores, is_online: true }
    });
    if (!creado) await ubicacion.update(valores);
    await registrarPunto(viaje.id, conductor.id, latitud, longitud);

    const { obtenerIo: obtenerIo } = require('../socket');
    obtenerIo().to(`ride:${viaje.id}`).emit('driver:location:changed', {
      rideId: viaje.id,
      driverId: conductor.id,
      latitude: latitud,
      longitude: longitud,
      heading: rumbo ?? null,
      speed: velocidad ?? null,
      timestamp: new Date().toISOString()
    });
    return respuesta.json({ success: true });
  } catch (error) {
    console.error('Foreground ride location:', error);
    return respuesta.status(500).json({ error: 'No se pudo actualizar la ubicación.' });
  }
};

// Idempotent fallback for background transitions when the socket is already suspended.
exports.desconectarConductorActual = async (solicitud, respuesta) => {
  try {
    const conductor = await Conductor.findOne({ where: { userId: solicitud.user.id } });
    if (!conductor) return respuesta.status(403).json({ error: 'Conductor no encontrado.' });
    await ConductorUbicacion.update(
      { is_online: false },
      { where: { driver_id: conductor.id } }
    );
    const { obtenerIo: obtenerIo } = require('../socket');
    const io = obtenerIo();
    if (typeof io.in === 'function') {
      const sockets = await io.in(`user:${solicitud.user.id}`).fetchSockets();
      await Promise.all(sockets.map((socket) => socket.leave('drivers:available')));
    }
    return respuesta.json({ success: true });
  } catch (error) {
    console.error('Background driver offline:', error);
    return respuesta.status(500).json({ error: 'No se pudo desconectar al conductor.' });
  }
};

exports.actualizarUbicacion = async (solicitud, respuesta) => {
  try {
    const { driverId: conductorId, latitude: latitud, longitude: longitud, heading: rumbo, speed: velocidad, is_online: es_Conectado } =
    solicitud.body;

    // Validate required fields
    if (!conductorId || latitud === undefined || longitud === undefined) {
      return respuesta.status(400).json({
        success: false,
        message: 'Missing required fields: driverId, latitude, longitude'
      });
    }

    // Validate coordinates
    if (
    !Number.isFinite(latitud) || !Number.isFinite(longitud) ||
    latitud < -90 ||
    latitud > 90 ||
    longitud < -180 ||
    longitud > 180)
    {
      return respuesta.status(400).json({
        success: false,
        message:
        'Invalid coordinates. Latitude: -90 to 90, Longitude: -180 to 180'
      });
    }

    // Check if driver exists
    const conductor = await Conductor.findByPk(conductorId);
    if (!conductor) {
      return respuesta.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    const punto = sequelize.where(
      sequelize.fn('ST_GeomFromText', `POINT(${longitud} ${latitud})`, 4326),
      sequelize.col('location')
    );

    if (conductor.userId !== solicitud.user.id) {
      return respuesta.status(403).json({ error: 'No puedes modificar la ubicación de otro conductor.' });
    }

    const [ubicacion, creado] = await ConductorUbicacion.findCreateFind({
      where: { driver_id: conductorId },
      defaults: {
        driver_id: conductorId,
        location_recorded_at: new Date(),
        location: sequelize.fn(
          'ST_GeomFromText',
          `POINT(${longitud} ${latitud})`,
          4326
        ),
        heading: rumbo || null,
        speed: velocidad || null,
        is_online: es_Conectado !== undefined ? es_Conectado : true
      }
    });

    // If already exists, update it
    if (!creado) {
      ubicacion.location_recorded_at = new Date();
      ubicacion.location = sequelize.fn(
        'ST_GeomFromText',
        `POINT(${longitud} ${latitud})`,
        4326
      );
      if (rumbo !== undefined) ubicacion.heading = rumbo;
      if (velocidad !== undefined) ubicacion.speed = velocidad;
      if (es_Conectado !== undefined) ubicacion.is_online = es_Conectado;
      await ubicacion.save();
    }

    console.log(
      `✅ [driverLocationController] Location updated for driver ${conductorId}: (${latitud}, ${longitud})`
    );

    return respuesta.status(200).json({
      success: true,
      message: 'Location updated successfully',
      data: {
        driver_id: ubicacion.driver_id,
        latitude: latitud,
        longitude: longitud,
        heading: ubicacion.heading,
        speed: ubicacion.speed,
        is_online: ubicacion.is_online,
        updated_at: ubicacion.updated_at
      }
    });
  } catch (error) {
    console.error(
      '❌ [driverLocationController] Error updating location:',
      error
    );
    return respuesta.status(500).json({
      success: false,
      message: 'Error updating location',
      error: error.message
    });
  }
};

exports.obtenerUbicacionConductor = async (solicitud, respuesta) => {
  try {
    const { driverId: conductorId } = solicitud.params;

    const ubicacion = await ConductorUbicacion.findByPk(conductorId, {
      include: [
      {
        model: Conductor,
        as: 'driver',
        attributes: ['id', 'userId']
      }],

      raw: false
    });

    if (!ubicacion) {
      return respuesta.status(404).json({
        success: false,
        message: 'Driver location not found'
      });
    }

    // Extract coordinates from geometry
    const coordenadas = ubicacion.location?.coordinates;

    return respuesta.status(200).json({
      success: true,
      data: {
        driver_id: ubicacion.driver_id,
        latitude: coordenadas ? coordenadas[1] : null,
        longitude: coordenadas ? coordenadas[0] : null,
        heading: ubicacion.heading,
        speed: ubicacion.speed,
        is_online: ubicacion.is_online,
        updated_at: ubicacion.updated_at
      }
    });
  } catch (error) {
    console.error(
      '❌ [driverLocationController] Error fetching location:',
      error
    );
    return respuesta.status(500).json({
      success: false,
      message: 'Error fetching location',
      error: error.message
    });
  }
};

exports.obtenerConductoresCercanos = async (solicitud, respuesta) => {
  try {
    const { latitude: latitud, longitude: longitud, radiusKm: radioKm = 5 } = solicitud.query;

    if (!latitud || !longitud) {
      return respuesta.status(400).json({
        success: false,
        message: 'Missing required fields: latitude, longitude'
      });
    }

    // Convert radius to meters
    const radioMetros = radioKm * 1000;

    // Query drivers within radius using ST_DWithin
    const cercanoConductores = await sequelize.query(
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
          ST_GeomFromText('POINT(${longitud} ${latitud})', 4326)::geography
        ) as distance_meters
      FROM ubicacion_conductor dl
      JOIN conductor d ON dl.driver_id = d.id
      JOIN usuario u ON d."userId" = u.id
      LEFT JOIN documento_ci ui ON ui.user_id = u.id
      WHERE dl.is_online = true
      AND ST_DWithin(
        dl.location::geography,
        ST_GeomFromText('POINT(${longitud} ${latitud})', 4326)::geography,
        ${radioMetros}
      )
      ORDER BY distance_meters ASC
      `,
      { type: sequelize.QueryTypes.SELECT }
    );

    return respuesta.status(200).json({
      success: true,
      data: cercanoConductores.map((d) => ({
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
        updated_at: d.updated_at
      })),
      count: cercanoConductores.length,
      radius_km: parseFloat(radioKm)
    });
  } catch (error) {
    console.error(
      '❌ [driverLocationController] Error finding nearby drivers:',
      error
    );
    return respuesta.status(500).json({
      success: false,
      message: 'Error finding nearby drivers',
      error: error.message
    });
  }
};

exports.obtenerConductoresConectados = async (solicitud, respuesta) => {
  try {
    const ubicaciones = await ConductorUbicacion.findAll({
      where: { is_online: true },
      include: [
      {
        model: Conductor,
        as: 'driver',
        attributes: ['id', 'userId'],
        include: [
        {
          model: sequelize.models.User,
          as: 'user',
          attributes: ['id', 'name', 'profilePhoto']
        }]

      }],

      attributes: {
        exclude: ['location']
      },
      raw: false
    });

    const conductores = ubicaciones.map((ubicacion) => {
      const coordenadas = ubicacion.location?.coordinates;
      return {
        driver_id: ubicacion.driver_id,
        driver: ubicacion.driver,
        latitude: coordenadas ? coordenadas[1] : null,
        longitude: coordenadas ? coordenadas[0] : null,
        heading: ubicacion.heading,
        speed: ubicacion.speed,
        is_online: ubicacion.is_online,
        updated_at: ubicacion.updated_at
      };
    });

    return respuesta.status(200).json({
      success: true,
      data: conductores,
      count: conductores.length
    });
  } catch (error) {
    console.error(
      '❌ [driverLocationController] Error fetching online drivers:',
      error
    );
    return respuesta.status(500).json({
      success: false,
      message: 'Error fetching online drivers',
      error: error.message
    });
  }
};

exports.establecerConexionConductor = async (solicitud, respuesta) => {
  try {
    const { driverId: conductorId, is_online: es_Conectado } = solicitud.body;

    if (!conductorId || es_Conectado === undefined) {
      return respuesta.status(400).json({
        success: false,
        message: 'Missing required fields: driverId, is_online'
      });
    }

    const propietario = await Conductor.findOne({ where: { id: conductorId, userId: solicitud.user.id } });
    if (!propietario || typeof es_Conectado !== 'boolean') return respuesta.status(403).json({ error: 'Disponibilidad no autorizada.' });
    const ubicacion = await ConductorUbicacion.findByPk(conductorId);

    if (!ubicacion) {
      return respuesta.status(404).json({
        success: false,
        message: 'Driver location not found'
      });
    }

    ubicacion.is_online = es_Conectado;
    await ubicacion.save();

    console.log(
      `✅ [driverLocationController] Driver ${conductorId} online status set to ${es_Conectado}`
    );

    return respuesta.status(200).json({
      success: true,
      message: 'Driver online status updated successfully',
      data: {
        driver_id: ubicacion.driver_id,
        is_online: ubicacion.is_online
      }
    });
  } catch (error) {
    console.error(
      '❌ [driverLocationController] Error updating online status:',
      error
    );
    return respuesta.status(500).json({
      success: false,
      message: 'Error updating online status',
      error: error.message
    });
  }
};
