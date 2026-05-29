// backend/src/routes/notifications.js
const express = require('express');
const router  = express.Router();
const { Notification, User } = require('../models');
const { authMiddleware } = require('../middleware/auth');
const { Op } = require('sequelize');

/**
 * GET /notifications
 * Devuelve las notificaciones del usuario autenticado.
 * Query params:
 *   ?unread=true  → solo no leídas
 *   ?limit=20     → max registros (default 20)
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId  = req.user.id;
    const limit   = Math.min(parseInt(req.query.limit ?? '20', 10), 100);
    const unread  = req.query.unread === 'true';

    const where = { user_id: userId };
    if (unread) where.is_read = false;

    const notifications = await Notification.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
    });

    const unreadCount = await Notification.count({
      where: { user_id: userId, is_read: false },
    });

    return res.json({ success: true, data: notifications, unread_count: unreadCount });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /notifications/:id/read
 * Marca una notificación como leída.
 */
router.patch('/:id/read', authMiddleware, async (req, res) => {
  try {
    const notif = await Notification.findOne({
      where: { id: req.params.id, user_id: req.user.id },
    });
    if (!notif) return res.status(404).json({ success: false, error: 'Notificación no encontrada.' });

    await notif.update({ is_read: true, read_at: new Date() });
    return res.json({ success: true, message: 'Marcada como leída.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /notifications/read-all
 * Marca todas las notificaciones del usuario como leídas.
 */
router.patch('/read-all', authMiddleware, async (req, res) => {
  try {
    const [count] = await Notification.update(
      { is_read: true, read_at: new Date() },
      { where: { user_id: req.user.id, is_read: false } }
    );
    return res.json({ success: true, marked: count });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /notifications/register-token
 * El app móvil llama este endpoint al iniciar sesión o cuando FCM renueva el token.
 * Body: { token: "fcm-device-token" }
 */
router.post('/register-token', authMiddleware, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, error: 'token requerido.' });

    await User.update({ fcmToken: token }, { where: { id: req.user.id } });
    return res.json({ success: true, message: 'Token FCM registrado.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /notifications/register-token
 * Elimina el token FCM del usuario (llamar al cerrar sesión).
 */
router.delete('/register-token', authMiddleware, async (req, res) => {
  try {
    await User.update({ fcmToken: null }, { where: { id: req.user.id } });
    return res.json({ success: true, message: 'Token FCM eliminado.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
