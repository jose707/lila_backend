// backend/src/routes/drivers.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const driverController = require('../controllers/driverController');
const { authMiddleware } = require('../middleware/auth');

// Configurar multer para subida de archivos
const uploadDir = path.join(__dirname, '../uploads/drivers');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB por archivo
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes JPEG/PNG'));
    }
  },
});

// Campos de archivo esperados
const uploadFields = upload.fields([
  { name: 'profilePhoto', maxCount: 1 },
  { name: 'ciFront', maxCount: 1 },
  { name: 'ciBack', maxCount: 1 },
  { name: 'licenseFront', maxCount: 1 },
  { name: 'licenseBack', maxCount: 1 },
  { name: 'antecedentsPhoto', maxCount: 1 },
  { name: 'carFront', maxCount: 1 },
  { name: 'carBack', maxCount: 1 },
  { name: 'carLeft', maxCount: 1 },
  { name: 'carRight', maxCount: 1 },
  { name: 'soatPhoto', maxCount: 1 },
  { name: 'ruatPhoto', maxCount: 1 },
]);

// Manejador de errores de multer para esta ruta
const multerErrorHandler = (err, req, res, next) => {
  if (!err) return next();
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      error: `Campo de archivo inesperado: "${err.field}". Verifica que los nombres coincidan con los esperados.`,
    });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: 'El archivo excede el tamaño máximo permitido (10 MB).',
    });
  }
  return res.status(400).json({
    error: err.message || 'Error al procesar los archivos.',
  });
};

// Public routes
router.post(
  '/register',
  authMiddleware,
  uploadFields,
  multerErrorHandler,
  driverController.registerDriver,
);

// Resubmit documents for rejected application
router.post(
  '/resubmit',
  authMiddleware,
  uploadFields,
  multerErrorHandler,
  driverController.resubmitDocuments,
);

// Conductor sube su RUAT para verificación del vehículo
router.post(
  '/submit-ruat',
  authMiddleware,
  upload.fields([{ name: 'ruatPhoto', maxCount: 1 }]),
  multerErrorHandler,
  driverController.submitRuat,
);

// Get driver status for current user
router.get('/status', authMiddleware, driverController.getDriverStatus);


// Serve driver documents with anti-cache headers
router.get('/document/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(__dirname, '../uploads/drivers', filename);

  // Validar que el archivo solicitado está dentro del directorio de uploads
  const normalizedPath = path.normalize(filepath);
  const uploadDirNormalized = path.normalize(uploadDir);
  if (!normalizedPath.startsWith(uploadDirNormalized)) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }

  // Agregar headers anti-cache
  res.set(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  );
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  res.sendFile(filepath);
});

// ─── SETTLEMENTS — vista del conductor ───────────────────────────────────
// El conductor puede ver sus cobros mensuales acumulados y el estado de deuda.
const { sequelize } = require('../models');

// GET /drivers/settlements — historial completo de settlements del conductor
router.get('/settlements', authMiddleware, async (req, res) => {
  try {
    const driverId = req.user.driverProfile?.id;
    if (!driverId) {
      return res.status(403).json({
        message: 'Solo conductores aprobados pueden ver sus settlements.',
      });
    }

    const [settlements] = await sequelize.query(
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
      FROM commission_settlements cs
      WHERE cs.driver_id = :driverId
      ORDER BY cs.period_start DESC
    `,
      { replacements: { driverId } },
    );

    return res.json({ settlements });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// GET /drivers/settlements/pending — deuda actual del conductor
router.get('/settlements/pending', authMiddleware, async (req, res) => {
  try {
    const driverId = req.user.driverProfile?.id;
    if (!driverId) {
      return res
        .status(403)
        .json({ message: 'Solo conductores pueden ver su deuda.' });
    }

    const [rows] = await sequelize.query(
      `
      SELECT
        SUM(cs.total_commission) AS deuda_total,
        COUNT(cs.id)             AS settlements_pendientes,
        MIN(cs.due_date)         AS proximo_vencimiento
      FROM commission_settlements cs
      WHERE cs.driver_id = :driverId
        AND cs.status IN ('pending_payment', 'overdue')
    `,
      { replacements: { driverId } },
    );

    const { deuda_total, settlements_pendientes, proximo_vencimiento } =
      rows[0];

    return res.json({
      deuda_total: parseFloat(deuda_total || 0),
      settlements_pendientes: parseInt(settlements_pendientes || 0),
      proximo_vencimiento,
      esta_vencido: rows[0].status === 'overdue',
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// GET /drivers/settlements/:id — detalle de un settlement con sus viajes
router.get('/settlements/:id', authMiddleware, async (req, res) => {
  try {
    const driverId = req.user.driverProfile?.id;
    const { id } = req.params;
    if (!driverId) {
      return res
        .status(403)
        .json({ message: 'Solo conductores pueden ver sus settlements.' });
    }

    const [[settlement]] = await sequelize.query(
      `
      SELECT * FROM commission_settlements
      WHERE id = :id AND driver_id = :driverId
    `,
      { replacements: { id, driverId } },
    );

    if (!settlement) {
      return res.status(404).json({ message: 'Settlement no encontrado.' });
    }

    const [earnings] = await sequelize.query(
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
      FROM driver_earnings de
      JOIN rides r ON r.id = de.ride_id
      WHERE de.settlement_id = :id
      ORDER BY r."completedAt" DESC
    `,
      { replacements: { id } },
    );

    return res.json({ settlement, earnings });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
