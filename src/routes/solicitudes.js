// backend/src/routes/solicitudes.js
const express = require('express');
const enrutador = express.Router();
const multer = require('multer');
const ruta = require('path');
const fs = require('fs');
const solicitudControlador = require("../controllers/solicitudControlador");
const { autenticacionIntermediario: autenticacionIntermediario } = require("../middleware/autenticacion");

// Configurar multer
const subirDirectorio = ruta.join(__dirname, '../uploads/drivers');
if (!fs.existsSync(subirDirectorio)) {
  fs.mkdirSync(subirDirectorio, { recursive: true });
}

const almacenamiento = multer.diskStorage({
  destination: (solicitud, archivo, funcionRetorno) => {
    funcionRetorno(null, subirDirectorio);
  },
  filename: (solicitud, archivo, funcionRetorno) => {
    const unicoSufijo = Date.now() + '-' + Math.round(Math.random() * 1e9);
    funcionRetorno(null, unicoSufijo + ruta.extname(archivo.originalname));
  }
});

const subir = multer({
  storage: almacenamiento,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (solicitud, archivo, funcionRetorno) => {
    const permitidoMimes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (permitidoMimes.includes(archivo.mimetype)) {
      funcionRetorno(null, true);
    } else {
      funcionRetorno(new Error('Solo se permiten imágenes JPEG/PNG'));
    }
  }
});

const subirCampos = subir.fields([
{ name: 'profilePhoto', maxCount: 1 },
{ name: 'ciFront', maxCount: 1 },
{ name: 'ciBack', maxCount: 1 },
{ name: 'licenseFront', maxCount: 1 },
{ name: 'licenseBack', maxCount: 1 },
{ name: 'ticPhoto', maxCount: 1 },
{ name: 'antecedentsPhoto', maxCount: 1 },
{ name: 'carFront', maxCount: 1 },
{ name: 'carBack', maxCount: 1 },
{ name: 'carLeft', maxCount: 1 },
{ name: 'carRight', maxCount: 1 },
{ name: 'soatPhoto', maxCount: 1 },
{ name: 'ruatPhoto', maxCount: 1 },
{ name: 'domicileProof', maxCount: 1 }]
);

// Register new driver request
const multerErrorManejador = (error, solicitud, respuesta, siguiente) => {
  if (error && error.code === 'LIMIT_UNEXPECTED_FILE') {
    return respuesta.status(400).json({
      error: `Campo de archivo inesperado: "${error.field}". Verifica que los nombres de los campos coincidan con los esperados.`
    });
  }
  if (error && error.code === 'LIMIT_FILE_SIZE') {
    return respuesta.status(400).json({
      error: 'El archivo excede el tamaño máximo permitido (10 MB).'
    });
  }
  if (error) {
    return respuesta.status(400).json({
      error: error.message || 'Error al procesar los archivos.'
    });
  }
  siguiente();
};

enrutador.post(
  '/registrar',
  autenticacionIntermediario,
  require("../middleware/verificadoIdentidad"),
  subirCampos,
  multerErrorManejador,
  solicitudControlador.registrarConductor
);

const ocrSubir = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter: (_Solicitud, archivo, funcionRetorno) => funcionRetorno(null, ['image/jpeg', 'image/png', 'image/jpg'].includes(archivo.mimetype))
});

// Extraer datos de un documento con OCR (Cloud Vision)
enrutador.post(
  '/extraer-ocr',
  autenticacionIntermediario,
  ocrSubir.single('image'),
  multerErrorManejador,
  solicitudControlador.extraerDocumento
);

// Get current request status
enrutador.get('/estado', autenticacionIntermediario, solicitudControlador.obtenerSolicitudEstado);

// Resubmit documents
enrutador.post(
  '/reenviar',
  autenticacionIntermediario,
  subirCampos,
  multerErrorManejador,
  solicitudControlador.reenviarDocumentos
);

// Serve files with anti-cache headers
enrutador.get('/archivo/:filename', autenticacionIntermediario, require("../middleware/documentoAccess"), (solicitud, respuesta) => {
  const nombreArchivo = solicitud.params.filename;
  const filepath = ruta.join(subirDirectorio, nombreArchivo);

  // Validar path
  const normalizadoRuta = ruta.normalize(filepath);
  const subirDirectorioNormalizado = ruta.normalize(subirDirectorio);
  if (!normalizadoRuta.startsWith(subirDirectorioNormalizado)) {
    return respuesta.status(403).json({ error: 'Acceso denegado' });
  }

  // Anti-cache headers
  respuesta.set(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
  );
  respuesta.set('Pragma', 'no-cache');
  respuesta.set('Expires', '0');

  respuesta.sendFile(filepath);
});

module.exports = enrutador;
