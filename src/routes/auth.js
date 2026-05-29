// backend/src/routes/auth.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authMiddleware } = require('../middleware/auth');

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

// Check if Firebase user exists (for login flow)
router.get('/check-firebase/:firebaseUid', authController.checkFirebaseUser);

module.exports = router;
