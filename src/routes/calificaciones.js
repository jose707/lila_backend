// backend/src/routes/calificaciones.js
const express = require('express');
const enrutador = express.Router();
const calificacionesControlador = require("../controllers/ratingsControlador");
const { autenticacionIntermediario: autenticacionIntermediario } = require("../middleware/autenticacion");

// Create a new rating
enrutador.post('/', autenticacionIntermediario, calificacionesControlador.crearCalificacion);

// Get ratings for a specific driver
enrutador.get('/conductor/:driverId', calificacionesControlador.obtenerCalificacionesConductor);

// Get driver's average rating
enrutador.get(
  '/conductor/:driverId/promedio',
  calificacionesControlador.obtenerPromedioCalificacionesConductor
);

// Check if a rating exists for a ride
enrutador.get('/viaje/:rideId/existe', calificacionesControlador.comprobarCalificacionExistente);

// Get calculated rating for the authenticated user
enrutador.get('/mias', autenticacionIntermediario, calificacionesControlador.obtenerMiCalificacion);

module.exports = enrutador;
