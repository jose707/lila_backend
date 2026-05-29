// backend/src/routes/vehicles.js
const express = require('express');
const vehicleController = require('../controllers/vehicleController');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Create vehicle (driver only)
router.post('/', authMiddleware, vehicleController.createVehicle);

// Get all vehicles with filters
router.get('/', vehicleController.getAllVehicles);

// Get vehicle by ID
router.get('/:id', vehicleController.getVehicleById);

// Get vehicles by driver
router.get('/driver/:driverId', vehicleController.getVehiclesByDriver);

// Update vehicle
router.put('/:id', authMiddleware, vehicleController.updateVehicle);

// Delete vehicle
router.delete('/:id', authMiddleware, vehicleController.deleteVehicle);

module.exports = router;
