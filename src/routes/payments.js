// backend/src/routes/payments.js
const express = require('express');
const paymentController = require('../controllers/paymentController');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Create payment
router.post('/', authMiddleware, paymentController.createPayment);

// Get payment by ID
router.get('/:paymentId', paymentController.getPaymentById);

// Get payment by ride ID
router.get('/ride/:rideId', paymentController.getPaymentByRide);

// Get all payments for a passenger
router.get(
  '/passenger/:passengerId',
  authMiddleware,
  paymentController.getPaymentsByPassenger,
);

// Update payment status
router.put(
  '/:paymentId/status',
  authMiddleware,
  paymentController.updatePaymentStatus,
);

// Process refund
router.put(
  '/:paymentId/refund',
  authMiddleware,
  paymentController.processRefund,
);

// Delete payment (only for pending payments)
router.delete('/:paymentId', authMiddleware, paymentController.deletePayment);

module.exports = router;
