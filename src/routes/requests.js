// backend/src/routes/requests.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const requestController = require('../controllers/requestController');
const { authMiddleware } = require('../middleware/auth');

// Configurar multer
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
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes JPEG/PNG'));
    }
  },
});

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

// Register new driver request
const multerErrorHandler = (err, req, res, next) => {
  if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      error: `Campo de archivo inesperado: "${err.field}". Verifica que los nombres de los campos coincidan con los esperados.`,
    });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: 'El archivo excede el tamaño máximo permitido (10 MB).',
    });
  }
  if (err) {
    return res.status(400).json({
      error: err.message || 'Error al procesar los archivos.',
    });
  }
  next();
};

router.post(
  '/register',
  authMiddleware,
  uploadFields,
  multerErrorHandler,
  requestController.registerDriver,
);

// Get current request status
router.get('/status', authMiddleware, requestController.getRequestStatus);

// Resubmit documents
router.post(
  '/resubmit',
  authMiddleware,
  uploadFields,
  multerErrorHandler,
  requestController.resubmitDocuments,
);

// Serve files with anti-cache headers
router.get('/file/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(uploadDir, filename);

  // Validar path
  const normalizedPath = path.normalize(filepath);
  const uploadDirNormalized = path.normalize(uploadDir);
  if (!normalizedPath.startsWith(uploadDirNormalized)) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }

  // Anti-cache headers
  res.set(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  );
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  res.sendFile(filepath);
});

module.exports = router;
