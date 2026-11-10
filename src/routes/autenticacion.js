// backend/src/routes/autenticacion.js
const express = require('express');
const enrutador = express.Router();
const autenticacionControlador = require("../controllers/autenticacionControlador");
const { autenticacionIntermediario: autenticacionIntermediario } = require("../middleware/autenticacion");
const identidadVerificacionHabilitado = require("../middleware/identidadVerificacionHabilitado");
const rostroLivenessHabilitado = require("../middleware/rostroLivenessHabilitado");
const multer = require('multer');
const identidadSubir = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 3, fields: 20 }, fileFilter: (_Solicitud, archivo, funcionRetorno) => {
    if (['image/jpeg', 'image/png', 'image/jpg'].includes(archivo.mimetype)) funcionRetorno(null, true);else
    funcionRetorno(new Error('Solo se permiten imágenes JPEG/PNG'));
  } }).fields([{ name: 'ciFront', maxCount: 1 }, { name: 'ciBack', maxCount: 1 }, { name: 'selfie', maxCount: 1 }]);
// El texto y su versión se entregan juntos desde el archivo publicado.
enrutador.get('/verificar-identidad/consentimiento', autenticacionIntermediario, autenticacionControlador.obtenerConsentimiento);
// Registro
enrutador.post('/registro', autenticacionControlador.registrarse);

// Login
enrutador.post('/iniciar-sesion', autenticacionControlador.ingresar);

// Obtener usuario actual
enrutador.get('/sesion', autenticacionIntermediario, autenticacionControlador.obtenerUsuarioActual);

// Refrescar token
enrutador.post('/renovar', autenticacionIntermediario, autenticacionControlador.renovarToken);

// Google Sign-In
enrutador.post('/google', autenticacionControlador.googleAutenticacion);

// Verify phone with Firebase OTP
enrutador.post('/verificar-telefono', autenticacionControlador.verificarTelefonoOTP);

enrutador.post(
  '/verificar-identidad/ocr',
  autenticacionIntermediario,
  identidadVerificacionHabilitado,
  identidadSubir,
  autenticacionControlador.precheckIdentidadOcr
);
enrutador.post(
  '/verificar-identidad',
  autenticacionIntermediario,
  identidadVerificacionHabilitado,
  identidadSubir,
  autenticacionControlador.verificarIdentidad
);
enrutador.post('/prueba-vida/sesion', autenticacionIntermediario, identidadVerificacionHabilitado, rostroLivenessHabilitado, autenticacionControlador.iniciarRostroVitalidad);
enrutador.post('/prueba-vida/completar', autenticacionIntermediario, identidadVerificacionHabilitado, rostroLivenessHabilitado, autenticacionControlador.completarRostroVitalidad);

// Check if Firebase user exists (for login flow)
enrutador.get('/comprobar-firebase/:firebaseUid', autenticacionControlador.comprobarUsuarioFirebase);

module.exports = enrutador;
