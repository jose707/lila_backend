// backend/src/routes/rides.js
const express = require('express');
const router = express.Router();
const verifiedIdentity = require('../middleware/verifiedIdentity');
const rideController = require('../controllers/rideController');
const { authMiddleware } = require('../middleware/auth');
const quickAssignment = require('../controllers/quickAssignmentController');
const quickAccess = require('../middleware/quickRideAccess');
const { getRideRoute } = require('../controllers/rideRouteController');

router.post('/quick/reserve', authMiddleware, verifiedIdentity, quickAssignment.reserve);
router.get('/quick/current', authMiddleware, quickAssignment.current);
router.get('/:rideId/quick', authMiddleware, quickAssignment.get);
router.post('/:rideId/quick/confirm', authMiddleware, quickAssignment.confirm);
router.post('/:rideId/quick/cancel', authMiddleware, quickAssignment.cancel);

// Rutas específicas PRIMERO (antes de :id)
router.post('/', authMiddleware, verifiedIdentity, rideController.createRide);
router.get('/requests', authMiddleware, rideController.getRideRequests);
router.get('/active', authMiddleware, rideController.getActiveRide);
router.get('/history', authMiddleware, rideController.getRideHistory);
router.get(
  '/cancellation-reasons',
  authMiddleware,
  rideController.getCancellationReasons,
);
router.get('/fares', authMiddleware, rideController.getFareSettings);

const negotiationOnly = async (req, res, next) => {
  try {
    const ride = await require('../models/Ride').findByPk(req.params.rideId);
    if (ride?.requestMode === 'quick_assignment') return res.status(409).json({ error: 'La asignación rápida no admite aceptación del conductor ni ofertas.' });
    return next();
  } catch (error) { return next(error); }
};

// Rutas dinámicas DESPUÉS (con parámetros)
router.get('/:rideId/route', authMiddleware, getRideRoute);
router.get('/:id', authMiddleware, quickAccess('participant'), rideController.getRideById);
router.put('/:rideId/accept', authMiddleware, negotiationOnly, rideController.acceptRide);
router.put('/:rideId/arrived', authMiddleware, quickAccess('driver'), rideController.arrivedRide);
router.put(
  '/:rideId/passenger-ready',
  authMiddleware,
  quickAccess('passenger'),
  rideController.passengerReady,
);
router.put('/:rideId/start', authMiddleware, quickAccess('driver'), rideController.startRide);
router.put('/:rideId/complete', authMiddleware, quickAccess('driver'), rideController.completeRide);
router.put('/:rideId/cancel', authMiddleware, rideController.cancelRide);

// 💰 CONTRA-OFERTAS
router.post(
  '/:rideId/counter-offer',
  authMiddleware,
  negotiationOnly,
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
  negotiationOnly,
  rideController.acceptCounterOffer,
);
router.post(
  '/:rideId/reject-counter-offer',
  authMiddleware,
  negotiationOnly,
  rideController.rejectCounterOffer,
);

module.exports = router;
