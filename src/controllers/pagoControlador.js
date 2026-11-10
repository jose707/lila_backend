// backend/src/controllers/pagoControlador.js
const baseDatos = require('../models');
const { Viaje, Pago, Usuario } = baseDatos;

/**
 * Create a new payment record for a completed ride
 * POST /api/pagos
 */
exports.crearPago = async (solicitud, respuesta) => {
  try {
    const {
      ride_id: viaje_Id,
      passenger_id: pasajero_Id,
      amount: importe,
      currency,
      payment_method: pago_Metodo,
      payment_status: pago_Estado,
      transaction_id: transaccion_Id
    } = solicitud.body;

    // Validate required fields
    if (!viaje_Id || !importe) {
      return respuesta.status(400).json({
        success: false,
        message: 'Missing required fields: ride_id, amount'
      });
    }

    // Validate amount
    if (importe <= 0) {
      return respuesta.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
      });
    }

    // Check if ride exists
    const viaje = await Viaje.findByPk(viaje_Id);
    if (!viaje) {
      return respuesta.status(404).json({
        success: false,
        message: 'Ride not found'
      });
    }

    if (pasajero_Id && pasajero_Id !== viaje.passengerId) return respuesta.status(400).json({error:'El pasajero se obtiene del viaje.'});
    if(solicitud.user.role!=='administrador' && viaje.passengerId!==solicitud.user.id) return respuesta.sendStatus(403);
    if (pago_Metodo !== undefined && pago_Metodo !== viaje.paymentMethod) return respuesta.status(400).json({error:'El método de pago debe coincidir con el seleccionado en el viaje.'});
    // Check if passenger exists
    const pasajero = await Usuario.findByPk(viaje.passengerId);
    if (!pasajero) {
      return respuesta.status(404).json({
        success: false,
        message: 'Passenger not found'
      });
    }

    // Check if payment already exists for this ride
    const existentePago = await Pago.findOne({
      where: { rideId: viaje_Id }
    });

    if (existentePago) {
      return respuesta.status(409).json({
        success: false,
        message: 'Payment already exists for this ride',
        payment: existentePago
      });
    }

    // Create payment record
    const pago = await Pago.create({
      rideId: viaje_Id,
      amount: parseFloat(importe),
      currency: currency || 'BOB',
      payment_status: pago_Estado || 'pendiente',
      transaction_id: transaccion_Id || null,
      paid_at: pago_Estado === 'completado' ? new Date() : null
    });

    return respuesta.status(201).json({
      success: true,
      message: 'Payment created successfully',
      payment: pago
    });
  } catch (error) {
    console.error('Error creating payment:', error);
    return respuesta.status(500).json({
      success: false,
      message: 'Error creating payment',
      error: error.message
    });
  }
};

/**
 * Get payment by ride ID
 * GET /api/pagos/viaje/:rideId
 */
exports.obtenerPagoPorViaje = async (solicitud, respuesta) => {
  try {
    const { rideId: viajeId } = solicitud.params;

    const pago = await Pago.findOne({
      where: { rideId: viajeId },
      include: [
      {
        model: Viaje,
        as: 'ride',
        attributes: ['id', 'passengerId', 'status', 'totalFare', 'finalFare', 'completedAt'],
        include:[{model:Usuario,as:'passenger',attributes:['id','email','profilePhoto']}]
      }]

    });

    if (!pago) {
      return respuesta.status(404).json({
        success: false,
        message: 'Payment not found for this ride'
      });
    }

    return respuesta.status(200).json({
      success: true,
      payment: pago
    });
  } catch (error) {
    console.error('Error getting payment by ride:', error);
    return respuesta.status(500).json({
      success: false,
      message: 'Error fetching payment',
      error: error.message
    });
  }
};

/**
 * Get payment by ID
 * GET /api/pagos/:paymentId
 */
exports.obtenerPagoPorId = async (solicitud, respuesta) => {
  try {
    const { paymentId: pagoId } = solicitud.params;

    const pago = await Pago.findByPk(pagoId, {
      include: [
      {
        model: Viaje,
        as: 'ride',
        attributes: ['id', 'passengerId', 'status', 'totalFare', 'finalFare', 'completedAt'],
        include:[{model:Usuario,as:'passenger',attributes:['id','email','profilePhoto']}]
      }]

    });

    if (!pago) {
      return respuesta.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    return respuesta.status(200).json({
      success: true,
      payment: pago
    });
  } catch (error) {
    console.error('Error getting payment by ID:', error);
    return respuesta.status(500).json({
      success: false,
      message: 'Error fetching payment',
      error: error.message
    });
  }
};

/**
 * Get all payments for a passenger
 * GET /api/pagos/pasajero/:passengerId
 */
exports.obtenerPagosPasajero = async (solicitud, respuesta) => {
  try {
    const { passengerId: pasajeroId } = solicitud.params;
    const { limit: limite = 20, offset: desplazamiento = 0, status: estado } = solicitud.query;

    // Build filter
    const condiciones = {};
    if (estado) {
      condiciones.payment_status = estado;
    }

    const { count: cantidad, rows: filas } = await Pago.findAndCountAll({
      where: condiciones,
      include: [
      {
        model: Viaje,
        as: 'ride', where:{passengerId:pasajeroId}, required:true,
        attributes: [
        'passengerId',
        'id',
        'status',
        'totalFare',
        'finalFare',
        'completedAt',
        'pickup_address',
        'dropoff_address']

      }],

      order: [['createdAt', 'DESC']],
      limit: parseInt(limite),
      offset: parseInt(desplazamiento)
    });

    return respuesta.status(200).json({
      success: true,
      total: cantidad,
      limit: parseInt(limite),
      offset: parseInt(desplazamiento),
      payments: filas
    });
  } catch (error) {
    console.error('Error getting payments by passenger:', error);
    return respuesta.status(500).json({
      success: false,
      message: 'Error fetching payments',
      error: error.message
    });
  }
};

/**
 * Update payment status
 * PUT /api/pagos/:paymentId/estado
 */
exports.actualizarEstadoPago = async (solicitud, respuesta) => {
  try {
    const { paymentId: pagoId } = solicitud.params;
    const { payment_status: pago_Estado, transaction_id: transaccion_Id } = solicitud.body;

    // Validate status
    const validoEstados = ['pendiente', 'completado', 'fallido', 'reembolsado'];
    if (!validoEstados.includes(pago_Estado)) {
      return respuesta.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validoEstados.join(', ')}`
      });
    }

    const pago = await Pago.findByPk(pagoId);
    if (!pago) {
      return respuesta.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Update payment
    await pago.update({
      payment_status: pago_Estado,
      transaction_id: transaccion_Id || pago.transaction_id,
      paid_at: pago_Estado === 'completado' ? new Date() : pago.paid_at
    });

    return respuesta.status(200).json({
      success: true,
      message: 'Payment status updated successfully',
      payment: pago
    });
  } catch (error) {
    console.error('Error updating payment status:', error);
    return respuesta.status(500).json({
      success: false,
      message: 'Error updating payment',
      error: error.message
    });
  }
};

/**
 * Process payment refund
 * PUT /api/pagos/:paymentId/reembolsar
 */
exports.procesarReembolso = async (solicitud, respuesta) => {
  try {
    const { paymentId: pagoId } = solicitud.params;
    const { reason: motivo } = solicitud.body;

    const pago = await Pago.findByPk(pagoId);
    if (!pago) {
      return respuesta.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Check if payment can be refunded
    if (pago.payment_status === 'reembolsado') {
      return respuesta.status(400).json({
        success: false,
        message: 'Payment is already refunded'
      });
    }

    if (pago.payment_status === 'fallido') {
      return respuesta.status(400).json({
        success: false,
        message: 'Cannot refund a failed payment'
      });
    }

    if (pago.payment_status === 'pendiente') {
      return respuesta.status(400).json({
        success: false,
        message:
        'Cannot refund a pending payment. Payment must be completed first.'
      });
    }

    // Process refund
    await pago.update({
      payment_status: 'reembolsado',
      paid_at: new Date() // Update timestamp to refund time
    });

    return respuesta.status(200).json({
      success: true,
      message: `Payment refunded successfully. Reason: ${
      motivo || 'Not specified'}`,

      payment: pago
    });
  } catch (error) {
    console.error('Error processing refund:', error);
    return respuesta.status(500).json({
      success: false,
      message: 'Error processing refund',
      error: error.message
    });
  }
};

/**
 * Delete payment record (only for pending payments or admin)
 * DELETE /api/pagos/:paymentId
 */
exports.eliminarPago = async (solicitud, respuesta) => {
  try {
    const { paymentId: pagoId } = solicitud.params;

    const pago = await Pago.findByPk(pagoId);
    if (!pago) {
      return respuesta.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Only allow deletion of pending payments
    if (pago.payment_status !== 'pendiente') {
      return respuesta.status(400).json({
        success: false,
        message: 'Can only delete pending payments'
      });
    }

    await pago.destroy();

    return respuesta.status(200).json({
      success: true,
      message: 'Payment deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting payment:', error);
    return respuesta.status(500).json({
      success: false,
      message: 'Error deleting payment',
      error: error.message
    });
  }
};
