// backend/src/routes/ofertasViaje.js
const express = require('express');
const viajeOfertaControlador = require("../controllers/viajeOfertaControlador");
const { autenticacionIntermediario: autenticacionIntermediario } = require("../middleware/autenticacion");

const enrutador = express.Router();

// Create offer (driver only)
enrutador.post('/', autenticacionIntermediario, viajeOfertaControlador.crearOferta);

// Get offer by ID
enrutador.get('/:id', viajeOfertaControlador.obtenerOfertaPorId);

// Get offers for a specific ride
enrutador.get('/viaje/:rideId', viajeOfertaControlador.obtenerOfertasViaje);

// Get offers from a specific driver
enrutador.get('/conductor/:driverId', viajeOfertaControlador.obtenerOfertasConductor);

// Update offer status
enrutador.put(
  '/:id/estado',
  autenticacionIntermediario,
  viajeOfertaControlador.actualizarEstadoOferta
);

// Reject offer
enrutador.put('/:id/rechazar', autenticacionIntermediario, viajeOfertaControlador.rechazarOferta);

// Delete all pending offers for a ride
enrutador.delete(
  '/viaje/:rideId/pendientes',
  autenticacionIntermediario,
  viajeOfertaControlador.eliminarOfertasPendientes
);

module.exports = enrutador;
