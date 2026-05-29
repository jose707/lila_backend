// backend/src/controllers/paymentController.js
const db = require('../models');
const { Ride, Payment, User } = db;

/**
 * Create a new payment record for a completed ride
 * POST /api/payments
 */
exports.createPayment = async (req, res) => {
  try {
    const {
      ride_id,
      passenger_id,
      amount,
      currency,
      payment_method,
      payment_status,
      transaction_id,
    } = req.body;

    // Validate required fields
    if (!ride_id || !passenger_id || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: ride_id, passenger_id, amount',
      });
    }

    // Validate amount
    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0',
      });
    }

    // Check if ride exists
    const ride = await Ride.findByPk(ride_id);
    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found',
      });
    }

    // Check if passenger exists
    const passenger = await User.findByPk(passenger_id);
    if (!passenger) {
      return res.status(404).json({
        success: false,
        message: 'Passenger not found',
      });
    }

    // Check if payment already exists for this ride
    const existingPayment = await Payment.findOne({
      where: { rideId: ride_id },
    });

    if (existingPayment) {
      return res.status(409).json({
        success: false,
        message: 'Payment already exists for this ride',
        payment: existingPayment,
      });
    }

    // Create payment record
    const payment = await Payment.create({
      rideId: ride_id,
      passengerId: passenger_id,
      amount: parseFloat(amount),
      currency: currency || 'BOB',
      payment_method: payment_method || 'cash',
      payment_status: payment_status || 'pending',
      transaction_id: transaction_id || null,
      paid_at: payment_status === 'completed' ? new Date() : null,
    });

    return res.status(201).json({
      success: true,
      message: 'Payment created successfully',
      payment,
    });
  } catch (error) {
    console.error('Error creating payment:', error);
    return res.status(500).json({
      success: false,
      message: 'Error creating payment',
      error: error.message,
    });
  }
};

/**
 * Get payment by ride ID
 * GET /api/payments/ride/:rideId
 */
exports.getPaymentByRide = async (req, res) => {
  try {
    const { rideId } = req.params;

    const payment = await Payment.findOne({
      where: { rideId },
      include: [
        {
          model: Ride,
          as: 'ride',
          attributes: ['id', 'status', 'totalFare', 'finalFare', 'completedAt'],
        },
        {
          model: User,
          as: 'passenger',
          attributes: ['id', 'firstName', 'lastName', 'email', 'profilePhoto'],
        },
      ],
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found for this ride',
      });
    }

    return res.status(200).json({
      success: true,
      payment,
    });
  } catch (error) {
    console.error('Error getting payment by ride:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching payment',
      error: error.message,
    });
  }
};

/**
 * Get payment by ID
 * GET /api/payments/:paymentId
 */
exports.getPaymentById = async (req, res) => {
  try {
    const { paymentId } = req.params;

    const payment = await Payment.findByPk(paymentId, {
      include: [
        {
          model: Ride,
          as: 'ride',
          attributes: ['id', 'status', 'totalFare', 'finalFare', 'completedAt'],
        },
        {
          model: User,
          as: 'passenger',
          attributes: ['id', 'firstName', 'lastName', 'email', 'profilePhoto'],
        },
      ],
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    return res.status(200).json({
      success: true,
      payment,
    });
  } catch (error) {
    console.error('Error getting payment by ID:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching payment',
      error: error.message,
    });
  }
};

/**
 * Get all payments for a passenger
 * GET /api/payments/passenger/:passengerId
 */
exports.getPaymentsByPassenger = async (req, res) => {
  try {
    const { passengerId } = req.params;
    const { limit = 20, offset = 0, status } = req.query;

    // Build filter
    const where = { passengerId };
    if (status) {
      where.payment_status = status;
    }

    const { count, rows } = await Payment.findAndCountAll({
      where,
      include: [
        {
          model: Ride,
          as: 'ride',
          attributes: [
            'id',
            'status',
            'totalFare',
            'finalFare',
            'completedAt',
            'pickupAddress',
            'dropoffAddress',
          ],
        },
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    return res.status(200).json({
      success: true,
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset),
      payments: rows,
    });
  } catch (error) {
    console.error('Error getting payments by passenger:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching payments',
      error: error.message,
    });
  }
};

/**
 * Update payment status
 * PUT /api/payments/:paymentId/status
 */
exports.updatePaymentStatus = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { payment_status, transaction_id } = req.body;

    // Validate status
    const validStatuses = ['pending', 'completed', 'failed', 'refunded'];
    if (!validStatuses.includes(payment_status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    const payment = await Payment.findByPk(paymentId);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    // Update payment
    await payment.update({
      payment_status,
      transaction_id: transaction_id || payment.transaction_id,
      paid_at: payment_status === 'completed' ? new Date() : payment.paid_at,
    });

    return res.status(200).json({
      success: true,
      message: 'Payment status updated successfully',
      payment,
    });
  } catch (error) {
    console.error('Error updating payment status:', error);
    return res.status(500).json({
      success: false,
      message: 'Error updating payment',
      error: error.message,
    });
  }
};

/**
 * Process payment refund
 * PUT /api/payments/:paymentId/refund
 */
exports.processRefund = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { reason } = req.body;

    const payment = await Payment.findByPk(paymentId);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    // Check if payment can be refunded
    if (payment.payment_status === 'refunded') {
      return res.status(400).json({
        success: false,
        message: 'Payment is already refunded',
      });
    }

    if (payment.payment_status === 'failed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot refund a failed payment',
      });
    }

    if (payment.payment_status === 'pending') {
      return res.status(400).json({
        success: false,
        message:
          'Cannot refund a pending payment. Payment must be completed first.',
      });
    }

    // Process refund
    await payment.update({
      payment_status: 'refunded',
      paid_at: new Date(), // Update timestamp to refund time
    });

    return res.status(200).json({
      success: true,
      message: `Payment refunded successfully. Reason: ${
        reason || 'Not specified'
      }`,
      payment,
    });
  } catch (error) {
    console.error('Error processing refund:', error);
    return res.status(500).json({
      success: false,
      message: 'Error processing refund',
      error: error.message,
    });
  }
};

/**
 * Delete payment record (only for pending payments or admin)
 * DELETE /api/payments/:paymentId
 */
exports.deletePayment = async (req, res) => {
  try {
    const { paymentId } = req.params;

    const payment = await Payment.findByPk(paymentId);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    // Only allow deletion of pending payments
    if (payment.payment_status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Can only delete pending payments',
      });
    }

    await payment.destroy();

    return res.status(200).json({
      success: true,
      message: 'Payment deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting payment:', error);
    return res.status(500).json({
      success: false,
      message: 'Error deleting payment',
      error: error.message,
    });
  }
};
