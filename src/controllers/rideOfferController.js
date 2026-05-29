// backend/src/controllers/rideOfferController.js
const { Ride, RideOffer, Driver, User, Vehicle } = require('../models');
const sequelize = require('../config/database');
const { Op } = require('sequelize');

/**
 * Calcula el rating promedio del conductor desde rides.
 * Retorna 5 si no tiene valoraciones (conductor nuevo).
 * @param {string} driverId
 * @returns {Promise<number>}
 */
async function calcDriverRating(driverId) {
  if (!driverId) return 5;
  try {
    const { sequelize } = require('../models');
    const [rows] = await sequelize.query(
      `SELECT rating FROM ratings WHERE driver_id = :driverId AND rater_type = 'passenger'`,
      { replacements: { driverId } },
    );
    const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
    // El 5 inicial siempre se incluye como calificación semilla.
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

exports.createOffer = async (req, res) => {
  try {
    const { rideId, driverId, offeredPrice, message, expiresAt } = req.body;

    // Validate required fields
    if (!rideId || !driverId || offeredPrice === undefined || !expiresAt) {
      return res.status(400).json({
        success: false,
        message:
          'Missing required fields: rideId, driverId, offeredPrice, expiresAt',
      });
    }

    // Check if ride exists and is still open for offers
    const ride = await Ride.findByPk(rideId);
    if (!ride) {
      return res
        .status(404)
        .json({ success: false, message: 'Ride not found' });
    }
    if (!['requested', 'offered'].includes(ride.status)) {
      return res.status(400).json({
        success: false,
        message: `No se puede ofertar en un viaje con estado '${ride.status}'.`,
      });
    }

    // Check if driver exists
    const driver = await Driver.findByPk(driverId, {
      include: [{ model: Vehicle, as: 'Vehicle', required: false }],
    });
    if (!driver) {
      return res
        .status(404)
        .json({ success: false, message: 'Driver not found' });
    }

    // ── Validar tipo de vehículo ──────────────────────────────────────────
    // Si el pasajero especificó un tipo, solo conductores con ese tipo pueden ofertar
    if (ride.vehicle_type_requested) {
      const driverVehicleType = driver.Vehicle?.vehicle_type ?? null;

      if (!driverVehicleType) {
        return res.status(403).json({
          success: false,
          message:
            'No tienes un vehículo registrado activo. No puedes ofertar en este viaje.',
        });
      }

      if (driverVehicleType !== ride.vehicle_type_requested) {
        return res.status(403).json({
          success: false,
          message: `Este viaje requiere un vehículo tipo '${ride.vehicle_type_requested}'. Tu vehículo es '${driverVehicleType}'.`,
          required: ride.vehicle_type_requested,
          driverType: driverVehicleType,
        });
      }
    }

    // Check if driver already has a pending offer for this ride
    const existingOffer = await RideOffer.findOne({
      where: { ride_id: rideId, driver_id: driverId, status: 'pending' },
    });
    if (existingOffer) {
      return res.status(400).json({
        success: false,
        message: 'Driver already has a pending offer for this ride',
      });
    }

    // Create offer
    const offer = await RideOffer.create({
      ride_id: rideId,
      driver_id: driverId,
      offered_price: offeredPrice,
      message: message || null,
      expires_at: new Date(expiresAt),
    });

    // Si es la primera oferta en este viaje, cambiar status a 'offered'
    if (ride.status === 'requested') {
      await ride.update({ status: 'offered' });
      console.log(`📋 [rideOfferController] Ride ${rideId} → status 'offered'`);
    }

    console.log('✅ [rideOfferController] Offer created:', offer.id);

    // ── Notificar al pasajero que recibió una oferta ──────────────────────
    const { notifyOfferReceived } = require('../services/notificationService');
    const { User: UserModel } = require('../models');
    const driverUser = await UserModel.findByPk(driver.userId, {
      attributes: ['name'],
    }).catch(() => null);
    notifyOfferReceived(
      ride.passengerId,
      ride,
      offeredPrice,
      driverUser?.name ?? 'Un conductor',
    );

    return res.status(201).json({
      success: true,
      message: 'Offer created successfully',
      data: offer,
    });
  } catch (error) {
    console.error('❌ [rideOfferController] Error creating offer:', error);
    return res.status(500).json({
      success: false,
      message: 'Error creating offer',
      error: error.message,
    });
  }
};

exports.getOfferById = async (req, res) => {
  try {
    const { id } = req.params;

    const offer = await RideOffer.findByPk(id, {
      include: [
        {
          model: Ride,
          as: 'ride',
          attributes: [
            'id',
            'passengerId',
            'pickupLocation',
            'dropoffLocation',
          ],
        },
        {
          model: Driver,
          as: 'driver',
          attributes: ['id', 'userId'],
          include: [
            {
              model: User,
              as: 'user',
              attributes: ['id', 'name', 'profilePhoto'],
            },
          ],
        },
      ],
    });

    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Offer not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: offer,
    });
  } catch (error) {
    console.error('❌ [rideOfferController] Error fetching offer:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching offer',
      error: error.message,
    });
  }
};

exports.getOffersByRide = async (req, res) => {
  try {
    const { rideId } = req.params;
    const { status } = req.query;

    // Check if ride exists
    const ride = await Ride.findByPk(rideId);
    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found',
      });
    }

    const where = { ride_id: rideId };
    if (status) {
      where.status = status;
    }

    const offers = await RideOffer.findAll({
      where,
      include: [
        {
          model: Driver,
          as: 'driver',
          attributes: ['id', 'userId'],
          include: [
            {
              model: User,
              as: 'user',
              attributes: ['id', 'name', 'profilePhoto'],
            },
          ],
        },
      ],
      order: [['created_at', 'DESC']],
    });

    // Agregar rating del conductor a cada oferta (default 5 para nuevos)
    const offersWithRating = await Promise.all(
      offers.map(async offer => {
        const plain = offer.toJSON ? offer.toJSON() : offer;
        const driverRating = await calcDriverRating(plain.driver?.id);
        return {
          ...plain,
          driver: plain.driver
            ? { ...plain.driver, rating: driverRating }
            : plain.driver,
        };
      }),
    );

    return res.status(200).json({
      success: true,
      data: offersWithRating,
      count: offersWithRating.length,
    });
  } catch (error) {
    console.error('❌ [rideOfferController] Error fetching offers:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching offers',
      error: error.message,
    });
  }
};

exports.getOffersByDriver = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { status } = req.query;

    // Check if driver exists
    const driver = await Driver.findByPk(driverId);
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
      });
    }

    const where = { driver_id: driverId };
    if (status) {
      where.status = status;
    }

    const offers = await RideOffer.findAll({
      where,
      include: [
        {
          model: Ride,
          as: 'ride',
          attributes: [
            'id',
            'passengerId',
            'pickupLocation',
            'dropoffLocation',
          ],
        },
      ],
      order: [['created_at', 'DESC']],
    });

    return res.status(200).json({
      success: true,
      data: offers,
      count: offers.length,
    });
  } catch (error) {
    console.error(
      '❌ [rideOfferController] Error fetching driver offers:',
      error,
    );
    return res.status(500).json({
      success: false,
      message: 'Error fetching offers',
      error: error.message,
    });
  }
};

exports.updateOfferStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Validate status
    const validStatuses = [
      'pending',
      'accepted',
      'rejected',
      'expired',
      'cancelled',
    ];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    const offer = await RideOffer.findByPk(id);
    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Offer not found',
      });
    }

    // If accepting offer, reject all other offers for the same ride
    if (status === 'accepted') {
      await RideOffer.update(
        { status: 'rejected' },
        {
          where: {
            ride_id: offer.ride_id,
            id: { [sequelize.Op.ne]: id },
            status: 'pending',
          },
        },
      );

      console.log(
        '✅ [rideOfferController] Rejected other offers for ride:',
        offer.ride_id,
      );
    }

    offer.status = status;
    await offer.save();

    console.log(
      '✅ [rideOfferController] Offer status updated:',
      id,
      '→',
      status,
    );

    return res.status(200).json({
      success: true,
      message: 'Offer status updated successfully',
      data: offer,
    });
  } catch (error) {
    console.error(
      '❌ [rideOfferController] Error updating offer status:',
      error,
    );
    return res.status(500).json({
      success: false,
      message: 'Error updating offer',
      error: error.message,
    });
  }
};

exports.rejectOffer = async (req, res) => {
  try {
    const { id } = req.params;

    const offer = await RideOffer.findByPk(id);
    if (!offer) {
      return res.status(404).json({
        success: false,
        message: 'Offer not found',
      });
    }

    offer.status = 'rejected';
    await offer.save();

    console.log('✅ [rideOfferController] Offer rejected:', id);

    return res.status(200).json({
      success: true,
      message: 'Offer rejected successfully',
      data: offer,
    });
  } catch (error) {
    console.error('❌ [rideOfferController] Error rejecting offer:', error);
    return res.status(500).json({
      success: false,
      message: 'Error rejecting offer',
      error: error.message,
    });
  }
};

exports.deletePendingOffers = async (req, res) => {
  try {
    const { rideId } = req.params;

    // Check if ride exists
    const ride = await Ride.findByPk(rideId);
    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found',
      });
    }

    // Delete all pending offers for this ride
    const deletedCount = await RideOffer.destroy({
      where: {
        ride_id: rideId,
        status: 'pending',
      },
    });

    console.log(
      '✅ [rideOfferController] Deleted pending offers:',
      deletedCount,
    );

    return res.status(200).json({
      success: true,
      message: 'Pending offers deleted successfully',
      deletedCount,
    });
  } catch (error) {
    console.error('❌ [rideOfferController] Error deleting offers:', error);
    return res.status(500).json({
      success: false,
      message: 'Error deleting offers',
      error: error.message,
    });
  }
};
