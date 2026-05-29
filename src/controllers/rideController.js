// backend/src/controllers/rideController.js

/**

 * @param {string} id - driverId (para role='driver') o passengerId (para role='passenger')
 * @param {'passenger'|'driver'} role
 * @returns {Promise<number>}
 */
async function calcRating(id, role) {
  if (!id) return 5;
  try {
    const { sequelize } = require('../models');

    const raterType = role === 'driver' ? 'passenger' : 'driver';
    const idColumn = role === 'driver' ? 'driver_id' : 'passenger_id';

    const [rows] = await sequelize.query(
      `SELECT rating FROM ratings WHERE ${idColumn} = :id AND rater_type = :raterType`,
      { replacements: { id, raterType } },
    );

    const list = Array.isArray(rows) ? rows : rows ? [rows] : [];

    const seedRating = 5;
    const total = list.length + 1;
    const sum = list.reduce(
      (acc, r) => acc + (parseFloat(r.rating) || 0),
      seedRating,
    );
    return Math.round((sum / total) * 10) / 10;
  } catch {
    return 5;
  }
}

const Ride = require('../models/Ride');
const User = require('../models/User');
const Driver = require('../models/Driver');
const PromoCode = require('../models/PromoCode');
const DriverEarning = require('../models/DriverEarning');
const { Op } = require('sequelize');
const { sequelize } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { getIO } = require('../socket');

const createRide = async (req, res) => {
  try {
    const {
      pickupLocation,
      dropoffLocation,
      distance,
      duration,
      fare,
      vehicleTypeRequested,
      paymentMethod,
      promoCode,
    } = req.body;
    const passengerId = req.user.id;

    // ── Validar coordenadas ────────────────────────────────────────────
    if (
      !pickupLocation?.latitude ||
      !pickupLocation?.longitude ||
      !pickupLocation?.address
    ) {
      return res.status(400).json({
        error:
          'pickupLocation inválida. Debe tener latitude, longitude y address',
      });
    }
    if (
      !dropoffLocation?.latitude ||
      !dropoffLocation?.longitude ||
      !dropoffLocation?.address
    ) {
      return res.status(400).json({
        error:
          'dropoffLocation inválida. Debe tener latitude, longitude y address',
      });
    }
    if (!distance || !duration) {
      return res
        .status(400)
        .json({ error: 'Faltan datos requeridos: distance, duration' });
    }

    const finalDistance = parseFloat(distance);
    const finalDuration = Math.round(parseFloat(duration));
    const pickupLng = parseFloat(pickupLocation.longitude);
    const pickupLat = parseFloat(pickupLocation.latitude);

    // ── Validar zona de servicio ──────────────────────────────────────
    // Una sola query PostGIS: get_service_area devuelve la zona si el punto
    // está dentro, o NULL si está fuera. Esto reemplaza las dos queries
    // anteriores (is_location_serviceable + get_service_area) por una sola,
    // reduciendo a la mitad los round-trips a la BD en cada creación de viaje.
    let serviceArea = null;

    try {
      const [[area]] = await sequelize.query(
        `SELECT * FROM get_service_area(ST_SetSRID(ST_MakePoint(:lng, :lat), 4326))`,
        { replacements: { lng: pickupLng, lat: pickupLat } },
      );
      serviceArea = area ?? null;

      if (!serviceArea) {
        // NULL = punto fuera de todas las zonas activas.
        // Solo rechazar si hay zonas configuradas; si no hay ninguna,
        // es operación abierta y se usan tarifas por defecto.
        const [[{ count }]] = await sequelize.query(
          `SELECT COUNT(*) AS count FROM service_areas WHERE is_active = true`,
        );
        if (parseInt(count, 10) > 0) {
          return res.status(422).json({
            error:
              'Lo sentimos, el punto de recogida está fuera de nuestras zonas de cobertura.',
            code: 'OUT_OF_SERVICE_AREA',
          });
        }
        // Sin zonas configuradas → continuar con tarifas por defecto
      }
    } catch (zoneError) {
      // PostGIS no disponible o tablas no configuradas → usar tarifas por defecto
      console.warn(
        '⚠️ [createRide] Zone check omitido (PostGIS no disponible o sin zonas):',
        zoneError.message,
      );
    }

    // Usar tarifas de la zona o fallback a valores por defecto
    const baseFare = serviceArea?.base_fare ?? 12;
    const farePerKm = serviceArea?.fare_per_km ?? 0.5;
    const farePerMinute = serviceArea?.fare_per_minute ?? 0.58;
    const serviceAreaId = serviceArea?.id ?? null;

    // ── Calcular tarifa total ─────────────────────────────────────────
    let totalFare = fare;

    if (totalFare == null) {
      const distKm = finalDistance / 1000;
      const distMin = Math.ceil(finalDuration / 60);

      totalFare = baseFare + distKm * farePerKm + distMin * farePerMinute;

      totalFare = Math.round(totalFare); // opcional
    }

    // ── Aplicar código de descuento ───────────────────────────────────
    let discountAmount = 0;
    let promoCodeId = null;

    if (promoCode) {
      const promo = await PromoCode.findOne({
        where: {
          code: promoCode.toUpperCase(),
          is_active: true,
          [Op.or]: [
            { expires_at: null },
            { expires_at: { [Op.gt]: new Date() } },
          ],
          [Op.or]: [
            { max_uses: null },
            { max_uses: { [Op.gt]: sequelize.col('uses_count') } },
          ],
        },
      });

      if (!promo) {
        return res.status(400).json({
          error: 'Código de descuento inválido, expirado o agotado.',
          code: 'INVALID_PROMO',
        });
      }

      discountAmount =
        promo.discount_type === 'percentage'
          ? Math.round(totalFare * (promo.discount_value / 100) * 100) / 100
          : Math.min(promo.discount_value, totalFare);

      promoCodeId = promo.id;

      // Incrementar uses_count
      await promo.increment('uses_count');
    }

    const finalFare = Math.max(
      0,
      Math.round((totalFare - discountAmount) * 100) / 100,
    );

    // ── Crear el viaje ────────────────────────────────────────────────
    const ride = await Ride.create({
      passengerId,
      pickupLocation: {
        type: 'Point',
        coordinates: [pickupLng, pickupLat],
      },
      pickup_address: pickupLocation.address,
      dropoffLocation: {
        type: 'Point',
        coordinates: [
          parseFloat(dropoffLocation.longitude),
          parseFloat(dropoffLocation.latitude),
        ],
      },
      dropoff_address: dropoffLocation.address,
      vehicle_type_requested: vehicleTypeRequested ?? null,
      paymentMethod: paymentMethod || 'cash',
      distance: finalDistance,
      duration: finalDuration,
      baseFare,
      farePerKm,
      farePerMinute,
      totalFare,
      discountAmount,
      finalFare,
      service_area_id: serviceAreaId,
      promo_code_id: promoCodeId,
      status: 'requested',
      expiresAt: new Date(Date.now() + 2 * 60 * 1000),
    });

    console.log('✅ [createRide] Viaje creado:', {
      id: ride.id,
      zona: serviceArea?.name ?? 'Sin zona',
      tarifa: `Bs ${finalFare}`,
      descuento: discountAmount > 0 ? `Bs ${discountAmount}` : 'ninguno',
    });

    // 🔌 Notificar conductores cercanos de forma no-bloqueante
    // (no esperamos con await — el cliente recibe respuesta inmediatamente)
    (async () => {
      try {
        const [lng, lat] = [pickupLng, pickupLat];

        // Buscar conductores cercanos Y datos del pasajero en paralelo
        const [nearbyDrivers, passenger, passengerRating] = await Promise.all([
          sequelize.query(
            `SELECT d."user_id" as "userId"
             FROM driver_locations dl
             JOIN drivers d ON dl.driver_id = d.id
             WHERE dl.is_online = true
               AND d.status = 'approved'
               AND d.id NOT IN (
                 SELECT driver_id FROM rides
                 WHERE status IN ('accepted', 'arrived', 'in_progress')
                   AND driver_id IS NOT NULL
               )
               AND ST_DWithin(
                 dl.location::geography,
                 ST_GeomFromText('POINT(${lng} ${lat})', 4326)::geography,
                 5000
               )`,
            { type: sequelize.QueryTypes.SELECT },
          ),
          User.findByPk(passengerId, {
            attributes: ['id', 'name', 'phone', 'profilePhoto'],
          }),
          calcRating(passengerId, 'passenger'),
        ]);

        if (nearbyDrivers.length === 0) {
          console.log(`🔍 [createRide] Sin conductores cercanos para ride ${ride.id}`);
          return;
        }

        const ridePayload = {
          rideId: ride.id,
          passengerName: passenger?.name || 'Pasajero',
          passengerPhone: passenger?.phone || '',
          passengerRating,
          passengerProfilePhoto: passenger?.profilePhoto || null,
          pickupAddress: pickupLocation.address,
          dropoffAddress: dropoffLocation.address,
          fare: finalFare,
          distance: finalDistance,
          duration: finalDuration,
          pickupLocation: { latitude: pickupLat, longitude: pickupLng },
          dropoffLocation: {
            latitude: parseFloat(dropoffLocation.latitude),
            longitude: parseFloat(dropoffLocation.longitude),
            address: dropoffLocation.address,
          },
          createdAt: ride.createdAt,
        };

        const io = getIO();
        nearbyDrivers.forEach(({ userId }) => {
          io.to(`user:${userId}`).emit('ride:new_request', ridePayload);
        });

        console.log(`🚗 [createRide] ride:new_request enviado a ${nearbyDrivers.length} conductor(es)`);
      } catch (err) {
        console.warn('⚠️ [createRide] Error notificando conductores:', err.message);
      }
    })();

    return res.status(201).json({ message: 'Solicitud de viaje creada', ride });
  } catch (error) {
    console.error('❌ [createRide] Error:', error.message);
    return res.status(500).json({
      error: 'Error al crear la solicitud de viaje',
      details: error.message,
    });
  }
};

const getRideById = async (req, res) => {
  try {
    const { id } = req.params;

    // Solo loguear una vez cada 10 segundos para no saturar logs
    const logKey = `getRideById_${id}`;
    const lastLogTime = global.lastLogs?.[logKey] || 0;
    const now = Date.now();
    const shouldLog = now - lastLogTime > 10000; // Log cada 10s

    let ride;
    try {
      const DriverLocation = require('../models/DriverLocation');
      const Vehicle = require('../models/Vehicle');
      const Rating = require('../models/Rating');

      ride = await Ride.findByPk(id, {
        include: [
          {
            model: User,
            as: 'passenger',
            attributes: { exclude: ['password'] },
          },
          {
            model: Driver,
            as: 'driver',
            required: false,
            attributes: { exclude: ['createdAt', 'updatedAt'] },
            include: [
              {
                model: User,
                as: 'user',
                attributes: { exclude: ['password', 'createdAt', 'updatedAt'] },
              },
              {
                model: DriverLocation,
                as: 'location',
                required: false,
              },
              {
                model: Vehicle,
                as: 'vehicles',
                required: false,
                where: { status: 'active' },
                limit: 1,
              },
            ],
          },
        ],
      });
      if (shouldLog) {
        console.log('✅ [getRideById] Ride obtenido con asociaciones:', {
          rideId: ride?.id,
          hasDriver: !!ride?.driver,
          driverHasUser: !!ride?.driver?.user,
        });
        if (!global.lastLogs) global.lastLogs = {};
        global.lastLogs[logKey] = now;
      }
    } catch (associationError) {
      console.warn(
        '⚠️ [getRideById] Error cargando asociaciones:',
        associationError.message,
        associationError.stack,
      );
      // Retornar viaje sin Driver si hay error de asociación
      ride = await Ride.findByPk(id);
    }

    if (!ride) {
      return res.status(404).json({
        error: 'Viaje no encontrado',
      });
    }

    if (shouldLog) {
      console.log('📍 [getRideById] Retornando ride con estructura:', {
        rideId: ride.id,
        hasDriver: !!ride.driver,
        driverStructure: ride.driver
          ? {
            id: ride.driver.id,
            userId: ride.driver.userId,
            hasUser: !!ride.driver.user,
            hasLocation: !!ride.driver.location,
          }
          : null,
      });
    }

    // Calcular tiempo restante para cada contra-oferta (30 segundos de validez)
    const OFFER_VALIDITY_SECONDS = 30;
    const enrichedRide = ride.toJSON();

    if (
      enrichedRide.counterOffers &&
      Array.isArray(enrichedRide.counterOffers)
    ) {
      enrichedRide.counterOffers = enrichedRide.counterOffers.map(offer => {
        const offerCreatedTime = new Date(offer.createdAt).getTime();
        const elapsedSeconds = Math.floor((now - offerCreatedTime) / 1000);
        const timeLeftInSeconds = Math.max(
          0,
          OFFER_VALIDITY_SECONDS - elapsedSeconds,
        );

        return {
          ...offer,
          timeLeftInSeconds,
          isExpired: timeLeftInSeconds === 0,
        };
      });
    }

    // ── Extraer y normalizar coordenadas PostGIS ──────────────────────────
    const extractCoords = (geom, addressField) => ({
      latitude: geom?.coordinates?.[1] ?? geom?.latitude ?? 0,
      longitude: geom?.coordinates?.[0] ?? geom?.longitude ?? 0,
      address: addressField || '',
    });

    // ── Calcular ratings reales desde tabla ratings (via calcRating) ──────
    const driverAvgRating = await calcRating(enrichedRide.driverId, 'driver');
    const passengerAvgRating = await calcRating(
      enrichedRide.passengerId,
      'passenger',
    );

    // ── Extraer ubicación del conductor desde driver_locations ────────────
    const driverLoc = enrichedRide.driver?.location;
    const driverLocationCoords = driverLoc?.location
      ? {
        latitude: driverLoc.location.coordinates?.[1] ?? 0,
        longitude: driverLoc.location.coordinates?.[0] ?? 0,
      }
      : null;

    // ── Vehículo del conductor ────────────────────────────────────────────
    const vehicle = enrichedRide.driver?.vehicles?.[0] || null;

    const response = {
      ...enrichedRide,
      // Ratings calculados desde tabla ratings (default 5.0 si no hay calificaciones)
      driverRatingValue: driverAvgRating,
      passengerRatingValue: passengerAvgRating,
      // Ubicaciones con coordenadas y dirección correctas
      pickupLocation: extractCoords(
        enrichedRide.pickupLocation,
        ride.pickup_address,
      ),
      dropoffLocation: extractCoords(
        enrichedRide.dropoffLocation,
        ride.dropoff_address,
      ),
      // Conductor normalizado (alias user → User para compatibilidad con frontend)
      driver: enrichedRide.driver
        ? {
          ...enrichedRide.driver,
          User: enrichedRide.driver.user || enrichedRide.driver.User || null,
          currentLocation: driverLocationCoords,
          rating: driverAvgRating,
          vehicleModel: vehicle
            ? `${vehicle.brand} ${vehicle.model}`.trim()
            : null,
          vehicleColor: vehicle?.color || null,
          vehiclePlate: vehicle?.plate || null,
        }
        : null,
      // Pasajero con rating calculado
      passenger: enrichedRide.passenger
        ? {
          ...enrichedRide.passenger,
          rating: passengerAvgRating,
        }
        : null,
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Error al obtener viaje:', error);
    res.status(500).json({
      error: 'Error al obtener el viaje',
    });
  }
};

const getActiveRide = async (req, res) => {
  try {
    const userId = req.user.id;

    let activeRide;
    try {
      activeRide = await Ride.findOne({
        where: {
          [Op.or]: [{ passengerId: userId }, { driverId: userId }],
          status: {
            [Op.in]: ['requested', 'accepted', 'in_progress'],
          },
        },
        include: [
          {
            model: User,
            as: 'passenger',
            attributes: { exclude: ['password'] },
          },
          {
            model: Driver,
            as: 'driver',
            required: false,
            include: [
              {
                model: User,
                as: 'user',
                attributes: { exclude: ['password'] },
              },
            ],
          },
        ],
      });
    } catch (associationError) {
      console.warn(
        '⚠️ [getActiveRide] Error cargando asociaciones:',
        associationError.message,
      );
      // Retornar viaje sin Driver si hay error
      activeRide = await Ride.findOne({
        where: {
          [Op.or]: [{ passengerId: userId }, { driverId: userId }],
          status: {
            [Op.in]: ['requested', 'accepted', 'in_progress'],
          },
        },
      });
    }

    if (!activeRide) {
      return res.status(404).json({
        error: 'No hay viajes activos',
      });
    }

    res.status(200).json({
      ride: activeRide,
    });
  } catch (error) {
    console.error('Error al obtener viaje activo:', error);
    res.status(500).json({
      error: 'Error al obtener el viaje activo',
    });
  }
};

const getRideHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 10, offset = 0 } = req.query;

    // driver_id en rides referencia drivers.id (no users.id).
    // Hay que resolver el drivers.id del usuario antes de filtrar.
    const driverRecord = await Driver.findOne({ where: { userId } });
    const driverId = driverRecord?.id ?? null;

    const orClause = [{ passengerId: userId }];
    if (driverId) orClause.push({ driverId });

    const rides = await Ride.findAll({
      where: {
        [Op.or]: orClause,
        status: {
          [Op.in]: ['completed', 'cancelled'],
        },
      },
      include: [
        { model: User, as: 'passenger', attributes: { exclude: ['password'] } },
        {
          model: Driver,
          as: 'driver',
          required: false,
          include: [
            {
              model: User,
              as: 'user',
              attributes: { exclude: ['password'] },
            },
          ],
        },
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    const total = await Ride.count({
      where: {
        [Op.or]: orClause,
        status: {
          [Op.in]: ['completed', 'cancelled'],
        },
      },
    });

    res.status(200).json({
      rides,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error('Error al obtener historial:', error);
    res.status(500).json({
      error: 'Error al obtener el historial de viajes',
    });
  }
};

const acceptRide = async (req, res) => {
  try {
    const { rideId } = req.params;
    const driverId = req.user.id;

    console.log('🚗 [acceptRide] Intentando aceptar viaje:', {
      rideId,
      driverId,
      userExists: !!req.user,
      userIdExists: !!req.user?.id,
    });

    // Validar que el conductor esté autenticado
    if (!driverId) {
      return res.status(401).json({
        error: 'Conductor no autenticado',
      });
    }

    // 🔥 VALIDAR QUE EL USUARIO SEA UN CONDUCTOR APROBADO
    const driver = await Driver.findOne({
      where: { userId: driverId, status: 'approved' },
    });

    if (!driver) {
      console.warn('⚠️ [acceptRide] Usuario no es conductor aprobado:', {
        userId: driverId,
      });
      return res.status(403).json({
        error:
          'No eres un conductor aprobado. Debes completar tu registro y ser aprobado para aceptar viajes.',
      });
    }

    console.log('✅ [acceptRide] Conductor validado:', {
      driverId: driver.id,
      userId: driver.userId,
      status: driver.status,
    });

    // 🔥 VALIDAR QUE LA SOLICITUD NO HA EXPIRADO
    // UPDATE atómico: validar status en la misma operación
    // Evita race condition donde dos conductores aceptan el mismo viaje
    const [updated] = await Ride.update(
      {
        driverId: driver.id,
        status: 'accepted',
        acceptedAt: new Date(),
      },
      {
        where: {
          id: rideId,
          status: 'requested', // ← Validar AQUÍ en la actualización
        },
      },
    );

    console.log('🚗 [acceptRide] Resultado de actualización:', {
      updated,
      rideId,
      driverId: driver.id,
    });

    if (updated === 0) {
      // Verificar si el viaje existe pero no está en estado 'requested'
      const existingRide = await Ride.findByPk(rideId);
      if (!existingRide) {
        return res.status(404).json({
          error: 'Viaje no encontrado',
        });
      }

      // Validar si la solicitud expiró
      if (
        existingRide.expiresAt &&
        new Date() > new Date(existingRide.expiresAt)
      ) {
        console.warn('⏰ [acceptRide] ❌ Solicitud expirada:', {
          rideId,
          expiresAt: existingRide.expiresAt,
          now: new Date(),
        });

        return res.status(410).json({
          error: 'La solicitud de viaje ha expirado (2 minutos sin respuesta)',
          expiredAt: existingRide.expiresAt,
        });
      }

      // Log específico para entender por qué falló la aceptación
      console.warn(
        '⚠️ [acceptRide] Fallo al aceptar. Estado actual:',
        existingRide.status,
      );

      if (existingRide.status === 'cancelled') {
        return res.status(400).json({
          error: 'Esta solicitud fue cancelada por el pasajero',
        });
      } else if (existingRide.status === 'accepted') {
        return res.status(400).json({
          error: 'Esta solicitud ya fue aceptada por otro conductor',
        });
      }

      return res.status(400).json({
        error:
          'El viaje ya fue aceptado por otro conductor o ha sido cancelado',
      });
    }

    // Obtener el viaje actualizado
    let rideUpdated;
    try {
      rideUpdated = await Ride.findByPk(rideId, {
        include: [
          {
            model: User,
            as: 'passenger',
            attributes: { exclude: ['password'] },
          },
          {
            model: Driver,
            as: 'driver',
            required: false,
            include: [
              {
                model: User,
                as: 'user',
                attributes: { exclude: ['password'] },
              },
            ],
          },
        ],
      });
    } catch (associationError) {
      console.warn(
        '⚠️ [acceptRide] Error cargando asociaciones:',
        associationError.message,
      );
      rideUpdated = await Ride.findByPk(rideId);
    }

    console.log('✅ [acceptRide] Viaje aceptado exitosamente:', {
      rideId: rideUpdated.id,
      status: rideUpdated.status,
      driverId: rideUpdated.driverId,
      passengerName: rideUpdated.passenger?.name,
    });

    // ── Notificar al pasajero ─────────────────────────────────────────────
    const { notifyRideAccepted } = require('../services/notificationService');
    const driverName =
      rideUpdated.driver?.User?.name ??
      rideUpdated.driver?.user?.name ??
      'El conductor';
    notifyRideAccepted(rideUpdated.passengerId, rideUpdated, driverName);

    // 🔌 Socket: notificar al pasajero que el viaje fue aceptado
    try {
      getIO().to(`user:${rideUpdated.passengerId}`).emit('ride:accepted', {
        rideId: rideUpdated.id,
        status: 'accepted',
        driverId: rideUpdated.driverId,
        driverName: driverName,
      });
      getIO().to(`ride:${rideUpdated.id}`).emit('ride:status:changed', {
        rideId: rideUpdated.id,
        status: 'accepted',
        timestamp: new Date().toISOString(),
      });
    } catch (socketError) {
      console.warn('⚠️ [Socket] acceptRide emit error:', socketError.message);
    }

    res.status(200).json({
      message: 'Viaje aceptado exitosamente',
      ride: rideUpdated,
    });
  } catch (error) {
    console.error('❌ [acceptRide] Error al aceptar viaje:', error);
    console.error('❌ [acceptRide] Stack trace:', error.stack);
    console.error('❌ [acceptRide] Error message:', error.message);
    res.status(500).json({
      error: 'Error al aceptar el viaje',
      details: error.message,
    });
  }
};

const completeRide = async (req, res) => {
  try {
    const { rideId } = req.params;
    const { driverRating, driverReview, passengerRating, passengerReview } =
      req.body;

    console.log('🚕 [completeRide] Datos recibidos:', {
      rideId,
      driverRating,
      driverReview,
      passengerRating,
      passengerReview,
    });

    // UPDATE atómico: validar status en la misma operación
    const [updated] = await Ride.update(
      {
        status: 'completed',
        completedAt: new Date(),
        driverRating: driverRating || undefined,
        driverReview: driverReview || undefined,
        passengerRating: passengerRating || undefined,
        passengerReview: passengerReview || undefined,
        paymentStatus: 'completed',
      },
      {
        where: {
          id: rideId,
          status: 'in_progress', // ← Validar AQUÍ en la actualización
        },
      },
    );

    if (updated === 0) {
      // Verificar si el viaje existe pero no está en estado 'in_progress'
      // Si está completado, permitir actualizar calificaciones
      const ride = await Ride.findByPk(rideId);
      if (!ride) {
        return res.status(404).json({
          error: 'Viaje no encontrado',
        });
      }

      if (ride.status === 'completed') {
        // Permitir actualizar calificaciones en viajes ya completados
        await Ride.update(
          {
            driverRating:
              driverRating !== undefined ? driverRating : ride.driverRating,
            driverReview:
              driverReview !== undefined ? driverReview : ride.driverReview,
            passengerRating:
              passengerRating !== undefined
                ? passengerRating
                : ride.passengerRating,
            passengerReview:
              passengerReview !== undefined
                ? passengerReview
                : ride.passengerReview,
          },
          {
            where: { id: rideId },
          },
        );
      } else {
        return res.status(400).json({
          error: 'El viaje no está en progreso o ya fue completado',
        });
      }
    }

    // Obtener el viaje actualizado
    let ride;
    try {
      ride = await Ride.findByPk(rideId, {
        include: [
          {
            model: User,
            as: 'passenger',
            attributes: { exclude: ['password'] },
          },
          {
            model: Driver,
            as: 'driver',
            required: false,
            include: [
              {
                model: User,
                as: 'user',
                attributes: { exclude: ['password'] },
              },
            ],
          },
        ],
      });
    } catch (associationError) {
      console.warn(
        '⚠️ [completeRide] Error cargando asociaciones:',
        associationError.message,
      );
      ride = await Ride.findByPk(rideId);
    }

    // Actualizar ratings basado en las calificaciones del viaje
    if (ride) {
      console.log('📊 [completeRide] Actualizando ratings para viaje:', {
        rideId: ride.id,
        driverId: ride.driverId,
        passengerId: ride.passengerId,
        driverRating: ride.driverRating,
        passengerRating: ride.passengerRating,
      });

      // Actualizar rating del conductor en tabla Driver si hay driverRating
      if (ride.driverRating && ride.driverId) {
        try {
          console.log(
            `🔄 [completeRide] Calculando rating medio del conductor ${ride.driverId}...`,
          );
          const driverRatings = await Ride.findAll({
            where: {
              driverId: ride.driverId,
              driverRating: { [Op.not]: null },
            },
            attributes: ['driverRating'],
          });

          if (driverRatings.length > 0) {
            const avgRating =
              driverRatings.reduce((sum, r) => sum + r.driverRating, 0) /
              driverRatings.length;

            const totalTripsAsDriver = await Ride.count({
              where: {
                driverId: ride.driverId,
                status: 'completed',
              },
            });

            await Driver.update(
              {
                rating: parseFloat(avgRating.toFixed(2)),
                totalTripsAsDriver,
              },
              {
                where: { id: ride.driverId },
              },
            );

            console.log(
              `✅ [completeRide] Driver.rating actualizado: ${avgRating.toFixed(
                2,
              )} (${driverRatings.length
              } reseñas, ${totalTripsAsDriver} viajes)`,
            );
          }
        } catch (ratingError) {
          console.error(
            '⚠️ [completeRide] Error actualizando Driver.rating:',
            ratingError.message,
          );
        }
      }

      // Actualizar rating del pasajero en tabla User si hay passengerRating
      if (ride.passengerRating && ride.passengerId) {
        try {
          console.log(
            `🔄 [completeRide] Calculando rating medio del pasajero ${ride.passengerId}...`,
          );
          const passengerRatings = await Ride.findAll({
            where: {
              passengerId: ride.passengerId,
              passengerRating: { [Op.not]: null },
            },
            attributes: ['passengerRating'],
          });

          if (passengerRatings.length > 0) {
            const avgRating =
              passengerRatings.reduce((sum, r) => sum + r.passengerRating, 0) /
              passengerRatings.length;

            const totalTrips = await Ride.count({
              where: {
                passengerId: ride.passengerId,
                status: 'completed',
              },
            });

            // rating y totalTrips son campos calculados (no columnas físicas en users)
            // Se calculan desde rides cuando se necesitan mostrar
            console.log(
              `✅ [completeRide] Rating pasajero calculado: ${avgRating.toFixed(
                2,
              )} (${passengerRatings.length
              } reseñas, ${totalTrips} viajes completados)`,
            );
          }
        } catch (ratingError) {
          console.error(
            '⚠️ [completeRide] Error actualizando User.rating:',
            ratingError.message,
          );
        }
      } else {
        console.log(
          `⚠️ [completeRide] Sin passengerRating para actualizar. passengerRating=${ride.passengerRating}, passengerId=${ride.passengerId}`,
        );
      }
    } else {
      console.log('⚠️ [completeRide] Ride no encontrado después de actualizar');
    }

    // ── Registrar ganancias del conductor ──────────────────────────────
    // 📝  Los registros se crean siempre (historial acumulado).
    //     commission_status = 'pending' — quedan pendientes hasta que el
    //     admin active el cobro de comisiones (COMMISSIONS_START_DATE en .env).
    //     Los earnings anteriores a esa fecha NUNCA se incluirán en un settlement.
    if (ride?.driverId) {
      try {
        const COMMISSION_RATE = parseFloat(process.env.COMMISSION_RATE ?? '0');
        const gross = parseFloat(ride.finalFare ?? 0);
        const commissionAmt = Math.round(gross * COMMISSION_RATE * 100) / 100;
        const netAmt = Math.round((gross - commissionAmt) * 100) / 100;

        // Detectar si ya existe (evitar duplicados si completeRide se llama dos veces)
        const existing = await DriverEarning.findOne({
          where: { ride_id: ride.id },
        });
        if (!existing) {
          // ── Crear registro de pago si no existe ─────────────────────────────
          const { Payment } = require('../models');
          let payment = await Payment.findOne({
            where: { rideId: ride.id },
          });
          if (!payment) {
            payment = await Payment.create({
              rideId: ride.id,
              passengerId: ride.passengerId,
              amount: parseFloat(ride.totalFare ?? 0),
              currency: 'BOB',
              payment_method: ride.paymentMethod || 'cash',
              payment_status: 'completed',
              paid_at: new Date(),
            });
            console.log(
              `💳 [completeRide] Payment creado: ${payment.id} | Bs ${payment.amount}`,
            );
          }

          const VALID_EARNING_METHODS = ['cash', 'qr'];
          const rawMethod = payment?.payment_method ?? 'cash';
          const paymentMethod = VALID_EARNING_METHODS.includes(rawMethod)
            ? rawMethod
            : 'cash';

          if (rawMethod !== paymentMethod) {
            console.log(
              `ℹ️ [completeRide] Método de pago '${rawMethod}' mapeado a 'cash' en driver_earnings`,
            );
          }

          await DriverEarning.create({
            driver_id: ride.driverId,
            ride_id: ride.id,
            payment_method: paymentMethod,
            gross_amount: gross,
            commission_rate: COMMISSION_RATE,
            commission_amount: commissionAmt,
            net_amount: netAmt,
            commission_status: 'pending',
            settlement_id: null,
          });
          console.log(
            `💰 [completeRide] DriverEarning creado: ${paymentMethod} | bruto Bs ${gross} | comisión Bs ${commissionAmt} | neto Bs ${netAmt}`,
          );
        }
      } catch (earningError) {
        // No romper el flujo — el viaje ya quedó completado
        console.error(
          '⚠️ [completeRide] Error al crear DriverEarning:',
          earningError.message,
        );
      }
    }

    // 🔌 Socket: notificar viaje completado
    try {
      getIO().to(`ride:${ride.id}`).emit('ride:status:changed', {
        rideId: ride.id,
        status: 'completed',
        timestamp: new Date().toISOString(),
      });
    } catch (socketError) {
      console.warn('⚠️ [Socket] completeRide emit error:', socketError.message);
    }

    res.status(200).json({
      message: 'Viaje completado exitosamente',
      ride,
    });
  } catch (error) {
    console.error('Error al completar viaje:', error);
    res.status(500).json({
      error: 'Error al completar el viaje',
    });
  }
};

const getRideRequests = async (req, res) => {
  try {
    console.log(
      '📡 [getRideRequests] Buscando solicitudes de viajes pendientes...',
    );

    // Obtener todas las solicitudes de viajes que están en estado 'requested' u 'offered'
    // 'offered' = ya tiene al menos una oferta pero el pasajero aún no aceptó ninguna
    // Otros conductores pueden seguir enviando ofertas mientras el ride esté en estos estados
    const rides = await Ride.findAll({
      where: {
        status: ['requested', 'offered'],
      },
      include: [
        {
          model: User,
          as: 'passenger',
          attributes: ['id', 'name', 'phone', 'profilePhoto'],
        },
      ],
      order: [['createdAt', 'DESC']], // Ordenar por más recientes
    });

    console.log('📡 [getRideRequests] Viajes encontrados:', rides.length);

    // ── Calcular ratings de pasajeros en batch (1 query) ─────────────────
    // Rating por defecto = 5 para usuarios nuevos sin valoraciones
    const passengerIds = [
      ...new Set(rides.map(r => r.passengerId).filter(Boolean)),
    ];
    const passengerRatingsMap = {};

    if (passengerIds.length > 0) {
      await Promise.all(
        passengerIds.map(async pid => {
          passengerRatingsMap[pid] = await calcRating(pid, 'passenger');
        }),
      );
    }

    // Transformar la respuesta a un formato más limpio
    const rideRequests = rides.map((ride, index) => {
      const transformed = {
        rideId: ride.id,
        passengerName: ride.passenger?.name || 'Pasajero desconocido',
        passengerPhone: ride.passenger?.phone || '',
        passengerRating: passengerRatingsMap[ride.passengerId] ?? 5,
        passengerProfilePhoto: ride.passenger?.profilePhoto || null,
        pickupLocation: {
          latitude:
            ride.pickupLocation?.coordinates?.[1] ??
            ride.pickupLocation?.latitude ??
            0,
          longitude:
            ride.pickupLocation?.coordinates?.[0] ??
            ride.pickupLocation?.longitude ??
            0,
          address: ride.pickup_address || '',
        },
        dropoffLocation: {
          latitude:
            ride.dropoffLocation?.coordinates?.[1] ??
            ride.dropoffLocation?.latitude ??
            0,
          longitude:
            ride.dropoffLocation?.coordinates?.[0] ??
            ride.dropoffLocation?.longitude ??
            0,
          address: ride.dropoff_address || '',
        },
        fare: ride.totalFare || ride.finalFare,
        distance: ride.distance,
        duration: ride.duration,
        notes: ride.notes || '',
        createdAt: ride.createdAt, // 🔥 AGREGAR TIMESTAMP DEL SERVIDOR
      };

      // 🔥 DEBUG: Log cada viaje devuelto
      console.log(`📡 [getRideRequests] Viaje ${index + 1}:`, {
        rideId: transformed.rideId,
        distance: transformed.distance,
        distanceType: typeof transformed.distance,
        duration: transformed.duration,
        durationType: typeof transformed.duration,
        fare: transformed.fare,
        fareType: typeof transformed.fare,
        dbValues: {
          ride_distance: ride.distance,
          ride_duration: ride.duration,
          ride_totalFare: ride.totalFare,
          ride_finalFare: ride.finalFare,
        },
      });

      return transformed;
    });

    console.log(
      '📡 [getRideRequests] Respuesta transformada:',
      JSON.stringify(rideRequests, null, 2),
    );
    res.status(200).json(rideRequests);
  } catch (error) {
    console.error(
      '❌ [getRideRequests] Error al obtener solicitudes de viajes:',
      error,
    );
    res.status(500).json({
      error: 'Error al obtener solicitudes de viajes',
      details: error.message,
    });
  }
};

// 🔵 CUANDO EL CONDUCTOR LLEGA AL PUNTO DE RECOGIDA
const arrivedRide = async (req, res) => {
  try {
    const { rideId } = req.params;

    // UPDATE atómico: validar que esté en estado 'accepted'
    const [updated] = await Ride.update(
      {
        status: 'arrived',
        arrivedAt: new Date(),
      },
      {
        where: {
          id: rideId,
          status: 'accepted', // ← Solo se puede marcar como llegado si fue aceptado
        },
      },
    );

    if (updated === 0) {
      // Verificar si el viaje existe pero no está en estado 'accepted'
      const ride = await Ride.findByPk(rideId);
      if (!ride) {
        return res.status(404).json({
          error: 'Viaje no encontrado',
        });
      }

      return res.status(400).json({
        error: 'El viaje no está en estado aceptado',
        currentStatus: ride.status,
      });
    }

    // Recuperar el viaje actualizado con asociaciones
    let ride;
    try {
      ride = await Ride.findByPk(rideId, {
        include: [
          {
            model: User,
            as: 'passenger',
            attributes: { exclude: ['password'] },
          },
          {
            model: Driver,
            as: 'driver',
            required: false,
            include: [
              {
                model: User,
                as: 'user',
                attributes: { exclude: ['password'] },
              },
            ],
          },
        ],
      });
    } catch (associationError) {
      console.warn(
        '⚠️ [arrivedRide] Error cargando asociaciones:',
        associationError.message,
      );
      ride = await Ride.findByPk(rideId);
    }

    console.log('🟠 [arrivedRide] Conductor llegó al punto de recogida:', {
      id: ride.id,
      status: ride.status,
      arrivedAt: ride.arrivedAt,
    });

    const { notifyDriverArrived } = require('../services/notificationService');
    const driverName = ride.driver?.User?.name || 'Tu conductor';
    notifyDriverArrived(ride.passengerId, ride, driverName).catch(err => {
      console.error('Error enviando notificación arrived:', err);
    });

    // 🔌 Socket: notificar cambio de estado
    try {
      getIO().to(`ride:${ride.id}`).emit('ride:status:changed', {
        rideId: ride.id,
        status: 'arrived',
        timestamp: new Date().toISOString(),
      });
    } catch (socketError) {
      console.warn('⚠️ [Socket] arrivedRide emit error:', socketError.message);
    }

    res.status(200).json({
      message: 'Conductor llegó al punto de recogida',
      ride,
    });
  } catch (error) {
    console.error('❌ [arrivedRide] Error al marcar como llegado:', error);
    res.status(500).json({
      error: 'Error al marcar como llegado',
      details: error.message,
    });
  }
};

const passengerReady = async (req, res) => {
  try {
    const { rideId } = req.params;

    // UPDATE: marcar al pasajero como listo
    const [updated] = await Ride.update(
      {
        passengerReadyAt: new Date(),
      },
      {
        where: {
          id: rideId,
          status: 'arrived', // Solo se puede marcar si ya llegó el conductor
        },
      },
    );

    if (updated === 0) {
      // Verificar si el viaje existe pero no está en estado 'arrived'
      const ride = await Ride.findByPk(rideId);
      if (!ride) {
        return res.status(404).json({
          error: 'Viaje no encontrado',
        });
      }

      return res.status(400).json({
        error:
          'El viaje debe estar en estado "arrived" para marcar al pasajero como listo',
        currentStatus: ride.status,
      });
    }

    // Recuperar el viaje actualizado
    const ride = await Ride.findByPk(rideId, {
      include: [
        {
          model: User,
          as: 'passenger',
          attributes: { exclude: ['password'] },
        },
        {
          model: Driver,
          as: 'driver',
          required: false,
          include: [
            {
              model: User,
              as: 'user',
              attributes: { exclude: ['password'] },
            },
          ],
        },
      ],
    });

    console.log('🟢 [passengerReady] Pasajero está listo:', {
      id: ride.id,
      status: ride.status,
      passengerReadyAt: ride.passengerReadyAt,
    });

    // 🔌 Socket: notificar que pasajero está listo
    try {
      getIO().to(`ride:${ride.id}`).emit('ride:status:changed', {
        rideId: ride.id,
        status: 'passenger_ready',
        timestamp: new Date().toISOString(),
      });
    } catch (socketError) {
      console.warn(
        '⚠️ [Socket] passengerReady emit error:',
        socketError.message,
      );
    }

    res.status(200).json({
      message: 'Pasajero confirmó que está listo',
      ride,
    });
  } catch (error) {
    console.error(
      '❌ [passengerReady] Error al marcar pasajero como listo:',
      error,
    );
    res.status(500).json({
      error: 'Error al marcar pasajero como listo',
      details: error.message,
    });
  }
};

const startRide = async (req, res) => {
  try {
    const { rideId } = req.params;

    // UPDATE atómico: validar que esté en estado 'arrived'
    const [updated] = await Ride.update(
      {
        status: 'in_progress',
        startedAt: new Date(),
      },
      {
        where: {
          id: rideId,
          status: 'arrived', // ← Solo se puede iniciar si el conductor llegó
        },
      },
    );

    if (updated === 0) {
      // Verificar si el viaje existe pero no está en estado 'accepted'
      const ride = await Ride.findByPk(rideId);
      if (!ride) {
        return res.status(404).json({
          error: 'Viaje no encontrado',
        });
      }

      return res.status(400).json({
        error: 'El viaje no está en estado aceptado',
        currentStatus: ride.status,
      });
    }

    // Recuperar el viaje actualizado con asociaciones
    let ride;
    try {
      ride = await Ride.findByPk(rideId, {
        include: [
          {
            model: User,
            as: 'passenger',
            attributes: { exclude: ['password'] },
          },
          {
            model: Driver,
            as: 'driver',
            required: false,
            include: [
              {
                model: User,
                as: 'user',
                attributes: { exclude: ['password'] },
              },
            ],
          },
        ],
      });
    } catch (associationError) {
      console.warn(
        '⚠️ [startRide] Error cargando asociaciones:',
        associationError.message,
      );
      ride = await Ride.findByPk(rideId);
    }

    // 🔌 Socket: notificar inicio de viaje
    try {
      getIO().to(`ride:${ride.id}`).emit('ride:status:changed', {
        rideId: ride.id,
        status: 'in_progress',
        timestamp: new Date().toISOString(),
      });
    } catch (socketError) {
      console.warn('⚠️ [Socket] startRide emit error:', socketError.message);
    }

    res.status(200).json({
      message: 'Viaje iniciado',
      ride,
    });
  } catch (error) {
    console.error('❌ [startRide] Error al iniciar viaje:', error);
    res.status(500).json({
      error: 'Error al iniciar el viaje',
      details: error.message,
    });
  }
};

// 💰 CONTRA-OFERTAS DE TARIFA

const submitCounterOffer = async (req, res) => {
  try {
    const { rideId } = req.params;
    const { proposedPrice } = req.body;
    const driverId = req.user.id;

    console.log('💰 [submitCounterOffer] Nueva oferta:', {
      rideId,
      driverId,
      proposedPrice,
    });

    const Vehicle = require('../models/Vehicle');
    const { RideOffer } = require('../models');

    // Validar que el conductor esté aprobado
    const driver = await Driver.findOne({
      where: { userId: driverId, status: 'approved' },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'phone', 'profilePhoto'],
        },
        {
          model: Vehicle,
          as: 'vehicles',
          attributes: ['id', 'brand', 'model', 'color', 'plate'],
          where: { status: 'active' },
          required: false,
          limit: 1,
        },
      ],
    });

    if (!driver) {
      return res.status(403).json({ error: 'No eres un conductor aprobado' });
    }

    // Obtener el viaje
    const ride = await Ride.findByPk(rideId);
    if (!ride) {
      return res.status(404).json({ error: 'Viaje no encontrado' });
    }

    if (!['requested', 'offered'].includes(ride.status)) {
      return res
        .status(400)
        .json({ error: 'El viaje ya fue aceptado o cancelado' });
    }

    // Evitar oferta duplicada activa del mismo conductor
    const existing = await RideOffer.findOne({
      where: { ride_id: rideId, driver_id: driver.id, status: 'pending' },
    });
    if (existing) {
      // Actualizar precio de la oferta existente
      await existing.update({
        offered_price: proposedPrice,
        expires_at: new Date(Date.now() + 30 * 1000),
      });
      const vehicle = driver.vehicles?.[0] || null;
      const driverRating = await calcRating(driver.id, 'driver');
      return res.status(200).json({
        message: 'Oferta actualizada',
        offer: {
          offerId: existing.id,
          driverId: driver.id,
          driverName: driver.user?.name || 'Conductor',
          driverProfilePicture: driver.user?.profilePhoto || null,
          driverRating,
          driverPhone: driver.user?.phone || '',
          vehicleModel: vehicle
            ? `${vehicle.brand} ${vehicle.model}`.trim()
            : '',
          vehicleColor: vehicle?.color || '',
          licensePlate: vehicle?.plate || '',
          proposedPrice,
          createdAt: existing.createdAt,
          expiresAt: existing.expires_at,
        },
      });
    }

    // Crear oferta en ride_offers
    const vehicle = driver.vehicles?.[0] || null;
    const driverRating = await calcRating(driver.id, 'driver');

    const offer = await RideOffer.create({
      ride_id: rideId,
      driver_id: driver.id,
      offered_price: proposedPrice,
      status: 'pending',
      expires_at: new Date(Date.now() + 30 * 1000),
    });

    // Cambiar estado del viaje a 'offered' si aún estaba en 'requested'
    if (ride.status === 'requested') {
      await ride.update({ status: 'offered' });
    }

    console.log(
      '✅ [submitCounterOffer] Oferta guardada en ride_offers:',
      offer.id,
    );

    // 🔌 Socket: notificar nueva oferta al pasajero
    try {
      getIO()
        .to(`user:${ride.passengerId}`)
        .emit('offer:new', {
          rideId: ride.id,
          offer: {
            offerId: offer.id,
            driverId: driver.id,
            driverName: driver.user?.name || 'Conductor',
            driverProfilePicture: driver.user?.profilePhoto || null,
            driverPhone: driver.user?.phone || '',
            vehicleModel: vehicle
              ? `${vehicle.brand} ${vehicle.model}`.trim()
              : '',
            vehicleColor: vehicle?.color || '',
            licensePlate: vehicle?.plate || '',
            proposedPrice,
            driverRating,
            createdAt: offer.createdAt,
            expiresAt: offer.expires_at,
          },
        });
    } catch (socketError) {
      console.warn(
        '⚠️ [Socket] submitCounterOffer emit error:',
        socketError.message,
      );
    }

    res.status(201).json({
      message: 'Oferta enviada',
      offer: {
        offerId: offer.id,
        driverId: driver.id,
        driverName: driver.user?.name || 'Conductor',
        driverProfilePicture: driver.user?.profilePhoto || null,
        driverRating,
        driverPhone: driver.user?.phone || '',
        vehicleModel: vehicle ? `${vehicle.brand} ${vehicle.model}`.trim() : '',
        vehicleColor: vehicle?.color || '',
        licensePlate: vehicle?.plate || '',
        proposedPrice,
        createdAt: offer.createdAt,
        expiresAt: offer.expires_at,
      },
    });
  } catch (error) {
    console.error('❌ [submitCounterOffer] Error:', error);
    res
      .status(500)
      .json({ error: 'Error al enviar contra-oferta', details: error.message });
  }
};

const getCounterOffers = async (req, res) => {
  try {
    const { rideId } = req.params;
    const now = Date.now();

    const { RideOffer } = require('../models');
    const Vehicle = require('../models/Vehicle');

    const ride = await Ride.findByPk(rideId);
    if (!ride) {
      return res.status(404).json({ error: 'Viaje no encontrado' });
    }

    // Auto-expirar ofertas cuyo expires_at ya pasó
    const expiredCount = await RideOffer.update(
      { status: 'expired' },
      {
        where: {
          ride_id: rideId,
          status: 'pending',
          expires_at: { [Op.lt]: new Date() },
        },
      },
    );
    if (expiredCount[0] > 0) {
      console.log(
        `⏰ [getCounterOffers] ${expiredCount[0]} oferta(s) expiradas marcadas en BD`,
      );
      // Si no quedan ofertas pendientes, volver el ride a 'requested'
      // para que otros conductores puedan verlo y enviar nuevas ofertas
      const remainingPending = await RideOffer.count({
        where: { ride_id: rideId, status: 'pending' },
      });
      if (remainingPending === 0 && ride.status === 'offered') {
        await ride.update({ status: 'requested' });
        console.log(
          `🔄 [getCounterOffers] Ride ${rideId} vuelve a 'requested' (todas las ofertas expiraron)`,
        );
      }
    }

    // Leer ofertas desde ride_offers (estado pending, aún vigentes)
    const rideOffers = await RideOffer.findAll({
      where: { ride_id: rideId, status: 'pending' },
      include: [
        {
          model: Driver,
          as: 'driver',
          include: [
            {
              model: User,
              as: 'user',
              attributes: ['id', 'name', 'phone', 'profilePhoto'],
            },
            {
              model: Vehicle,
              as: 'vehicles',
              where: { status: 'active' },
              required: false,
              limit: 1,
            },
          ],
        },
      ],
      order: [['created_at', 'ASC']],
    });

    const offers = await Promise.all(
      rideOffers.map(async o => {
        const driver = o.driver;
        const vehicle = driver?.vehicles?.[0] || null;
        const driverRating = await calcRating(driver?.id, 'driver');

        const expiresAt = o.expires_at
          ? new Date(o.expires_at).getTime()
          : now + 30000;
        const timeLeftInSeconds = Math.max(
          0,
          Math.floor((expiresAt - now) / 1000),
        );

        return {
          offerId: o.id,
          driverId: driver?.id || null,
          driverName: driver?.user?.name || 'Conductor',
          driverProfilePicture: driver?.user?.profilePhoto || null,
          driverRating,
          driverPhone: driver?.user?.phone || '',
          vehicleModel: vehicle
            ? `${vehicle.brand} ${vehicle.model}`.trim()
            : '',
          vehicleColor: vehicle?.color || '',
          licensePlate: vehicle?.plate || '',
          proposedPrice: parseFloat(o.offered_price),
          createdAt: o.createdAt,
          timeLeftInSeconds,
          isExpired: timeLeftInSeconds === 0,
          rejected: false,
        };
      }),
    );

    console.log(
      `📋 [getCounterOffers] ${offers.length} oferta(s) para ride ${rideId}`,
    );

    res.status(200).json({
      offers,
      rideId: ride.id,
      originalFare: ride.finalFare,
    });
  } catch (error) {
    console.error('❌ [getCounterOffers] Error:', error);
    res.status(500).json({
      error: 'Error al obtener contra-ofertas',
      details: error.message,
    });
  }
};

const acceptCounterOffer = async (req, res) => {
  try {
    const { rideId } = req.params;
    const { offerId, finalPrice } = req.body;
    const passengerId = req.user.id;

    console.log('✅ [acceptCounterOffer] Aceptando oferta:', {
      rideId,
      offerId,
      finalPrice,
    });

    const { RideOffer } = require('../models');

    const ride = await Ride.findByPk(rideId);
    if (!ride) {
      return res.status(404).json({ error: 'Viaje no encontrado' });
    }

    if (ride.passengerId !== passengerId) {
      return res.status(403).json({ error: 'Este viaje no te pertenece' });
    }

    if (ride.expiresAt && new Date() > new Date(ride.expiresAt)) {
      await ride.update({ status: 'expired' });
      return res.status(410).json({
        error: 'La solicitud de viaje ha expirado (2 minutos sin respuesta)',
        expiredAt: ride.expiresAt,
      });
    }

    // Buscar la oferta seleccionada en ride_offers
    const selectedOffer = await RideOffer.findOne({
      where: { id: offerId, ride_id: rideId, status: 'pending' },
    });

    if (!selectedOffer) {
      return res
        .status(404)
        .json({ error: 'Oferta no encontrada o ya procesada' });
    }

    // Aceptar la oferta seleccionada
    await selectedOffer.update({ status: 'accepted' });

    // Rechazar todas las demás ofertas pendientes del mismo viaje
    await RideOffer.update(
      { status: 'rejected' },
      { where: { ride_id: rideId, status: 'pending' } },
    );

    // Actualizar el viaje con el conductor y precio final
    await ride.update({
      driverId: selectedOffer.driver_id,
      finalFare: finalPrice ?? parseFloat(selectedOffer.offered_price),
      status: 'accepted',
      acceptedAt: new Date(),
    });

    // Recargar con asociaciones
    const updatedRide = await Ride.findByPk(rideId, {
      include: [
        { model: User, as: 'passenger', attributes: { exclude: ['password'] } },
        {
          model: Driver,
          as: 'driver',
          required: false,
          include: [
            { model: User, as: 'user', attributes: { exclude: ['password'] } },
          ],
        },
      ],
    });

    console.log('✅ [acceptCounterOffer] Oferta aceptada:', {
      rideId,
      offerId,
      driverId: selectedOffer.driver_id,
    });

    // 🔌 Socket: notificar al conductor que su oferta fue aceptada
    try {
      const { Driver: DriverModel } = require('../models');
      const driverRecord = await DriverModel.findByPk(selectedOffer.driver_id, {
        attributes: ['userId'],
      });
      if (driverRecord) {
        getIO().to(`user:${driverRecord.userId}`).emit('offer:result', {
          rideId,
          offerId,
          accepted: true,
        });
      }
      getIO().to(`ride:${rideId}`).emit('ride:status:changed', {
        rideId,
        status: 'accepted',
        timestamp: new Date().toISOString(),
      });
    } catch (socketError) {
      console.warn(
        '⚠️ [Socket] acceptCounterOffer emit error:',
        socketError.message,
      );
    }

    res.status(200).json({ message: 'Oferta aceptada', ride: updatedRide });
  } catch (error) {
    console.error('❌ [acceptCounterOffer] Error:', error);
    res.status(500).json({
      error: 'Error al aceptar contra-oferta',
      details: error.message,
    });
  }
};

// 🔥 RECHAZAR OFERTA
const rejectCounterOffer = async (req, res) => {
  try {
    const { rideId } = req.params;
    const { offerId } = req.body;
    const passengerId = req.user.id;

    console.log('🚫 [rejectCounterOffer] Rechazando oferta:', {
      rideId,
      offerId,
    });

    const { RideOffer } = require('../models');

    const ride = await Ride.findByPk(rideId);
    if (!ride) {
      return res.status(404).json({ error: 'Viaje no encontrado' });
    }

    if (ride.passengerId !== passengerId) {
      return res.status(403).json({ error: 'Este viaje no te pertenece' });
    }

    // Marcar la oferta como rechazada en ride_offers
    const updated = await RideOffer.update(
      { status: 'rejected' },
      { where: { id: offerId, ride_id: rideId, status: 'pending' } },
    );

    if (!updated[0]) {
      return res
        .status(404)
        .json({ error: 'Oferta no encontrada o ya procesada' });
    }

    // Si no quedan ofertas pendientes, volver el viaje a 'requested'
    const remaining = await RideOffer.count({
      where: { ride_id: rideId, status: 'pending' },
    });
    if (remaining === 0 && ride.status === 'offered') {
      await ride.update({ status: 'requested' });
    }

    console.log('✅ [rejectCounterOffer] Oferta rechazada:', {
      rideId,
      offerId,
    });

    // 🔌 Socket: notificar al conductor que su oferta fue rechazada
    try {
      const {
        RideOffer: RideOfferModel,
        Driver: DriverModel,
      } = require('../models');
      const offerRecord = await RideOfferModel.findByPk(offerId, {
        attributes: ['driver_id'],
      });
      if (offerRecord) {
        const driverRecord = await DriverModel.findByPk(offerRecord.driver_id, {
          attributes: ['userId'],
        });
        if (driverRecord) {
          getIO().to(`user:${driverRecord.userId}`).emit('offer:result', {
            rideId,
            offerId,
            accepted: false,
          });
        }
      }
    } catch (socketError) {
      console.warn(
        '⚠️ [Socket] rejectCounterOffer emit error:',
        socketError.message,
      );
    }

    res.status(200).json({ message: 'Oferta rechazada', offerId });
  } catch (error) {
    console.error('❌ [rejectCounterOffer] Error:', error);
    res.status(500).json({
      error: 'Error al rechazar contra-oferta',
      details: error.message,
    });
  }
};

/**
 * PUT /rides/:rideId/cancel
 *
 * Reglas:
 *  - Solo se puede cancelar en estados: requested | offered | accepted
 *  - El pasajero puede cancelar en cualquiera de esos estados
 *  - El conductor solo puede cancelar si ya aceptó (accepted o arrived)
 *  - Se valida cancellationReasonId contra la tabla cancellation_reasons
 *  - Si el viaje tenía ofertas pendientes, se rechazan todas
 */
const cancelRide = async (req, res) => {
  try {
    const { rideId } = req.params;
    const { cancellationReasonId, cancelledBy: reqCancelledBy } = req.body;
    const userId = req.user.id;

    // ── Cargar el viaje ───────────────────────────────────────────────────
    const ride = await Ride.findByPk(rideId);
    if (!ride) {
      return res.status(404).json({ error: 'Viaje no encontrado.' });
    }

    // ── Verificar estado cancelable ───────────────────────────────────────
    // Si ya está cancelado o expirado, responder OK (idempotente)
    if (ride.status === 'cancelled' || ride.status === 'expired') {
      return res.status(200).json({
        message: 'El viaje ya estaba cancelado.',
        rideId: ride.id,
        status: ride.status,
      });
    }

    const cancelableStatuses = [
      'requested',
      'offered',
      'accepted',
      'arrived',
      'in_progress',
    ];
    if (!cancelableStatuses.includes(ride.status)) {
      return res.status(400).json({
        error: `No se puede cancelar un viaje en estado '${ride.status}'.`,
        estadosPermitidos: cancelableStatuses,
      });
    }

    // ── Determinar quién cancela ──────────────────────────────────────────
    let cancelledBy = null;

    if (ride.passengerId === userId) {
      if (ride.status === 'in_progress' && reqCancelledBy !== 'system') {
        return res.status(400).json({
          error: 'El pasajero no puede cancelar un viaje que ya está en curso.',
        });
      }
      cancelledBy = reqCancelledBy === 'system' ? 'system' : 'passenger';
    } else {
      // Verificar si es el conductor asignado
      const driver = await Driver.findOne({ where: { userId } });
      if (driver && ride.driverId === driver.id) {
        if (!['accepted', 'arrived', 'in_progress'].includes(ride.status)) {
          return res.status(400).json({
            error:
              'El conductor solo puede cancelar un viaje que ya aceptó, llegó o está en curso.',
          });
        }
        cancelledBy = 'driver';
      }
    }

    if (!cancelledBy) {
      return res.status(403).json({
        error: 'No estás autorizado para cancelar este viaje.',
      });
    }

    // ── Validar razón de cancelación ──────────────────────────────────────
    if (cancellationReasonId) {
      const { CancellationReason } = require('../models');
      const reason = await CancellationReason.findByPk(cancellationReasonId);

      if (!reason || !reason.is_active) {
        return res.status(400).json({
          error: 'Razón de cancelación inválida o inactiva.',
        });
      }

      // Verificar que la razón aplica al rol
      if (
        reason.applicable_to !== 'both' &&
        reason.applicable_to !== cancelledBy
      ) {
        return res.status(400).json({
          error: `Esta razón de cancelación solo aplica para '${reason.applicable_to}', no para '${cancelledBy}'.`,
        });
      }
    }

    // ── Rechazar todas las ofertas pendientes del viaje ───────────────────
    const { RideOffer } = require('../models');
    const rejectedCount = await RideOffer.update(
      { status: 'cancelled' },
      { where: { ride_id: rideId, status: 'pending' } },
    );
    if (rejectedCount[0] > 0) {
      console.log(
        `📋 [cancelRide] ${rejectedCount[0]} oferta(s) canceladas para ride ${rideId}`,
      );
    }

    // ── Cancelar el viaje ─────────────────────────────────────────────────
    const previousStatus = ride.status; // guardar antes de que update() lo cambie
    await ride.update({
      status: 'cancelled',
      cancelledBy,
      cancelledAt: new Date(),
      cancellation_reason_id: cancellationReasonId ?? null,
    });

    console.log(`🚫 [cancelRide] Viaje ${rideId} cancelado por ${cancelledBy}`);

    // ── Notificar a la otra parte ─────────────────────────────────────────
    const { notifyRideCancelled } = require('../services/notificationService');
    if (cancelledBy === 'passenger' && ride.driverId) {
      // Notificar al conductor que el pasajero canceló
      const { Driver: DriverModel } = require('../models');
      const driverRecord = await DriverModel.findByPk(ride.driverId, {
        attributes: ['userId'],
      });
      if (driverRecord)
        notifyRideCancelled(driverRecord.userId, ride, cancelledBy);
    } else if (cancelledBy === 'driver') {
      // Notificar al pasajero que el conductor canceló
      notifyRideCancelled(ride.passengerId, ride, cancelledBy);
    }

    // 🔌 Socket: notificar cancelación
    try {
      getIO().to(`ride:${ride.id}`).emit('ride:status:changed', {
        rideId: ride.id,
        status: 'cancelled',
        cancelledBy,
        timestamp: new Date().toISOString(),
      });
      // Notificar a TODOS los conductores conectados para que quiten la tarjeta de su lista.
      // Se usa broadcast global porque el room 'drivers:available' puede perder miembros
      // si el socket reconecta. El frontend filtra por rideId así que es seguro.
      if (['requested', 'offered'].includes(previousStatus)) {
        getIO().emit('ride:request:cancelled', {
          rideId: ride.id,
        });
      }
    } catch (socketError) {
      console.warn('⚠️ [Socket] cancelRide emit error:', socketError.message);
    }

    return res.status(200).json({
      message: `Viaje cancelado exitosamente por el ${cancelledBy === 'passenger' ? 'pasajero' : 'conductor'
        }.`,
      rideId: ride.id,
      cancelledBy,
      status: 'cancelled',
    });
  } catch (error) {
    console.error('❌ [cancelRide] Error:', error.message);
    return res.status(500).json({
      error: 'Error al cancelar el viaje.',
      details: error.message,
    });
  }
};

/**
 * GET /api/rides/cancellation-reasons
 * Obtener las razones de cancelación activas
 */
const getCancellationReasons = async (req, res) => {
  try {
    const { CancellationReason } = require('../models');
    const { role } = req.query; // 'driver' o 'passenger'

    let reasons = await CancellationReason.findAll({
      where: { is_active: true },
      order: [['description', 'ASC']],
    });

    if (role) {
      reasons = reasons.filter(
        r =>
          !r.applicable_to ||
          r.applicable_to === 'both' ||
          r.applicable_to === role,
      );
    }

    return res.status(200).json(reasons);
  } catch (error) {
    console.error('❌ [getCancellationReasons] Error:', error.message);
    return res
      .status(500)
      .json({ error: 'Error al obtener razones de cancelación' });
  }
};

const getFareSettings = async (req, res) => {
  // Valores por defecto globales
  const DEFAULT_BASE_FARE = 12;
  const DEFAULT_FARE_PER_KM = 0.5;
  const DEFAULT_FARE_PER_MINUTE = 0.58;
  const DEFAULT_CURRENCY = 'BOB';

  try {
    const { lat, lng } = req.query;
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    console.log(`📍 [getFareSettings] Solicitud recibida - lat: ${lat}, lng: ${lng}`);

    // Si se recibieron coordenadas válidas, consultar PostGIS
    if (!isNaN(latitude) && !isNaN(longitude)) {
      try {
        console.log(`🔍 [getFareSettings] Consultando zona PostGIS para (${latitude}, ${longitude})...`);
        const [[area]] = await sequelize.query(
          `SELECT * FROM get_service_area(ST_SetSRID(ST_MakePoint(:lng, :lat), 4326))`,
          { replacements: { lng: longitude, lat: latitude } },
        );
        if (area) {
          const result = {
            baseFare:      area.base_fare       ?? DEFAULT_BASE_FARE,
            farePerKm:     area.fare_per_km     ?? DEFAULT_FARE_PER_KM,
            farePerMinute: area.fare_per_minute ?? DEFAULT_FARE_PER_MINUTE,
            currency:      area.currency        ?? DEFAULT_CURRENCY,
            zoneId:        area.id,
            zoneName:      area.name,
          };
          console.log(`✅ [getFareSettings] Zona encontrada: "${area.name}"`);
          console.log(`   💰 Tarifas de zona:`);
          console.log(`     Base fare:        Bs ${result.baseFare}`);
          console.log(`     Fare per km:      Bs ${result.farePerKm} / km`);
          console.log(`     Fare per minute:  Bs ${result.farePerMinute} / min`);
          return res.status(200).json(result);
        } else {
          console.log(`⚠️ [getFareSettings] Coordenadas (${latitude}, ${longitude}) fuera de todas las zonas activas.`);
        }
      } catch (zoneError) {
        // PostGIS no disponible → usar defaults
        console.warn('⚠️ [getFareSettings] Zone check omitido:', zoneError.message);
      }
    } else {
      console.log('⚠️ [getFareSettings] Sin coordenadas válidas → usando tarifas globales por defecto.');
    }

    // Sin coordenadas o fuera de zonas → devolver tarifas globales
    console.log('🌍 [getFareSettings] Usando tarifas GLOBALES por defecto:');
    console.log(`   Base fare:        Bs ${DEFAULT_BASE_FARE}`);
    console.log(`   Fare per km:      Bs ${DEFAULT_FARE_PER_KM} / km`);
    console.log(`   Fare per minute:  Bs ${DEFAULT_FARE_PER_MINUTE} / min`);
    return res.status(200).json({
      baseFare:      DEFAULT_BASE_FARE,
      farePerKm:     DEFAULT_FARE_PER_KM,
      farePerMinute: DEFAULT_FARE_PER_MINUTE,
      currency:      DEFAULT_CURRENCY,
      zoneId:        null,
      zoneName:      null,
    });
  } catch (error) {
    console.error('Error al obtener configuracion de tarifas:', error);
    res.status(500).json({ error: 'Error al obtener tarifas' });
  }
};

module.exports = {
  getCancellationReasons,
  createRide,
  getRideById,
  getActiveRide,
  getRideHistory,
  getRideRequests,
  acceptRide,
  arrivedRide,
  passengerReady,
  startRide,
  completeRide,
  cancelRide,
  submitCounterOffer,
  getCounterOffers,
  acceptCounterOffer,
  rejectCounterOffer,
  getFareSettings,
};
