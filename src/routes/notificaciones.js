// backend/src/routes/notificaciones.js
const express = require('express');
const enrutador = express.Router();
const { Notificacion: Notificacion, Usuario: Usuario } = require('../models');
const { autenticacionIntermediario: autenticacionIntermediario } = require("../middleware/autenticacion");
const { Op: Operador } = require('sequelize');

/**
 * GET /notificaciones
 * Devuelve las notificaciones del usuario autenticado.
 * Query params:
 *   ?unread=true  → solo no leídas
 *   ?limit=20     → max registros (default 20)
 */
enrutador.get('/', autenticacionIntermediario, async (solicitud, respuesta) => {
  try {
    const usuarioId = solicitud.user.id;
    const limite = Math.min(parseInt(solicitud.query.limit ?? '20', 10), 100);
    const unread = solicitud.query.unread === 'true';

    const condiciones = { user_id: usuarioId };
    if (unread) condiciones.read_at = null;

    const notificaciones = await Notificacion.findAll({
      where: condiciones,
      order: [['created_at', 'DESC']],
      limit: limite
    });

    const unreadCantidad = await Notificacion.count({
      where: { user_id: usuarioId, read_at: null }
    });

    return respuesta.json({ success: true, data: notificaciones, unread_count: unreadCantidad });
  } catch (error) {
    return respuesta.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /notificaciones/:id/leer
 * Marca una notificación como leída.
 */
enrutador.patch('/:id/leer', autenticacionIntermediario, async (solicitud, respuesta) => {
  try {
    const notif = await Notificacion.findOne({
      where: { id: solicitud.params.id, user_id: solicitud.user.id }
    });
    if (!notif) return respuesta.status(404).json({ success: false, error: 'Notificación no encontrada.' });

    await Notificacion.update({read_at:new Date()},{where:{id:notif.id,user_id:solicitud.user.id,read_at:null}});
    return respuesta.json({ success: true, message: 'Marcada como leída.' });
  } catch (error) {
    return respuesta.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /notificaciones/leer-todas
 * Marca todas las notificaciones del usuario como leídas.
 */
enrutador.patch('/leer-todas', autenticacionIntermediario, async (solicitud, respuesta) => {
  try {
    const [cantidad] = await Notificacion.update(
      { read_at: new Date() },
      { where: { user_id: solicitud.user.id, read_at: null } }
    );
    return respuesta.json({ success: true, marked: cantidad });
  } catch (error) {
    return respuesta.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /notificaciones/registrar-token
 * El app móvil llama este endpoint al iniciar sesión o cuando FCM renueva el token.
 * Body: { token: "fcm-device-token" }
 */
enrutador.post('/registrar-token', autenticacionIntermediario, async (solicitud, respuesta) => {
  try {
    const { token } = solicitud.body;
    if (!token) return respuesta.status(400).json({ success: false, error: 'token requerido.' });

    await Usuario.update({ fcmToken: token }, { where: { id: solicitud.user.id } });
    return respuesta.json({ success: true, message: 'Token FCM registrado.' });
  } catch (error) {
    return respuesta.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /notificaciones/registrar-token
 * Elimina el token FCM del usuario (llamar al cerrar sesión).
 */
enrutador.delete('/registrar-token', autenticacionIntermediario, async (solicitud, respuesta) => {
  try {
    await Usuario.update({ fcmToken: null }, { where: { id: solicitud.user.id } });
    return respuesta.json({ success: true, message: 'Token FCM eliminado.' });
  } catch (error) {
    return respuesta.status(500).json({ success: false, error: error.message });
  }
});

module.exports = enrutador;
