// backend/src/controllers/ratingsController.js
const { Rating, Ride, Driver, User } = require('../models');
const { sequelize } = require('../config/database');

// Create a new rating
const createRating = async (req, res) => {
  try {
    const { rideId, driverId, passengerId, rating, comment, raterType } =
      req.body;

    console.log('📥 [createRating] Body recibido:', {
      rideId,
      driverId,
      passengerId,
      rating,
      raterType,
    });

    // Validar que el rating esté entre 0 y 5
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        error: 'Rating debe estar entre 0 y 5',
      });
    }

    // Verificar que la solicitud existe
    const ride = await Ride.findByPk(rideId);
    if (!ride) {
      return res.status(404).json({
        error: 'Solicitud no encontrada',
      });
    }

    // Crear rating
    const newRating = await Rating.create({
      rideId,
      driverId,
      passengerId,
      rating,
      comment: comment || null,
      raterType: raterType || 'passenger',
    });

    console.log('✅ [createRating] Rating creado:', {
      ratingId: newRating.id,
      rideId,
      driverId,
      rating,
    });

    // Actualizar promedio de rating del conductor
    // rating del conductor se calcula desde la tabla ratings en tiempo real
    // (no se almacena en drivers — ver dataBase.md campos calculados)
    const driverRatings = await Rating.findAll({
      where: { driverId, raterType: 'passenger' },
      attributes: ['rating'],
    });

    // El 5 inicial siempre se incluye como calificación semilla.
    // 0 reales → 5.0 | 1 real de 4 → (5+4)/2 = 4.5 | 2 reales 4,3 → (5+4+3)/3 = 4.0
    const seedRating = 5;
    const total = driverRatings.length + 1;
    const sum = driverRatings.reduce(
      (acc, r) => acc + (r.rating || 0),
      seedRating,
    );
    const averageRating = Math.round((sum / total) * 10) / 10;

    res.status(201).json({
      message: 'Rating creado exitosamente',
      rating: newRating,
    });
  } catch (error) {
    console.error('❌ [createRating] Error:', error);
    res.status(500).json({
      error: 'Error al crear rating',
      details: error.message,
    });
  }
};

// Get ratings for a driver
const getDriverRatings = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { limit = 10, offset = 0 } = req.query;

    const ratings = await Rating.findAndCountAll({
      where: { driverId },
      include: [
        {
          model: User,
          as: 'passenger',
          attributes: ['id', 'name', 'profilePhoto'],
        },
        {
          model: Ride,
          as: 'ride',
          attributes: ['id', 'pickupLocation', 'dropoffLocation'],
        },
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    res.status(200).json({
      total: ratings.count,
      limit: parseInt(limit),
      offset: parseInt(offset),
      ratings: ratings.rows,
    });
  } catch (error) {
    console.error('❌ [getDriverRatings] Error:', error);
    res.status(500).json({
      error: 'Error al obtener ratings',
      details: error.message,
    });
  }
};

// Get driver's average rating
const getDriverAverageRating = async (req, res) => {
  try {
    const { driverId } = req.params;

    const driver = await Driver.findByPk(driverId);
    if (!driver) {
      return res.status(404).json({
        error: 'Conductor no encontrado',
      });
    }

    const totalRatings = await Rating.count({
      where: { driverId },
    });

    res.status(200).json({
      driverId,
      averageRating: driver.rating,
      totalRatings,
    });
  } catch (error) {
    console.error('❌ [getDriverAverageRating] Error:', error);
    res.status(500).json({
      error: 'Error al obtener promedio de rating',
      details: error.message,
    });
  }
};

// Check if a rating already exists for a ride
const checkRatingExists = async (req, res) => {
  try {
    const { rideId } = req.params;

    const rating = await Rating.findOne({
      where: { rideId },
    });

    res.status(200).json({
      exists: !!rating,
      rating: rating || null,
    });
  } catch (error) {
    console.error('❌ [checkRatingExists] Error:', error);
    res.status(500).json({
      error: 'Error al verificar rating',
      details: error.message,
    });
  }
};

/**
 * Obtener el rating calculado del usuario autenticado
 * GET /ratings/me
 * Devuelve driverRating (si es conductor) y passengerRating
 */
const getMyRating = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Usuario no autenticado' });
    }

    const sequelize = require('../config/database');

    // Fórmula con semilla: (5 + suma) / (1 + cantidad)
    const calcWithSeed = rows => {
      const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
      const seed = 5;
      const total = list.length + 1;
      const sum = list.reduce(
        (acc, r) => acc + (parseFloat(r.rating) || 0),
        seed,
      );
      return Math.round((sum / total) * 10) / 10;
    };

    // Rating del pasajero (calificaciones hechas por conductores)
    const [passengerRows] = await sequelize.query(
      `SELECT rating FROM ratings WHERE passenger_id = :userId AND rater_type = 'driver'`,
      { replacements: { userId } },
    );
    const passengerRating = calcWithSeed(passengerRows);

    // Viajes completados como pasajero
    const [passengerTripRows] = await sequelize.query(
      `SELECT COUNT(*) as total FROM rides WHERE passenger_id = :userId AND status = 'completed'`,
      { replacements: { userId } },
    );
    const passengerTrips = parseInt(passengerTripRows?.[0]?.total || 0, 10);

    // Rating del conductor (calificaciones hechas por pasajeros)
    let driverRating = null;
    let driverId = null;
    let driverTrips = 0;
    const driverRecord = await Driver.findOne({ where: { userId } });
    if (driverRecord) {
      driverId = driverRecord.id;
      const [driverRows] = await sequelize.query(
        `SELECT rating FROM ratings WHERE driver_id = :driverId AND rater_type = 'passenger'`,
        { replacements: { driverId } },
      );
      driverRating = calcWithSeed(driverRows);

      // Viajes completados como conductor
      const [driverTripRows] = await sequelize.query(
        `SELECT COUNT(*) as total FROM rides WHERE driver_id = :driverId AND status = 'completed'`,
        { replacements: { driverId } },
      );
      driverTrips = parseInt(driverTripRows?.[0]?.total || 0, 10);
    }

    res.status(200).json({
      passengerRating,
      driverRating,
      driverId,
      passengerTrips,
      driverTrips,
    });
  } catch (error) {
    console.error('❌ [getMyRating] Error:', error);
    res
      .status(500)
      .json({ error: 'Error al obtener rating', details: error.message });
  }
};

module.exports = {
  createRating,
  getDriverRatings,
  getDriverAverageRating,
  checkRatingExists,
  getMyRating,
};
