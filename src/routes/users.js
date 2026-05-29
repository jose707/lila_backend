// backend/src/routes/users.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authMiddleware } = require('../middleware/auth');

router.get('/profile', authMiddleware, userController.getUserProfile);
router.get('/:id', authMiddleware, userController.getUserProfile);
router.put('/:id', authMiddleware, userController.updateUserProfile);
router.put('/:id/photo', authMiddleware, userController.updateProfilePhoto);
router.post('/:id/verify-phone', authMiddleware, userController.verifyPhone);
router.put(
  '/:id/current-mode',
  authMiddleware,
  userController.updateCurrentMode,
);

module.exports = router;
