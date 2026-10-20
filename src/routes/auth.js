// backend/src/routes/auth.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authMiddleware } = require('../middleware/auth');
const identityVerificationEnabled = require('../middleware/identityVerificationEnabled');
const faceLivenessEnabled = require('../middleware/faceLivenessEnabled');
const multer = require('multer');
const identityUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 3, fields: 20 }, fileFilter: (_req, file, cb) => {
  if (['image/jpeg', 'image/png', 'image/jpg'].includes(file.mimetype)) cb(null, true);
  else cb(new Error('Solo se permiten imágenes JPEG/PNG'));
} }).fields([{ name: 'ciFront', maxCount: 1 }, { name: 'ciBack', maxCount: 1 }, { name: 'selfie', maxCount: 1 }]);
// Registro
router.post('/signup', authController.signup);

// Login
router.post('/login', authController.login);

// Obtener usuario actual
router.get('/me', authMiddleware, authController.getCurrentUser);

// Refrescar token
router.post('/refresh', authMiddleware, authController.refreshToken);

// Google Sign-In
router.post('/google', authController.googleAuth);

// Verify phone with Firebase OTP
router.post('/verify-phone', authController.verifyPhoneOTP);

router.post(
  '/verify-identity',
  authMiddleware,
  identityVerificationEnabled,
  identityUpload,
  authController.verifyIdentity,
);
router.post('/face-liveness/session', authMiddleware, identityVerificationEnabled, faceLivenessEnabled, authController.startFaceLiveness);
router.post('/face-liveness/complete', authMiddleware, identityVerificationEnabled, faceLivenessEnabled, authController.completeFaceLiveness);

// Check if Firebase user exists (for login flow)
router.get('/check-firebase/:firebaseUid', authController.checkFirebaseUser);

module.exports = router;
