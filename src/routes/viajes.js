// backend/src/routes/viajes.js
const express = require('express');
const enrutador = express.Router();
const verificadoIdentidad = require("../middleware/verificadoIdentidad");
const viajeControlador = require("../controllers/viajeControlador");
const { autenticacionIntermediario: autenticacionIntermediario } = require("../middleware/autenticacion");
const rapidoAsignacion = require("../controllers/rapidaAsignacionControlador");
const rapidoAcceso = require("../middleware/rapidaViajeAccess");
const { obtenerViajeRuta: obtenerViajeRuta } = require("../controllers/viajeRutaControlador");
const { registrarEmergenciaViaje } = require('../controllers/emergenciaViajeControlador');

enrutador.post('/:rideId/emergencia', autenticacionIntermediario, registrarEmergenciaViaje);

enrutador.post('/rapida/reservar', autenticacionIntermediario, verificadoIdentidad, rapidoAsignacion.reservar);
enrutador.get('/rapida/actual', autenticacionIntermediario, rapidoAsignacion.actual);
enrutador.get('/:rideId/rapida', autenticacionIntermediario, rapidoAsignacion.obtener);
enrutador.post('/:rideId/rapida/confirmar', autenticacionIntermediario, rapidoAsignacion.confirmar);
enrutador.post('/:rideId/rapida/cancelar', autenticacionIntermediario, rapidoAsignacion.cancelar);

// Rutas específicas PRIMERO (antes de :id)
enrutador.post('/', autenticacionIntermediario, verificadoIdentidad, viajeControlador.crearViaje);
enrutador.get('/solicitudes', autenticacionIntermediario, viajeControlador.obtenerSolicitudesViaje);
enrutador.get('/activo', autenticacionIntermediario, viajeControlador.obtenerViajeActivo);
enrutador.get('/historial', autenticacionIntermediario, viajeControlador.obtenerHistorialViajes);
enrutador.get(
  '/motivos-cancelacion',
  autenticacionIntermediario,
  viajeControlador.obtenerMotivosCancelacion
);
enrutador.get('/tarifas', autenticacionIntermediario, viajeControlador.obtenerConfiguracionTarifas);

const negociacionOnly = async (solicitud, respuesta, siguiente) => {
  try {
    const viaje = await require("../models/Viaje").findByPk(solicitud.params.rideId);
    if (viaje?.requestMode === 'asignacion_rapida') return respuesta.status(409).json({ error: 'La asignación rápida no admite aceptación del conductor ni ofertas.' });
    return siguiente();
  } catch (error) {return siguiente(error);}
};

// Rutas dinámicas DESPUÉS (con parámetros)
enrutador.get('/:rideId/ruta', autenticacionIntermediario, obtenerViajeRuta);
enrutador.get('/:id', autenticacionIntermediario, rapidoAcceso('participant'), viajeControlador.obtenerViajePorId);
enrutador.put('/:rideId/aceptar', autenticacionIntermediario, negociacionOnly, viajeControlador.aceptarViaje);
enrutador.put('/:rideId/llegada', autenticacionIntermediario, rapidoAcceso('conductor'), viajeControlador.llegadoViaje);
enrutador.put(
  '/:rideId/pasajero-listo',
  autenticacionIntermediario,
  rapidoAcceso('pasajero'),
  viajeControlador.pasajeroListo
);
enrutador.put('/:rideId/iniciar', autenticacionIntermediario, rapidoAcceso('conductor'), viajeControlador.iniciarViaje);
enrutador.put('/:rideId/completar', autenticacionIntermediario, rapidoAcceso('conductor'), viajeControlador.completarViaje);
enrutador.put('/:rideId/cancelar', autenticacionIntermediario, viajeControlador.cancelarViaje);

// 💰 CONTRA-OFERTAS
enrutador.post(
  '/:rideId/contraoferta',
  autenticacionIntermediario,
  negociacionOnly,
  viajeControlador.enviarContraoferta
);
enrutador.get(
  '/:rideId/contraofertas',
  autenticacionIntermediario,
  viajeControlador.obtenerContraofertas
);
enrutador.post(
  '/:rideId/aceptar-contraoferta',
  autenticacionIntermediario,
  negociacionOnly,
  viajeControlador.aceptarContraoferta
);
enrutador.post(
  '/:rideId/rechazar-contraoferta',
  autenticacionIntermediario,
  negociacionOnly,
  viajeControlador.rechazarContraoferta
);

module.exports = enrutador;
