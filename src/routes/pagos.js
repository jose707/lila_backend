// backend/src/routes/pagos.js
const express = require('express');
const pagoControlador = require("../controllers/pagoControlador");
const { autenticacionIntermediario: autenticacionIntermediario } = require("../middleware/autenticacion");

const enrutador = express.Router();

// Create payment
enrutador.post('/', autenticacionIntermediario, pagoControlador.crearPago);

// Get payment by ID
enrutador.get('/:paymentId', pagoControlador.obtenerPagoPorId);

// Get payment by ride ID
enrutador.get('/viaje/:rideId', pagoControlador.obtenerPagoPorViaje);

// Get all payments for a passenger
enrutador.get(
  '/pasajero/:passengerId',
  autenticacionIntermediario,
  pagoControlador.obtenerPagosPasajero
);

// Update payment status
enrutador.put(
  '/:paymentId/estado',
  autenticacionIntermediario,
  pagoControlador.actualizarEstadoPago
);

// Process refund
enrutador.put(
  '/:paymentId/reembolsar',
  autenticacionIntermediario,
  pagoControlador.procesarReembolso
);

// Delete payment (only for pending payments)
enrutador.delete('/:paymentId', autenticacionIntermediario, pagoControlador.eliminarPago);

module.exports = enrutador;
