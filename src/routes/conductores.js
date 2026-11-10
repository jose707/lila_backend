// backend/src/routes/conductores.js
const express = require('express');
const enrutador = express.Router();
const multer = require('multer');
const ruta = require('path');
const fs = require('fs');
const conductorControlador = require("../controllers/conductorControlador");
const { autenticacionIntermediario: autenticacionIntermediario } = require("../middleware/autenticacion");

// Configurar multer para subida de archivos
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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB por archivo
  fileFilter: (solicitud, archivo, funcionRetorno) => {
    const permitidoMimes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (permitidoMimes.includes(archivo.mimetype)) {
      funcionRetorno(null, true);
    } else {
      funcionRetorno(new Error('Solo se permiten imágenes JPEG/PNG'));
    }
  }
});

// Manejador de errores de multer para esta ruta
const multerErrorManejador = (error, solicitud, respuesta, siguiente) => {
  if (!error) return siguiente();
  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return respuesta.status(400).json({
      error: `Campo de archivo inesperado: "${error.field}". Verifica que los nombres coincidan con los esperados.`
    });
  }
  if (error.code === 'LIMIT_FILE_SIZE') {
    return respuesta.status(400).json({
      error: 'El archivo excede el tamaño máximo permitido (10 MB).'
    });
  }
  return respuesta.status(400).json({
    error: error.message || 'Error al procesar los archivos.'
  });
};

// Public routes
// Ambas rutas de registro usan las mismas validaciones, adjuntos y recortes.
enrutador.post('/registrar', require('./solicitudes'));

// Resubmit documents for rejected application
enrutador.post('/reenviar', require('./solicitudes'));

// Conductor sube su RUAT para verificación del vehículo
enrutador.post(
  '/enviar-ruat',
  autenticacionIntermediario,
  subir.fields([{ name: 'ruatPhoto', maxCount: 1 }]),
  multerErrorManejador,
  require('../controllers/documentosRenovacionControlador').enviar
);

// Get driver status for current user
enrutador.get('/estado', autenticacionIntermediario, conductorControlador.obtenerConductorEstado);


// Serve driver documents with anti-cache headers
enrutador.get('/documento/:filename', autenticacionIntermediario, require("../middleware/documentoAccess"), (solicitud, respuesta) => {
  const nombreArchivo = solicitud.params.filename;
  const filepath = ruta.join(__dirname, '../uploads/drivers', nombreArchivo);

  // Validar que el archivo solicitado está dentro del directorio de uploads
  const normalizadoRuta = ruta.normalize(filepath);
  const subirDirectorioNormalizado = ruta.normalize(subirDirectorio);
  if (!normalizadoRuta.startsWith(subirDirectorioNormalizado)) {
    return respuesta.status(403).json({ error: 'Acceso denegado' });
  }

  // Agregar headers anti-cache
  respuesta.set(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
  );
  respuesta.set('Pragma', 'no-cache');
  respuesta.set('Expires', '0');

  respuesta.sendFile(filepath);
});

const comprobantesComision = require('../controllers/comprobantesComisionControlador');
const comisionesAdmin = require('../controllers/comisionesAdminControlador');
enrutador.get('/estados-comision', autenticacionIntermediario, comprobantesComision.obtenerConductor, comisionesAdmin.listarPropias);
enrutador.post('/estados-comision/:id/comprobantes', autenticacionIntermediario, comprobantesComision.obtenerConductor, comprobantesComision.recibirArchivo, comprobantesComision.enviar);
enrutador.get('/estados-comision/:id/comprobantes/:comprobanteId', autenticacionIntermediario, comprobantesComision.obtenerConductor, comprobantesComision.ver);

// ─── SETTLEMENTS — vista del conductor ───────────────────────────────────
// El conductor puede ver sus cobros mensuales acumulados y el estado de deuda.
const { sequelize: sequelize } = require('../models');

// GET /conductores/liquidaciones — historial completo de settlements del conductor
enrutador.get('/liquidaciones', autenticacionIntermediario, async (solicitud, respuesta) => {
  try {
    const conductorId = solicitud.user.driverProfile?.id;
    if (!conductorId) {
      return respuesta.status(403).json({
        message: 'Solo conductores aprobados pueden ver sus settlements.'
      });
    }

    const [liquidaciones] = await sequelize.query(
      `
      SELECT
        cs.id,
        cs.period_start,
        cs.period_end,
        cs.total_rides,
        cs.gross_amount,
        cs.total_commission,
        cs.amount_paid,
        cs.status,
        cs.due_date,
        cs.paid_at,
        cs.payment_method
      FROM comision cs
      WHERE cs.driver_id = :driverId
      ORDER BY cs.period_start DESC
    `,
      { replacements: { driverId: conductorId } }
    );

    return respuesta.json({ settlements: liquidaciones });
  } catch (error) {
    return respuesta.status(500).json({ message: error.message });
  }
});

// GET /conductores/liquidaciones/pendientes — deuda actual del conductor
enrutador.get('/liquidaciones/pendientes', autenticacionIntermediario, async (solicitud, respuesta) => {
  try {
    const conductorId = solicitud.user.driverProfile?.id;
    if (!conductorId) {
      return respuesta.
      status(403).
      json({ message: 'Solo conductores pueden ver su deuda.' });
    }

    const [filas] = await sequelize.query(
      `
      SELECT
        SUM(cs.total_commission) AS deuda_total,
        COUNT(cs.id)             AS settlements_pendientes,
        MIN(cs.due_date)         AS proximo_vencimiento
      FROM comision cs
      WHERE cs.driver_id = :driverId
        AND cs.status IN ('pendiente_pago', 'atrasado')
    `,
      { replacements: { driverId: conductorId } }
    );

    const { deuda_total, settlements_pendientes: liquidaciones_Pendientes, proximo_vencimiento } =
    filas[0];

    return respuesta.json({
      deuda_total: parseFloat(deuda_total || 0),
      settlements_pendientes: parseInt(liquidaciones_Pendientes || 0),
      proximo_vencimiento,
      esta_vencido: filas[0].status === 'atrasado'
    });
  } catch (error) {
    return respuesta.status(500).json({ message: error.message });
  }
});

// GET /conductores/liquidaciones/:id — detalle de un settlement con sus viajes
enrutador.get('/liquidaciones/:id', autenticacionIntermediario, async (solicitud, respuesta) => {
  try {
    const conductorId = solicitud.user.driverProfile?.id;
    const { id } = solicitud.params;
    if (!conductorId) {
      return respuesta.
      status(403).
      json({ message: 'Solo conductores pueden ver sus settlements.' });
    }

    const [[liquidacion]] = await sequelize.query(
      `
      SELECT * FROM comision
      WHERE id = :id AND driver_id = :driverId
    `,
      { replacements: { id, driverId: conductorId } }
    );

    if (!liquidacion) {
      return respuesta.status(404).json({ message: 'Settlement no encontrado.' });
    }

    const [ganancias] = await sequelize.query(
      `
      SELECT
        de.id,
        de.gross_amount,
        de.commission_amount,
        de.net_amount,
        de.payment_method,
        de.commission_status,
        de.created_at,
        r.pickup_address,
        r.dropoff_address,
        r."completedAt"
      FROM cobros_conductor de
      JOIN viaje r ON r.id = de.ride_id
      WHERE de.settlement_id = :id
      ORDER BY r."completedAt" DESC
    `,
      { replacements: { id } }
    );

    return respuesta.json({ settlement: liquidacion, earnings: ganancias });
  } catch (error) {
    return respuesta.status(500).json({ message: error.message });
  }
});

module.exports = enrutador;

enrutador.post('/renovar-documentos', autenticacionIntermediario, subir.fields(['licenseFront','licenseBack','ticPhoto','antecedentsPhoto','domicileProof','ruatPhoto','soatPhoto','carFront','carBack','carLeft','carRight'].map(name=>({name,maxCount:1}))),multerErrorManejador,require('../controllers/documentosRenovacionControlador').enviar);
