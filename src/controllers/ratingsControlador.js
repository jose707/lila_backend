// backend/src/controllers/ratingsControlador.js
const { Calificacion: Calificacion, Viaje: Viaje, Conductor: Conductor, Usuario: Usuario } = require('../models');

const { obtenerResumenCalificaciones } = require('../services/resumenCalificaciones');

const calcularConSemilla = filas => {
  const suma = filas.reduce((total, fila) => total + (Number(fila.rating) || 0), 5);
  return Math.round(suma / (filas.length + 1) * 10) / 10;
};

// Los participantes se obtienen del viaje; se conservan en las respuestas de la API.
const serializarCalificacion = (calificacion, viaje = calificacion.ride) => {
  const datos = calificacion.toJSON();
  return {
    ...datos,
    driverId: viaje?.driverId,
    passengerId: viaje?.passengerId,
    ...(viaje?.passenger ? { passenger: viaje.passenger.toJSON() } : {})
  };
};

// Create a new rating
const crearCalificacion = async (solicitud, respuesta) => {
  try {
    const { rideId: viajeId, rating: calificacion, comment, raterType = 'pasajero' } = solicitud.body;
    if (!Number.isFinite(calificacion) || calificacion < 1 || calificacion > 5) {
      return respuesta.status(400).json({ error: 'La calificación debe estar entre 1 y 5' });
    }
    if (!['pasajero', 'conductor'].includes(raterType)) {
      return respuesta.status(400).json({ error: 'Tipo de calificador inválido' });
    }
    const viaje = await Viaje.findByPk(viajeId, {
      include: [{ model: Conductor, as: 'driver', attributes: ['userId'] }]
    });
    if (!viaje) return respuesta.status(404).json({ error: 'Viaje no encontrado' });
    if (viaje.status !== 'completado' || !viaje.driverId) {
      return respuesta.status(400).json({ error: 'Solo se pueden calificar viajes completados con conductor asignado' });
    }
    const autorId = raterType === 'pasajero' ? viaje.passengerId : viaje.driver?.userId;
    if (!solicitud.user?.id || solicitud.user.id !== autorId) {
      return respuesta.status(403).json({ error: 'No puedes calificar este viaje con ese rol' });
    }
    const nuevaCalificacion = await Calificacion.create({
      rideId: viaje.id,
      rating: calificacion,
      comment: comment || null,
      raterType
    });
    return respuesta.status(201).json({
      message: 'Rating creado exitosamente',
      rating: serializarCalificacion(nuevaCalificacion, viaje)
    });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return respuesta.status(409).json({ error: 'Ya calificaste este viaje' });
    }
    console.error('❌ [createRating] Error:', error);
    respuesta.status(500).json({
      error: 'Error al crear rating',
      details: error.message
    });
  }
};

// Get ratings for a driver
const obtenerConductorCalificaciones = async (solicitud, respuesta) => {
  try {
    const { driverId: conductorId } = solicitud.params;
    const { limit: limite = 10, offset: desplazamiento = 0 } = solicitud.query;

    const calificaciones = await Calificacion.findAndCountAll({
      where: { raterType: 'pasajero' },
      include: [{
        model: Viaje,
        as: 'ride',
        required: true,
        paranoid: false,
        where: { driverId: conductorId },
        attributes: ['id', 'driverId', 'passengerId', 'pickupLocation', 'dropoffLocation'],
        include: [{ model: Usuario, as: 'passenger', attributes: ['id', 'name', 'profilePhoto'] }]
      }],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limite),
      offset: parseInt(desplazamiento)
    });

    respuesta.status(200).json({
      total: calificaciones.count,
      limit: parseInt(limite),
      offset: parseInt(desplazamiento),
      ratings: calificaciones.rows.map(calificacion => serializarCalificacion(calificacion))
    });
  } catch (error) {
    console.error('❌ [getDriverRatings] Error:', error);
    respuesta.status(500).json({
      error: 'Error al obtener ratings',
      details: error.message
    });
  }
};

// Get driver's average rating
const obtenerConductorPromedioCalificacion = async (solicitud, respuesta) => {
  try {
    const { driverId: conductorId } = solicitud.params;

    const conductor = await Conductor.findByPk(conductorId);
    if (!conductor) {
      return respuesta.status(404).json({
        error: 'Conductor no encontrado'
      });
    }

    const calificaciones = await Calificacion.findAll({
      where: { raterType: 'pasajero' },
      attributes: ['rating'],
      include: [{ model: Viaje, as: 'ride', required: true, paranoid: false,
        where: { driverId: conductorId }, attributes: [] }]
    });

    respuesta.status(200).json({
      driverId: conductorId,
      averageRating: calcularConSemilla(calificaciones),
      totalRatings: calificaciones.length
    });
  } catch (error) {
    console.error('❌ [getDriverAverageRating] Error:', error);
    respuesta.status(500).json({
      error: 'Error al obtener promedio de rating',
      details: error.message
    });
  }
};

// Check if a rating already exists for a ride
const comprobarCalificacionExiste = async (solicitud, respuesta) => {
  try {
    const { rideId: viajeId } = solicitud.params;

    const calificacion = await Calificacion.findOne({
      where: { rideId: viajeId },
      include: [{ model: Viaje, as: 'ride', paranoid: false, attributes: ['id', 'driverId', 'passengerId'] }]
    });

    respuesta.status(200).json({
      exists: !!calificacion,
      rating: calificacion ? serializarCalificacion(calificacion) : null
    });
  } catch (error) {
    console.error('❌ [checkRatingExists] Error:', error);
    respuesta.status(500).json({
      error: 'Error al verificar rating',
      details: error.message
    });
  }
};

/**
 * Obtener el rating calculado del usuario autenticado
 * GET /calificaciones/mias
 * Devuelve driverRating (si es conductor) y passengerRating
 */
const obtenerMiCalificacion = async (solicitud, respuesta) => {
  try {
    const usuarioId = solicitud.user?.id;
    if (!usuarioId) {
      return respuesta.status(401).json({ error: 'Usuario no autenticado' });
    }

    const [pasajero, conductor] = await Promise.all([
      obtenerResumenCalificaciones(usuarioId, 'pasajero'),
      Conductor.findOne({ where: { userId: usuarioId }, attributes: ['id'] })
    ]);
    const resumenConductor = conductor ? await obtenerResumenCalificaciones(conductor.id, 'conductor') : null;

    respuesta.status(200).json({
      passengerRating: pasajero.rating,
      driverRating: resumenConductor?.rating ?? null,
      driverId: conductor?.id ?? null,
      passengerTrips: pasajero.trips,
      driverTrips: resumenConductor?.trips ?? 0
    });
  } catch (error) {
    console.error('❌ [getMyRating] Error:', error);
    respuesta.
    status(500).
    json({ error: 'Error al obtener rating', details: error.message });
  }
};

module.exports = {
  crearCalificacion: crearCalificacion,
  obtenerCalificacionesConductor: obtenerConductorCalificaciones,
  obtenerPromedioCalificacionesConductor: obtenerConductorPromedioCalificacion,
  comprobarCalificacionExistente: comprobarCalificacionExiste,
  obtenerMiCalificacion: obtenerMiCalificacion
};
