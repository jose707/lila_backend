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
    const latitud = Number(solicitud.query.latitude);
    const longitud = Number(solicitud.query.longitude);
    const radioKm = Number(solicitud.query.radiusKm ?? 5);
    if ([solicitud.query.latitude, solicitud.query.longitude].some(valor =>
      valor == null || String(valor).trim() === '') ||
      ![latitud, longitud, radioKm].every(Number.isFinite) ||
      Math.abs(latitud) > 90 || Math.abs(longitud) > 180 || radioKm <= 0) {
      return respuesta.status(400).json({
        success: false, message: 'Latitud, longitud o radio de búsqueda inválidos.'
      });
    }

    const conductores = await sequelize.query(`
      SELECT c.id_conductor, c.id_usuario,
        CONCAT_WS(' ', ci.nombres, ci.apellido_paterno, ci.apellido_materno) AS nombre,
        u.foto_perfil, ST_Y(uc.ubicacion) AS latitud, ST_X(uc.ubicacion) AS longitud,
        uc.rumbo, uc.velocidad, uc.conectado, uc.actualizado_en,
        ST_Distance(uc.ubicacion::geography,
          ST_SetSRID(ST_MakePoint(:longitud,:latitud),4326)::geography) AS distancia_metros
      FROM public.ubicacion_conductor uc
      JOIN public.conductor c ON uc.id_conductor = c.id_conductor
      JOIN public.usuario u ON c.id_usuario = u.id_usuario
      LEFT JOIN LATERAL (
        SELECT identidad.nombres, identidad.apellido_paterno, identidad.apellido_materno
        FROM public.usuario_documento vinculo
        JOIN public.documento_ci identidad ON identidad.id_documento_ci = vinculo.id_documento
        JOIN public.documento documento ON documento.id_documento = vinculo.id_documento
        WHERE vinculo.id_usuario = u.id_usuario AND documento.vigente = true
        ORDER BY documento.creado_en DESC, documento.id_documento
        LIMIT 1
      ) ci ON true
      WHERE uc.conectado = true
        AND ST_DWithin(uc.ubicacion::geography,
          ST_SetSRID(ST_MakePoint(:longitud,:latitud),4326)::geography,:radioMetros)
      ORDER BY distancia_metros ASC, c.id_conductor
    `, {
      type: sequelize.QueryTypes.SELECT,
      esquemaFisico: true,
      replacements: { latitud, longitud, radioMetros: radioKm * 1000 }
    });

    return respuesta.status(200).json({
      success: true,
      data: conductores.map(conductor => ({
        driver_id: conductor.id_conductor,
        driver_user_id: conductor.id_usuario,
        name: conductor.nombre,
        profile_photo: conductor.foto_perfil,
        latitude: parseFloat(conductor.latitud),
        longitude: parseFloat(conductor.longitud),
        heading: conductor.rumbo,
        speed: conductor.velocidad,
        is_online: conductor.conectado,
        distance_km: (conductor.distancia_metros / 1000).toFixed(2),
        updated_at: conductor.actualizado_en
      })),
      count: conductores.length,
      radius_km: radioKm
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
