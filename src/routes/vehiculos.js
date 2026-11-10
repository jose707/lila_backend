// backend/src/routes/vehiculos.js
const express = require('express');
const vehiculoControlador = require("../controllers/vehiculoControlador");
const { autenticacionIntermediario: autenticacionIntermediario } = require("../middleware/autenticacion");

const enrutador = express.Router();

// Create vehicle (driver only)
enrutador.post('/', autenticacionIntermediario, vehiculoControlador.crearVehiculo);

// Get all vehicles with filters
enrutador.get('/', vehiculoControlador.obtenerTodosVehiculos);

// Get vehicle by ID
enrutador.get('/:id', vehiculoControlador.obtenerVehiculoPorId);

// Get vehicles by driver
enrutador.get('/conductor/:driverId', vehiculoControlador.obtenerVehiculosConductor);

// Update vehicle
enrutador.put('/:id', autenticacionIntermediario, vehiculoControlador.actualizarVehiculo);

// Delete vehicle
enrutador.delete('/:id', autenticacionIntermediario, vehiculoControlador.eliminarVehiculo);

module.exports = enrutador;
