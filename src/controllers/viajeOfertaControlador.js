// backend/src/controllers/viajeOfertaControlador.js
const { Viaje: Viaje, ViajeOferta: ViajeOferta, Conductor: Conductor, Usuario: Usuario, Vehiculo: Vehiculo } = require('../models');
const sequelize = require("../config/baseDatos");
const { Op: Operador } = require('sequelize');

/**
 * Calcula el rating promedio del conductor desde rides.
 * Retorna 5 si no tiene valoraciones (conductor nuevo).
 * @param {string} driverId
 * @returns {Promise<number>}
 */
async function calcularConductorCalificacion(conductorId) {
  if (!conductorId) return 5;
  try {
    const { sequelize: sequelize } = require('../models');
    const [filas] = await sequelize.query(
      `SELECT c.rating FROM calificacion c JOIN viaje v ON v.id = c.ride_id WHERE v.driver_id = :driverId AND c.rater_type = 'pasajero'`,
      { replacements: { driverId: conductorId } }
    );
    const lista = Array.isArray(filas) ? filas : filas ? [filas] : [];
    // El 5 inicial siempre se incluye como calificación semilla.
    const semillaCalificacion = 5;
    const total = lista.length + 1;
    const suma = lista.reduce(
      (acumulador, r) => acumulador + (parseFloat(r.rating) || 0),
      semillaCalificacion
    );
    return Math.round(suma / total * 10) / 10;
  } catch {
    return 5;
  }
}

exports.crearOferta = async (solicitud, respuesta) => {
  try {
    const { rideId: viajeId, driverId: conductorId, offeredPrice: ofertadoPrecio, message: mensaje, expiresAt: venceEn } = solicitud.body;

    // Validate required fields
    if (!viajeId || !conductorId || ofertadoPrecio === undefined || !venceEn) {
      return respuesta.status(400).json({
        success: false,
        message:
        'Missing required fields: rideId, driverId, offeredPrice, expiresAt'
      });
    }

    // Check if ride exists and is still open for offers
    const viaje = await Viaje.findByPk(viajeId);
    if (!viaje) {
      return respuesta.
      status(404).
      json({ success: false, message: 'Ride not found' });
    }
    if (!['solicitado', 'ofertado'].includes(viaje.status)) {
      return respuesta.status(400).json({
        success: false,
        message: `No se puede ofertar en un viaje con estado '${viaje.status}'.`
      });
    }

    // Check if driver exists
    const conductor = await Conductor.findByPk(conductorId, {
      include: [{ model: Vehiculo, as: 'Vehicle', required: false }]
    });
    if (!conductor) {
      return respuesta.
      status(404).
      json({ success: false, message: 'Driver not found' });
    }

    // ── Validar tipo de vehículo ──────────────────────────────────────────
    // Si el pasajero especificó un tipo, solo conductores con ese tipo pueden ofertar
    if (viaje.vehicle_type_requested) {
      const conductorVehiculoTipo = conductor.Vehicle?.vehicle_type ?? null;

      if (!conductorVehiculoTipo) {
        return respuesta.status(403).json({
          success: false,
          message:
          'No tienes un vehículo registrado activo. No puedes ofertar en este viaje.'
        });
      }

      if (conductorVehiculoTipo !== viaje.vehicle_type_requested) {
        return respuesta.status(403).json({
          success: false,
          message: `Este viaje requiere un vehículo tipo '${viaje.vehicle_type_requested}'. Tu vehículo es '${conductorVehiculoTipo}'.`,
          required: viaje.vehicle_type_requested,
          driverType: conductorVehiculoTipo
        });
      }
    }

    // Check if driver already has a pending offer for this ride
    const existenteOferta = await ViajeOferta.findOne({
      where: { ride_id: viajeId, driver_id: conductorId, status: 'pendiente' }
    });
    if (existenteOferta) {
      return respuesta.status(400).json({
        success: false,
        message: 'Driver already has a pending offer for this ride'
      });
    }

    // Create offer
    const oferta = await ViajeOferta.create({
      ride_id: viajeId,
      driver_id: conductorId,
      offered_price: ofertadoPrecio,
      message: mensaje || null,
      expires_at: new Date(venceEn)
    });

    // Si es la primera oferta en este viaje, cambiar status a 'ofertado'
    if (viaje.status === 'solicitado') {
      await viaje.update({ status: 'ofertado' });
      console.log(`📋 [rideOfferController] Ride ${viajeId} → status 'ofertado'`);
    }

    console.log('✅ [rideOfferController] Offer created:', oferta.id);

    // ── Notificar al pasajero que recibió una oferta ──────────────────────
    const { notificarOfertaRecibido: notificarOfertaRecibido } = require("../services/notificacionServicio");
    const { Usuario: UsuarioModelo } = require('../models');
    const conductorUsuario = await UsuarioModelo.findByPk(conductor.userId, {
      attributes: ['name']
    }).catch(() => null);
    notificarOfertaRecibido(
      viaje.passengerId,
      viaje,
      ofertadoPrecio,
      conductorUsuario?.name ?? 'Un conductor'
    );

    return respuesta.status(201).json({
      success: true,
      message: 'Offer created successfully',
      data: oferta
    });
  } catch (error) {
    console.error('❌ [rideOfferController] Error creating offer:', error);
    return respuesta.status(500).json({
      success: false,
      message: 'Error creating offer',
      error: error.message
    });
  }
};

exports.obtenerOfertaPorId = async (solicitud, respuesta) => {
  try {
    const { id } = solicitud.params;

    const oferta = await ViajeOferta.findByPk(id, {
      include: [
      {
        model: Viaje,
        as: 'ride',
        attributes: [
        'id',
        'passengerId',
        'pickupLocation',
        'dropoffLocation']

      },
      {
        model: Conductor,
        as: 'driver',
        attributes: ['id', 'userId'],
        include: [
        {
          model: Usuario,
          as: 'user',
          attributes: ['id', 'name', 'profilePhoto']
        }]

      }]

    });

    if (!oferta) {
      return respuesta.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    return respuesta.status(200).json({
      success: true,
      data: oferta
    });
  } catch (error) {
    console.error('❌ [rideOfferController] Error fetching offer:', error);
    return respuesta.status(500).json({
      success: false,
      message: 'Error fetching offer',
      error: error.message
    });
  }
};

exports.obtenerOfertasViaje = async (solicitud, respuesta) => {
  try {
    const { rideId: viajeId } = solicitud.params;
    const { status: estado } = solicitud.query;

    // Check if ride exists
    const viaje = await Viaje.findByPk(viajeId);
    if (!viaje) {
      return respuesta.status(404).json({
        success: false,
        message: 'Ride not found'
      });
    }

    const condiciones = { ride_id: viajeId };
    if (estado) {
      condiciones.status = estado;
    }

    const ofertas = await ViajeOferta.findAll({
      where: condiciones,
      include: [
      {
        model: Conductor,
        as: 'driver',
        attributes: ['id', 'userId'],
        include: [
        {
          model: Usuario,
          as: 'user',
          attributes: ['id', 'name', 'profilePhoto']
        }]

      }],

      order: [['created_at', 'DESC']]
    });

    // Agregar rating del conductor a cada oferta (default 5 para nuevos)
    const ofertasConCalificacion = await Promise.all(
      ofertas.map(async (oferta) => {
        const plano = oferta.toJSON ? oferta.toJSON() : oferta;
        const conductorCalificacion = await calcularConductorCalificacion(plano.driver?.id);
        return {
          ...plano,
          driver: plano.driver ?
          { ...plano.driver, rating: conductorCalificacion } :
          plano.driver
        };
      })
    );

    return respuesta.status(200).json({
      success: true,
      data: ofertasConCalificacion,
      count: ofertasConCalificacion.length
    });
  } catch (error) {
    console.error('❌ [rideOfferController] Error fetching offers:', error);
    return respuesta.status(500).json({
      success: false,
      message: 'Error fetching offers',
      error: error.message
    });
  }
};

exports.obtenerOfertasConductor = async (solicitud, respuesta) => {
  try {
    const { driverId: conductorId } = solicitud.params;
    const { status: estado } = solicitud.query;

    // Check if driver exists
    const conductor = await Conductor.findByPk(conductorId);
    if (!conductor) {
      return respuesta.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    const condiciones = { driver_id: conductorId };
    if (estado) {
      condiciones.status = estado;
    }

    const ofertas = await ViajeOferta.findAll({
      where: condiciones,
      include: [
      {
        model: Viaje,
        as: 'ride',
        attributes: [
        'id',
        'passengerId',
        'pickupLocation',
        'dropoffLocation']

      }],

      order: [['created_at', 'DESC']]
    });

    return respuesta.status(200).json({
      success: true,
      data: ofertas,
      count: ofertas.length
    });
  } catch (error) {
    console.error(
      '❌ [rideOfferController] Error fetching driver offers:',
      error
    );
    return respuesta.status(500).json({
      success: false,
      message: 'Error fetching offers',
      error: error.message
    });
  }
};

exports.actualizarEstadoOferta = async (solicitud, respuesta) => {
  try {
    const { id } = solicitud.params;
    const { status: estado } = solicitud.body;

    // Validate status
    const validoEstados = [
    'pendiente',
    'aceptado',
    'rechazado',
    'vencido',
    'cancelado'];

    if (!validoEstados.includes(estado)) {
      return respuesta.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validoEstados.join(', ')}`
      });
    }

    const oferta = await ViajeOferta.findByPk(id);
    if (!oferta) {
      return respuesta.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    // If accepting offer, reject all other offers for the same ride
    if (estado === 'aceptado') {
      await ViajeOferta.update(
        { status: 'rechazado' },
        {
          where: {
            ride_id: oferta.ride_id,
            id: { [sequelize.Op.ne]: id },
            status: 'pendiente'
          }
        }
      );

      console.log(
        '✅ [rideOfferController] Rejected other offers for ride:',
        oferta.ride_id
      );
    }

    oferta.status = estado;
    await oferta.save();

    console.log(
      '✅ [rideOfferController] Offer status updated:',
      id,
      '→',
      estado
    );

    return respuesta.status(200).json({
      success: true,
      message: 'Offer status updated successfully',
      data: oferta
    });
  } catch (error) {
    console.error(
      '❌ [rideOfferController] Error updating offer status:',
      error
    );
    return respuesta.status(500).json({
      success: false,
      message: 'Error updating offer',
      error: error.message
    });
  }
};

exports.rechazarOferta = async (solicitud, respuesta) => {
  try {
    const { id } = solicitud.params;

    const oferta = await ViajeOferta.findByPk(id);
    if (!oferta) {
      return respuesta.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    oferta.status = 'rechazado';
    await oferta.save();

    console.log('✅ [rideOfferController] Offer rejected:', id);

    return respuesta.status(200).json({
      success: true,
      message: 'Offer rejected successfully',
      data: oferta
    });
  } catch (error) {
    console.error('❌ [rideOfferController] Error rejecting offer:', error);
    return respuesta.status(500).json({
      success: false,
      message: 'Error rejecting offer',
      error: error.message
    });
  }
};

exports.eliminarOfertasPendientes = async (solicitud, respuesta) => {
  try {
    const { rideId: viajeId } = solicitud.params;

    // Check if ride exists
    const viaje = await Viaje.findByPk(viajeId);
    if (!viaje) {
      return respuesta.status(404).json({
        success: false,
        message: 'Ride not found'
      });
    }

    // Delete all pending offers for this ride
    const eliminadoCantidad = await ViajeOferta.destroy({
      where: {
        ride_id: viajeId,
        status: 'pendiente'
      }
    });

    console.log(
      '✅ [rideOfferController] Deleted pending offers:',
      eliminadoCantidad
    );

    return respuesta.status(200).json({
      success: true,
      message: 'Pending offers deleted successfully',
      deletedCount: eliminadoCantidad
    });
  } catch (error) {
    console.error('❌ [rideOfferController] Error deleting offers:', error);
    return respuesta.status(500).json({
      success: false,
      message: 'Error deleting offers',
      error: error.message
    });
  }
};
