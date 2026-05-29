// backend/src/routes/rides.js
const express = require('express');
const router = express.Router();
const rideController = require('../controllers/rideController');
const { authMiddleware } = require('../middleware/auth');

// Rutas específicas PRIMERO (antes de :id)
router.post('/', authMiddleware, rideController.createRide);
router.get('/requests', authMiddleware, rideController.getRideRequests);
router.get('/active', authMiddleware, rideController.getActiveRide);
router.get('/history', authMiddleware, rideController.getRideHistory);
router.get(
  '/cancellation-reasons',
  authMiddleware,
  rideController.getCancellationReasons,
);
router.get('/fares', authMiddleware, rideController.getFareSettings);

// Rutas dinámicas DESPUÉS (con parámetros)
router.get('/:id', authMiddleware, rideController.getRideById);
router.put('/:rideId/accept', authMiddleware, rideController.acceptRide);
router.put('/:rideId/arrived', authMiddleware, rideController.arrivedRide);
router.put(
  '/:rideId/passenger-ready',
  authMiddleware,
  rideController.passengerReady,
);
router.put('/:rideId/start', authMiddleware, rideController.startRide);
router.put('/:rideId/complete', authMiddleware, rideController.completeRide);
router.put('/:rideId/cancel', authMiddleware, rideController.cancelRide);

// 💰 CONTRA-OFERTAS
router.post(
  '/:rideId/counter-offer',
  authMiddleware,
  rideController.submitCounterOffer,
);
router.get(
  '/:rideId/counter-offers',
  authMiddleware,
  rideController.getCounterOffers,
);
router.post(
  '/:rideId/accept-counter-offer',
  authMiddleware,
  rideController.acceptCounterOffer,
);
router.post(
  '/:rideId/reject-counter-offer',
  authMiddleware,
  rideController.rejectCounterOffer,
);

module.exports = router;
