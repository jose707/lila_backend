// backend/src/routes/driverLocations.js
const express = require('express');
const driverLocationController = require('../controllers/driverLocationController');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Update driver location (driver can update their own, everyone can get)
router.post('/update', authMiddleware, driverLocationController.updateLocation);

// Get driver location by ID
router.get('/:driverId', driverLocationController.getDriverLocation);

// Get nearby drivers (for passenger searching)
router.get('/nearby/search', driverLocationController.getNearbyDrivers);

// Get all online drivers
router.get('/online/list', driverLocationController.getOnlineDrivers);

// Set driver online/offline status
router.put(
  '/status/toggle',
  authMiddleware,
  driverLocationController.setDriverOnlineStatus,
);

module.exports = router;
