// backend/src/routes/rideOffers.js
const express = require('express');
const rideOfferController = require('../controllers/rideOfferController');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Create offer (driver only)
router.post('/', authMiddleware, rideOfferController.createOffer);

// Get offer by ID
router.get('/:id', rideOfferController.getOfferById);

// Get offers for a specific ride
router.get('/ride/:rideId', rideOfferController.getOffersByRide);

// Get offers from a specific driver
router.get('/driver/:driverId', rideOfferController.getOffersByDriver);

// Update offer status
router.put(
  '/:id/status',
  authMiddleware,
  rideOfferController.updateOfferStatus,
);

// Reject offer
router.put('/:id/reject', authMiddleware, rideOfferController.rejectOffer);

// Delete all pending offers for a ride
router.delete(
  '/ride/:rideId/pending',
  authMiddleware,
  rideOfferController.deletePendingOffers,
);

module.exports = router;
