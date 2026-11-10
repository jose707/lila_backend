// backend/src/routes/ubicacionesConductores.js
const express = require('express');
const conductorUbicacionControlador = require("../controllers/conductorUbicacionControlador");
const { autenticacionIntermediario: autenticacionIntermediario } = require("../middleware/autenticacion");

const enrutador = express.Router();

// Update driver location (driver can update their own, everyone can get)
enrutador.post('/actualizar', autenticacionIntermediario, conductorUbicacionControlador.actualizarUbicacion);
enrutador.post('/viaje/:rideId', autenticacionIntermediario, conductorUbicacionControlador.actualizarUbicacionViajeActivo);
enrutador.put('/estado/desconectado', autenticacionIntermediario, conductorUbicacionControlador.desconectarConductorActual);

// Get driver location by ID
enrutador.get('/:driverId', conductorUbicacionControlador.obtenerUbicacionConductor);

// Get nearby drivers (for passenger searching)
enrutador.get('/cercanos/buscar', conductorUbicacionControlador.obtenerConductoresCercanos);

// Get all online drivers
enrutador.get('/conectados/lista', conductorUbicacionControlador.obtenerConductoresConectados);

// Set driver online/offline status
enrutador.put(
  '/estado/alternar',
  autenticacionIntermediario,
  conductorUbicacionControlador.establecerConexionConductor
);

module.exports = enrutador;
